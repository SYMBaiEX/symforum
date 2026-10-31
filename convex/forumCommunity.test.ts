/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { register as registerBetterAuth } from "@convex-dev/better-auth/test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { getBase58Decoder } from "@solana/kit";
import schema from "./schema";
import { api, components, internal } from "./_generated/api";
import { IDENTITY_MARKER } from "../lib/identity-config";
import { COMMUNITY_PAYMENT_TTL_MS } from "../lib/forum-community";
const modules = import.meta.glob("./**/*.ts");
beforeEach(() =>
  vi.stubEnv("CONVEX_SITE_URL", "https://strong-bee-384.convex.site"),
);
const key = (n: number) =>
  getBase58Decoder().decode(new Uint8Array(32).fill(n));
const sig = (n: number) =>
  getBase58Decoder().decode(new Uint8Array(64).fill(n));
function setup() {
  const t = convexTest(schema, modules);
  registerBetterAuth(t);
  registerLimiter(t);
  return t;
}
type Test = ReturnType<typeof setup>;
async function actor(t: Test, n: number, link = true) {
  const now = Date.now(),
    wallet = key(n);
  const user = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: `Contributor ${n}`,
          email: `contributor${n}@example.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      name: `Contributor ${n}`,
      username: `contributor${n}`,
      role: "reader",
    });
    await ctx.db.insert("betterAuthIdentityLinks", {
      userId: id,
      authUserId: user._id,
      linkedAt: now,
    });
    return id;
  });
  const session = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: user._id,
          token: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 86_400_000,
        },
      },
    }),
  );
  if (link)
    await t.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "account",
          data: {
            userId: user._id,
            providerId: "solana",
            accountId: wallet,
            createdAt: now,
            updatedAt: now,
          },
        },
      }),
    );
  return {
    userId,
    wallet,
    client: t.withIdentity({
      issuer: "https://strong-bee-384.convex.site",
      subject: user._id,
      authSystem: IDENTITY_MARKER,
      sessionId: session._id,
    }),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const brief =
  "Deliver a sourced public analysis with a reproducible method and clearly dated facts. Sponsor will select one accurate report.";
async function paymentActors(t: Test) {
  const payer = await actor(t, 1),
    recipient = await actor(t, 2);
  await recipient.client.mutation(api.forumCommunity.setTipRecipient, {
    wallet: recipient.wallet,
    accepting: true,
  });
  return { payer, recipient };
}

describe("community authorization and public claims", () => {
  test("anonymous accounts cannot change recipient, create work or view private payments", async () => {
    const t = setup();
    await expect(
      t.mutation(api.forumCommunity.setTipRecipient, {
        wallet: key(1),
        accepting: true,
      }),
    ).rejects.toThrow("Sign in");
    await expect(
      t.mutation(api.forumCommunity.createBounty, {
        kind: "bounty",
        title: "Build something useful",
        brief,
        amountLamports: "1000000",
      }),
    ).rejects.toThrow("Sign in");
    await expect(t.query(api.forumCommunity.listPayments, {})).rejects.toThrow(
      "Sign in",
    );
  });
  test("publishing a payment address requires own server-linked wallet and explicit opt-in", async () => {
    const t = setup(),
      a = await actor(t, 3),
      b = await actor(t, 4);
    await expect(
      a.client.mutation(api.forumCommunity.setTipRecipient, {
        wallet: b.wallet,
        accepting: true,
      }),
    ).rejects.toThrow("Link and verify");
    expect(await t.query(api.forumCommunity.listTipRecipients, {})).toEqual([]);
    await a.client.mutation(api.forumCommunity.setTipRecipient, {
      wallet: a.wallet,
      accepting: true,
    });
    expect(await t.query(api.forumCommunity.listTipRecipients, {})).toEqual([
      { userId: a.userId, username: "contributor3", wallet: a.wallet },
    ]);
    await a.client.mutation(api.forumCommunity.setTipRecipient, {
      wallet: a.wallet,
      accepting: false,
    });
    expect(await t.query(api.forumCommunity.listTipRecipients, {})).toEqual([]);
  });
  test("a project hub requires verified exact-mint metadata and never verifies self-declared affiliation", async () => {
    const t = setup(),
      a = await actor(t, 5),
      mint = key(7),
      args = {
        wallet: a.wallet,
        mint,
        role: "Community contributor",
        description:
          "A self-declared community contribution with public documentation.",
        website: "https://example.org/project",
      };
    await expect(
      a.client.mutation(api.forumCommunity.createProjectClaim, args),
    ).rejects.toThrow("Verify this mint");
    await t.run((ctx) =>
      ctx.db.insert("forumVerifiedMints", {
        mint,
        symbol: "TEST",
        name: "Test project",
        decimals: 6,
        tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        verifiedAt: Date.now(),
        expiresAt: Date.now() + 600000,
      }),
    );
    const projectId = await a.client.mutation(
      api.forumCommunity.createProjectClaim,
      args,
    );
    expect(
      await a.client.mutation(api.forumCommunity.createProjectClaim, {
        ...args,
        role: "Builder",
      }),
    ).toBe(projectId);
    const projects = await t.query(api.forumCommunity.listProjects, { mint });
    expect(projects).toHaveLength(1);
    expect(projects[0].claims).toHaveLength(1);
    expect(projects[0].claims[0]).not.toHaveProperty("wallet");
    expect(projects[0].claims[0]).not.toHaveProperty("verified");
    expect(projects[0].mint).toBe(mint);
  });
});
describe("public bounty listing", () => {
  const statuses = ["open", "selected", "paid", "cancelled"] as const;

  test.each(statuses)(
    "filters exact mint and %s status before limiting to the newest 32",
    async (status) => {
      const t = setup(),
        mint = key(30),
        otherMint = key(31);
      const matchingIds = await t.run(async (ctx) => {
        const sponsorId = await ctx.db.insert("users", {
          username: "public-sponsor",
          email: "private-sponsor@example.test",
        });
        const ids = [];
        for (let i = 0; i < 33; i++) {
          ids.push(
            await ctx.db.insert("forumCommunityWork", {
              sponsorId,
              mint,
              kind: "bounty",
              title: `Matching bounty ${i}`,
              brief,
              amountLamports: "1000000",
              status,
              createdAt: i,
              updatedAt: i,
            }),
          );
        }
        for (let i = 0; i < 33; i++) {
          await ctx.db.insert("forumCommunityWork", {
            sponsorId,
            mint,
            kind: "research",
            title: `Newer other-status bounty ${i}`,
            brief,
            amountLamports: "1000000",
            status: status === "open" ? "selected" : "open",
            createdAt: 100 + i,
            updatedAt: 100 + i,
          });
          await ctx.db.insert("forumCommunityWork", {
            sponsorId,
            mint: otherMint,
            kind: "bounty",
            title: `Newer other-mint bounty ${i}`,
            brief,
            amountLamports: "1000000",
            status,
            createdAt: 200 + i,
            updatedAt: 200 + i,
          });
        }
        return ids;
      });
      const rows = await t.query(api.forumCommunity.listBounties, {
        mint,
        status,
      });
      expect(rows.map((row) => row.workId)).toEqual(
        matchingIds.slice(1).reverse(),
      );
      expect(
        rows.every((row) => row.mint === mint && row.status === status),
      ).toBe(true);
      expect(Object.keys(rows[0]).sort()).toEqual(
        [
          "workId",
          "sponsorId",
          "sponsor",
          "mint",
          "kind",
          "title",
          "brief",
          "amountLamports",
          "status",
          "selectedSubmissionId",
          "updatedAt",
        ].sort(),
      );
      expect(rows[0].sponsor).toBe("public-sponsor");
      expect(rows[0].selectedSubmissionId).toBeNull();
      expect(JSON.stringify(rows)).not.toContain(
        "private-sponsor@example.test",
      );
    },
  );

  test("preserves mint-only mixed statuses, unscoped status/default and 32-row caps", async () => {
    const t = setup(),
      mint = key(32),
      otherMint = key(33);
    const stored = await t.run(async (ctx) => {
      const sponsorId = await ctx.db.insert("users", {
        username: "listing-sponsor",
      });
      const rows = [];
      for (let i = 0; i < 40; i++) {
        for (const status of statuses) {
          const updatedAt = i * 10 + statuses.indexOf(status);
          const workMint = i % 3 === 0 ? null : i % 3 === 1 ? mint : otherMint;
          const workId = await ctx.db.insert("forumCommunityWork", {
            sponsorId,
            mint: workMint,
            kind: "bounty",
            title: `${status} bounty ${i}`,
            brief,
            amountLamports: "1000000",
            status,
            createdAt: updatedAt,
            updatedAt,
          });
          rows.push({ workId, mint: workMint, status, updatedAt });
        }
      }
      return rows.sort((a, b) => b.updatedAt - a.updatedAt);
    });
    const mintOnly = await t.query(api.forumCommunity.listBounties, { mint });
    expect(mintOnly.map((row) => row.workId)).toEqual(
      stored
        .filter((row) => row.mint === mint)
        .slice(0, 32)
        .map((row) => row.workId),
    );
    expect(new Set(mintOnly.map((row) => row.status)).size).toBe(4);
    for (const status of statuses) {
      const unscoped = await t.query(api.forumCommunity.listBounties, {
        status,
      });
      expect(unscoped.map((row) => row.workId)).toEqual(
        stored
          .filter((row) => row.status === status)
          .slice(0, 32)
          .map((row) => row.workId),
      );
    }
    expect(await t.query(api.forumCommunity.listBounties, {})).toEqual(
      await t.query(api.forumCommunity.listBounties, { status: "open" }),
    );
    expect(
      await t.query(api.forumCommunity.listBounties, { mint: key(34) }),
    ).toEqual([]);
    await expect(
      t.query(api.forumCommunity.listBounties, {
        mint: "not-a-solana-mint",
        status: "open",
      }),
    ).rejects.toThrow("Use the exact Solana mint address.");
  });
});

describe("sponsor-approved work", () => {
  test("a pledge moves no funds, submissions stay owner/sponsor-private and only sponsor selects", async () => {
    const t = setup(),
      sponsor = await actor(t, 10),
      contributor = await actor(t, 11),
      stranger = await actor(t, 12);
    const workId = await sponsor.client.mutation(
      api.forumCommunity.createBounty,
      {
        kind: "research",
        title: "Research this market carefully",
        brief,
        amountLamports: "20000000",
      },
    );
    expect((await t.query(api.forumCommunity.listBounties, {}))[0].status).toBe(
      "open",
    );
    expect(
      await t.run((ctx) => ctx.db.query("forumCommunityPayments").take(5)),
    ).toEqual([]);
    await expect(
      sponsor.client.mutation(api.forumCommunity.claimBounty, {
        workId,
        url: "https://example.org/research",
        summary: "A report with dated citations and reproducible calculations.",
      }),
    ).rejects.toThrow("not accepting");
    const submissionId = await contributor.client.mutation(
      api.forumCommunity.claimBounty,
      {
        workId,
        url: "https://example.org/research",
        summary: "A report with dated citations and reproducible calculations.",
      },
    );
    expect(
      await stranger.client.query(api.forumCommunity.listSubmissions, {
        workId,
      }),
    ).toEqual([]);
    expect(
      await sponsor.client.query(api.forumCommunity.listSubmissions, {
        workId,
      }),
    ).toHaveLength(1);
    await expect(
      stranger.client.mutation(api.forumCommunity.selectSubmission, {
        workId,
        submissionId,
      }),
    ).rejects.toThrow("Only the sponsor");
    await sponsor.client.mutation(api.forumCommunity.selectSubmission, {
      workId,
      submissionId,
    });
    expect(
      (
        await t.query(api.forumCommunity.listBounties, { status: "selected" })
      )[0].selectedSubmissionId,
    ).toBe(submissionId);
    await sponsor.client.mutation(api.forumCommunity.cancelBounty, { workId });
    expect(
      (
        await t.query(api.forumCommunity.listBounties, { status: "cancelled" })
      )[0].status,
    ).toBe("cancelled");
  });
});
describe("exact non-replayable community payment intents", () => {
  test("two expired rewards cannot hide a later protected hold", async () => {
    const t = setup(),
      { payer, recipient } = await paymentActors(t);
    const workId = await payer.client.mutation(
      api.forumCommunity.createBounty,
      {
        kind: "research",
        title: "Research exact payment safety",
        brief,
        amountLamports: "1000000",
      },
    );
    const submissionId = await recipient.client.mutation(
      api.forumCommunity.claimBounty,
      {
        workId,
        url: "https://example.org/research",
        summary:
          "Research with bounded evidence and a reproducible transaction receipt.",
      },
    );
    await payer.client.mutation(api.forumCommunity.selectSubmission, {
      workId,
      submissionId,
    });
    const first = await payer.client.mutation(
      api.forumCommunity.preparePayment,
      { wallet: payer.wallet, workId },
    );
    const heldId = await t.run(async (ctx) => {
      const row = (await ctx.db.get("forumCommunityPayments", first.intentId))!;
      await ctx.db.patch("forumCommunityPayments", row._id, {
        status: "expired",
      });
      const fields = {
        authUserId: row.authUserId,
        payerId: row.payerId,
        wallet: row.wallet,
        recipientId: row.recipientId,
        recipient: row.recipient,
        amountLamports: row.amountLamports,
        purpose: row.purpose,
        workId: row.workId,
        submissionId: row.submissionId,
        expiresAt: row.expiresAt,
      };
      await ctx.db.insert("forumCommunityPayments", {
        ...fields,
        reference: key(40),
        memo: `SYMF-COMMUNITY:${key(40)}`,
        createdAt: row.createdAt + 1,
        status: "expired",
      });
      return await ctx.db.insert("forumCommunityPayments", {
        ...fields,
        reference: key(41),
        memo: `SYMF-COMMUNITY:${key(41)}`,
        createdAt: row.createdAt + 2,
        status: "held",
        signature: sig(6),
        issue: "receipt_unavailable",
      });
    });
    const recovered = await payer.client.mutation(
      api.forumCommunity.preparePayment,
      { wallet: payer.wallet, workId },
    );
    expect(recovered.intentId).toBe(heldId);
    expect(recovered.status).toBe("held");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("forumCommunityPayments")
          .withIndex("by_workId", (q) => q.eq("workId", workId))
          .take(10),
      ),
    ).toHaveLength(3);
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.get("forumCommunityWork", workId))!.paymentIntentId,
      ),
    ).toBe(heldId);
  });
  test("tip recipient, amount and linked payer are server-bound; only payer can read", async () => {
    const t = setup(),
      { payer, recipient } = await paymentActors(t);
    const intent = await payer.client.mutation(
      api.forumCommunity.preparePayment,
      {
        wallet: payer.wallet,
        recipientId: recipient.userId,
        amountLamports: "1000000",
      },
    );
    expect(intent.status).toBe("ready");
    await expect(
      recipient.client.query(api.forumCommunity.getPayment, {
        intentId: intent.intentId,
      }),
    ).rejects.toThrow("not found");
    const duplicate = await payer.client.mutation(
      api.forumCommunity.preparePayment,
      {
        wallet: payer.wallet,
        recipientId: recipient.userId,
        amountLamports: "1000000",
      },
    );
    expect(duplicate.intentId).toBe(intent.intentId);
    await expect(
      payer.client.mutation(api.forumCommunity.preparePayment, {
        wallet: payer.wallet,
        recipientId: recipient.userId,
        amountLamports: "2000000",
      }),
    ).rejects.toThrow("unresolved");
    await expect(
      payer.client.mutation(api.forumCommunity.preparePayment, {
        wallet: recipient.wallet,
        recipientId: recipient.userId,
        amountLamports: "1000000",
      }),
    ).rejects.toThrow("Link and verify");
  });
  test("payment request is claimed before opening and cannot be opened twice", async () => {
    const t = setup(),
      { payer, recipient } = await paymentActors(t),
      intent = await payer.client.mutation(api.forumCommunity.preparePayment, {
        wallet: payer.wallet,
        recipientId: recipient.userId,
        amountLamports: "1000000",
      });
    const result = await payer.client.mutation(
      api.forumCommunity.markPaymentOpened,
      { intentId: intent.intentId },
    );
    expect(result.paymentUrl).toContain(`solana:${recipient.wallet}`);
    await expect(
      payer.client.mutation(api.forumCommunity.markPaymentOpened, {
        intentId: intent.intentId,
      }),
    ).rejects.toThrow("cannot be opened again");
    expect(
      (
        await payer.client.query(api.forumCommunity.getPayment, {
          intentId: intent.intentId,
        })
      ).status,
    ).toBe("opened");
  });
  test("opened/unknown payments remain held after expiry and cannot be substituted or replayed", async () => {
    const t = setup(),
      { payer, recipient } = await paymentActors(t),
      now = Date.now(),
      intent = await payer.client.mutation(api.forumCommunity.preparePayment, {
        wallet: payer.wallet,
        recipientId: recipient.userId,
        amountLamports: "1000000",
      });
    await payer.client.mutation(api.forumCommunity.markPaymentOpened, {
      intentId: intent.intentId,
    });
    await payer.client.mutation(internal.forumCommunity.claimPaymentCheck, {
      intentId: intent.intentId,
      signature: sig(1),
      lease: "first",
    });
    await payer.client.mutation(internal.forumCommunity.finishPaymentCheck, {
      intentId: intent.intentId,
      lease: "first",
      valid: false,
      issue: "receipt_unavailable",
      finalizedAt: null,
      slot: null,
    });
    vi.spyOn(Date, "now").mockReturnValue(
      now + COMMUNITY_PAYMENT_TTL_MS + 60000,
    );
    const duplicate = await payer.client.mutation(
      api.forumCommunity.preparePayment,
      {
        wallet: payer.wallet,
        recipientId: recipient.userId,
        amountLamports: "1000000",
      },
    );
    expect(duplicate.intentId).toBe(intent.intentId);
    expect(duplicate.status).toBe("held");
    await expect(
      payer.client.mutation(internal.forumCommunity.claimPaymentCheck, {
        intentId: intent.intentId,
        signature: sig(2),
        lease: "second",
      }),
    ).rejects.toThrow("saved signature");
    expect(
      (await payer.client.query(api.forumCommunity.listPayments, {}))[0]
        .signature,
    ).toBe(sig(1));
  });
  test("signature uniqueness prevents a receipt satisfying two intents", async () => {
    const t = setup(),
      { payer, recipient } = await paymentActors(t),
      recipient2 = await actor(t, 8);
    await recipient2.client.mutation(api.forumCommunity.setTipRecipient, {
      wallet: recipient2.wallet,
      accepting: true,
    });
    const a = await payer.client.mutation(api.forumCommunity.preparePayment, {
      wallet: payer.wallet,
      recipientId: recipient.userId,
      amountLamports: "1000000",
    });
    const b = await payer.client.mutation(api.forumCommunity.preparePayment, {
      wallet: payer.wallet,
      recipientId: recipient2.userId,
      amountLamports: "1000000",
    });
    await payer.client.mutation(api.forumCommunity.markPaymentOpened, {
      intentId: a.intentId,
    });
    await payer.client.mutation(api.forumCommunity.markPaymentOpened, {
      intentId: b.intentId,
    });
    await payer.client.mutation(internal.forumCommunity.claimPaymentCheck, {
      intentId: a.intentId,
      signature: sig(3),
      lease: "a",
    });
    await expect(
      payer.client.mutation(internal.forumCommunity.claimPaymentCheck, {
        intentId: b.intentId,
        signature: sig(3),
        lease: "b",
      }),
    ).rejects.toThrow("already bound");
  });
  test("a payout is marked paid only after exact internal finalized receipt acceptance", async () => {
    const t = setup(),
      { payer, recipient } = await paymentActors(t),
      workId = await payer.client.mutation(api.forumCommunity.createBounty, {
        kind: "bounty",
        title: "Build a reproducible tool",
        brief,
        amountLamports: "1000000",
      }),
      submissionId = await recipient.client.mutation(
        api.forumCommunity.claimBounty,
        {
          workId,
          url: "https://example.org/tool",
          summary:
            "A reproducible tool with documentation and a clear installation process.",
        },
      );
    await payer.client.mutation(api.forumCommunity.selectSubmission, {
      workId,
      submissionId,
    });
    const intent = await payer.client.mutation(
      api.forumCommunity.preparePayment,
      { wallet: payer.wallet, workId },
    );
    expect(intent.amountLamports).toBe("1000000");
    await payer.client.mutation(api.forumCommunity.markPaymentOpened, {
      intentId: intent.intentId,
    });
    await payer.client.mutation(internal.forumCommunity.claimPaymentCheck, {
      intentId: intent.intentId,
      signature: sig(4),
      lease: "reward",
    });
    await payer.client.mutation(internal.forumCommunity.finishPaymentCheck, {
      intentId: intent.intentId,
      lease: "reward",
      valid: true,
      issue: "finalized",
      finalizedAt: Date.now(),
      slot: 100,
    });
    expect(
      (await t.query(api.forumCommunity.listBounties, { status: "paid" }))[0]
        .status,
    ).toBe("paid");
    await expect(
      payer.client.mutation(api.forumCommunity.preparePayment, {
        wallet: payer.wallet,
        workId,
      }),
    ).rejects.toThrow("Select a deliverable");
  });
});
test("holder proof is private and opt-in; expiry removes public badge without changing fees", async () => {
  const t = setup(),
    a = await actor(t, 20),
    now = Date.now();
  await a.client.mutation(internal.forumCommunity.claimSupporterRefresh, {
    wallet: a.wallet,
  });
  await a.client.mutation(internal.forumCommunity.saveSupporterProof, {
    wallet: a.wallet,
    eligible: true,
    slot: 5,
  });
  expect(
    await t.query(api.forumCommunity.getPublicSupporter, {
      userId: a.userId,
      now,
    }),
  ).toBe(null);
  await a.client.mutation(api.forumCommunity.setSupporterVisibility, {
    optedIn: true,
  });
  const publicProof = await t.query(api.forumCommunity.getPublicSupporter, {
    userId: a.userId,
    now,
  });
  expect(publicProof).not.toHaveProperty("wallet");
  expect(publicProof).not.toHaveProperty("balance");
  expect(publicProof).not.toBe(null);
  expect(
    await t.query(api.forumCommunity.getPublicSupporter, {
      userId: a.userId,
      now: now + 11 * 60000,
    }),
  ).toBe(null);
  expect(
    (await a.client.query(api.forumCommunity.getMine, { now })).supporter
      ?.optedIn,
  ).toBe(true);
});
