/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerAuth } from "@convex-dev/better-auth/test";
import schema from "./schema";
import { api, components, internal } from "./_generated/api";
import { IDENTITY_MARKER } from "../lib/identity-config";
import { signedSwapFixture } from "../tests/fixtures/signed-swap";
import { inspectSignedSwap } from "../lib/swap-signed-wire";
import { commerceLimiter } from "./forumCommerce";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function fixture() {
  const t = convexTest(schema, modules);
  registerAuth(t);
  registerLimiter(t);
  const f = await signedSwapFixture(),
    now = Date.now();
  for (const [key, value] of Object.entries({
    BETTER_AUTH_ENABLED: "true",
    FORUM_SWAPS_ENABLED: "true",
    FORUM_SWAP_SIGNATURE_FIRST_ENABLED: "true",
    FORUM_SWAP_AUTORECOVERY_ENABLED: "true",
    FORUM_COMMERCE_TREASURY: f.wallet,
    FORUM_COMMERCE_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=fixture",
  }))
    vi.stubEnv(key, value);
  const native = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Reader",
          email: "reader@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  const session = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: native._id,
          token: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 86400000,
        },
      },
    }),
  );
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          userId: native._id,
          providerId: "solana",
          accountId: f.wallet,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name: "Reader" });
    await ctx.db.insert("betterAuthIdentityLinks", {
      authUserId: native._id,
      userId: id,
      linkedAt: now,
    });
    return id;
  });
  const row = {
    authUserId: native._id,
    userId,
    provider: "jupiter" as const,
    quoteJson: JSON.stringify({
      request: { inputMint: f.wallet, outputMint: f.wallet, amountRaw: "1" },
    }),
    treasury: f.wallet,
    createdAt: now,
    expiresAt: now + 25000,
    platformFeeBps: 0,
    status: "prepared" as const,
    ...f.prepared,
  };
  const quoteId = await t.run((ctx) => ctx.db.insert("forumSwapQuotes", row));
  const client = t.withIdentity({
    issuer: "https://convex.test",
    subject: native._id,
    authSystem: IDENTITY_MARKER,
    sessionId: session._id,
  });
  const args = { quoteId, signedTransactionBase64: f.signedTransactionBase64 };
  const binding = await inspectSignedSwap(
    f.signedTransactionBase64,
    f.prepared,
  );
  const ledger = () =>
    t.run((ctx) =>
      ctx.db
        .query("forumSwapSubmissions")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", quoteId))
        .unique(),
    );
  return { t, client, f, row, args, quoteId, binding, ledger };
}
test("registration saves and binds the signature before any submission and does no network IO", async () => {
  const x = await fixture(),
    fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    x.t.mutation(api.forumSwapSubmission.registerSigned, x.args),
  ).rejects.toThrow("Sign in");
  expect(
    await x.client.mutation(api.forumSwapSubmission.registerSigned, x.args),
  ).toEqual({ quoteId: x.quoteId, signature: x.binding.signature });
  expect(await x.ledger()).toMatchObject({
    signature: x.binding.signature,
    wireHash: x.binding.wireHash,
  });
  expect(
    await x.t.run((ctx) => ctx.db.get("forumSwapQuotes", x.quoteId)),
  ).toMatchObject({
    status: "submitted",
    signatureFirst: true,
    signature: x.binding.signature,
  });
  await x.client.mutation(api.forumSwapSubmission.registerSigned, x.args);
  expect(
    await x.t.run((ctx) => ctx.db.query("forumSwapSubmissions").take(3)),
  ).toHaveLength(1);
  expect(fetcher).not.toHaveBeenCalled();
  expect(JSON.stringify(await x.ledger())).not.toContain(
    x.args.signedTransactionBase64,
  );
});
test("parallel relay requests broadcast exactly once, after signature persistence, with safe options", async () => {
  const x = await fixture();
  await x.client.mutation(api.forumSwapSubmission.registerSigned, x.args);
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(await x.ledger()).toMatchObject({
      signature: x.binding.signature,
      attemptedAt: expect.any(Number),
    });
    const body = JSON.parse(String(init?.body));
    expect(body.method).toBe("sendTransaction");
    expect(body.params).toEqual([
      x.args.signedTransactionBase64,
      {
        encoding: "base64",
        skipPreflight: false,
        maxRetries: 0,
        preflightCommitment: "confirmed",
        minContextSlot: 200,
      },
    ]);
    return Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: x.binding.signature,
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      x.client.action(api.forumSwapSubmission.relay, x.args),
    ),
  );
  expect(results.every((r) => r.signature === x.binding.signature)).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await x.ledger()).toMatchObject({ rpcState: "accepted" });
  expect(
    await x.client.mutation(api.forumSwapSubmission.cancelUnsubmitted, {
      quoteId: x.quoteId,
    }),
  ).toBe(false);
});
test("RPC timeout retains the known signature and permanently consumes the submission claim", async () => {
  const x = await fixture();
  await x.client.mutation(api.forumSwapSubmission.registerSigned, x.args);
  const fetcher = vi.fn(async () => {
    throw Error("private RPC body");
  });
  vi.stubGlobal("fetch", fetcher);
  const first = await x.client.action(api.forumSwapSubmission.relay, x.args);
  await x.client.action(api.forumSwapSubmission.relay, x.args);
  expect(first.signature).toBe(x.binding.signature);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await x.ledger()).toMatchObject({ rpcState: "unknown" });
  expect(
    await x.client.mutation(api.forumSwapSubmission.cancelUnsubmitted, {
      quoteId: x.quoteId,
    }),
  ).toBe(false);
});
test("unattempted registration can be atomically cancelled but cannot subsequently submit", async () => {
  const x = await fixture();
  await x.client.mutation(api.forumSwapSubmission.registerSigned, x.args);
  expect(
    await x.client.mutation(api.forumSwapSubmission.cancelUnsubmitted, {
      quoteId: x.quoteId,
    }),
  ).toBe(true);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    x.client.action(api.forumSwapSubmission.relay, x.args),
  ).rejects.toThrow("expired or paused");
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await x.t.run((ctx) => ctx.db.get("forumSwapQuotes", x.quoteId)),
  ).toMatchObject({ status: "failed", issue: "app_submission_not_started" });
});
test("cannot register altered signed bytes or bypass an old uncertain hold", async () => {
  const x = await fixture(),
    other = await signedSwapFixture();
  await expect(
    x.client.mutation(api.forumSwapSubmission.registerSigned, {
      ...x.args,
      signedTransactionBase64: other.signedTransactionBase64,
    }),
  ).rejects.toThrow("did not match");
  await x.t.run((ctx) =>
    ctx.db.patch("forumSwapQuotes", x.quoteId, {
      status: "held",
      issue: "wallet_outcome_unknown",
    }),
  );
  const before = await x.t.run((ctx) =>
    ctx.db.get("forumSwapQuotes", x.quoteId),
  );
  expect(
    await x.client.mutation(api.forumSwapSubmission.cancelUnsubmitted, {
      quoteId: x.quoteId,
    }),
  ).toBe(false);
  await expect(
    x.client.mutation(api.forumSwapSubmission.registerSigned, x.args),
  ).rejects.toThrow("expired or already used");
  expect(
    await x.t.run((ctx) => ctx.db.get("forumSwapQuotes", x.quoteId)),
  ).toEqual(before);
});
test("a claimed/crashed relay cannot be reclaimed, even without an RPC result", async () => {
  const x = await fixture();
  await x.client.mutation(api.forumSwapSubmission.registerSigned, x.args);
  const claim = {
    quoteId: x.quoteId,
    signature: x.binding.signature,
    wireHash: x.binding.wireHash,
  };
  expect(
    await x.client.mutation(internal.forumSwapSubmission.claimRelay, claim),
  ).toBe(true);
  expect(
    await x.client.mutation(internal.forumSwapSubmission.claimRelay, claim),
  ).toBe(false);
  expect(
    await x.client.mutation(api.forumSwapSubmission.cancelUnsubmitted, {
      quoteId: x.quoteId,
    }),
  ).toBe(false);
});
test("manual receipt checks cannot bypass two-provider recovery or change a signed operation", async () => {
  const x = await fixture();
  await x.client.mutation(api.forumSwapSubmission.registerSigned, x.args);
  const before = await x.t.run((ctx) =>
    ctx.db.get("forumSwapQuotes", x.quoteId),
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(
    await x.client.action(api.forumSwaps.confirm, {
      quoteId: x.quoteId,
      signature: x.binding.signature,
    }),
  ).toMatchObject({ status: "submitted", signature: x.binding.signature });
  await expect(
    x.client.mutation(internal.forumSwaps.settle, {
      quoteId: x.quoteId,
      signature: x.binding.signature,
      verified: true,
      issue: "",
    }),
  ).rejects.toThrow("independent recovery evidence");
  expect(
    await x.t.run((ctx) => ctx.db.get("forumSwapQuotes", x.quoteId)),
  ).toEqual(before);
  expect(fetcher).not.toHaveBeenCalled();
});
test("a cancelled registration that outlives the browser is closed after expiry with no network IO", async () => {
  const x = await fixture();
  await x.client.mutation(api.forumSwapSubmission.registerSigned, x.args);
  await x.t.run(async (ctx) => {
    await ctx.db.patch("forumSwapQuotes", x.quoteId, {
      expiresAt: Date.now() - 1,
    });
    const job = await ctx.db
      .query("forumSwapRecoveries")
      .withIndex("by_quoteId", (q) => q.eq("quoteId", x.quoteId))
      .unique();
    await ctx.db.patch("forumSwapRecoveries", job!._id, {
      nextCheckAt: Date.now() - 1,
    });
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await x.t.action(internal.forumSwapRecovery.check, { quoteId: x.quoteId });
  expect(
    await x.t.run((ctx) => ctx.db.get("forumSwapQuotes", x.quoteId)),
  ).toMatchObject({ status: "failed", issue: "app_submission_not_started" });
  expect(fetcher).not.toHaveBeenCalled();
});
test("relay and cancellation share an atomic fence; only one can authorize the outcome", async () => {
  const x = await fixture();
  await x.client.mutation(api.forumSwapSubmission.registerSigned, x.args);
  const [cancel, claim] = await Promise.allSettled([
    x.client.mutation(api.forumSwapSubmission.cancelUnsubmitted, {
      quoteId: x.quoteId,
    }),
    x.client.mutation(internal.forumSwapSubmission.claimRelay, {
      quoteId: x.quoteId,
      signature: x.binding.signature,
      wireHash: x.binding.wireHash,
    }),
  ]);
  expect(cancel.status).toBe("fulfilled");
  if (cancel.status === "fulfilled" && cancel.value) {
    expect(claim.status).toBe("rejected");
    expect((await x.ledger())!.attemptedAt).toBeUndefined();
  } else {
    expect(claim).toMatchObject({ status: "fulfilled", value: true });
    expect((await x.ledger())!.attemptedAt).toEqual(expect.any(Number));
  }
});
test("cross-owner and unauthenticated callers cannot register, cancel or relay", async () => {
  const x = await fixture();
  await x.client.mutation(api.forumSwapSubmission.registerSigned, x.args);
  await expect(
    x.t.action(api.forumSwapSubmission.relay, x.args),
  ).rejects.toThrow("Sign in");
  await x.t.run((ctx) =>
    ctx.db.patch("forumSwapQuotes", x.quoteId, {
      authUserId: "different-owner",
    }),
  );
  await expect(
    x.client.mutation(api.forumSwapSubmission.registerSigned, x.args),
  ).rejects.toThrow("not found");
  await expect(
    x.client.mutation(api.forumSwapSubmission.cancelUnsubmitted, {
      quoteId: x.quoteId,
    }),
  ).rejects.toThrow("not found");
  await expect(
    x.client.action(api.forumSwapSubmission.relay, x.args),
  ).rejects.toThrow("not found");
  expect((await x.ledger())!.attemptedAt).toBeUndefined();
});
test("an exhausted daily budget cannot claim or send a relay; unattempted cancellation remains available", async () => {
  const x = await fixture();
  await x.client.mutation(api.forumSwapSubmission.registerSigned, x.args);
  await x.t.run((ctx) =>
    commerceLimiter.limit(ctx, "commerceNetworkDaily", {
      key: "all",
      count: 1000,
    }),
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    x.client.action(api.forumSwapSubmission.relay, x.args),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  expect((await x.ledger())!.attemptedAt).toBeUndefined();
  expect(
    await x.client.mutation(api.forumSwapSubmission.cancelUnsubmitted, {
      quoteId: x.quoteId,
    }),
  ).toBe(true);
});
test("signature-first switch fails closed while historical receipt/recovery remain separate", async () => {
  const x = await fixture();
  vi.stubEnv("FORUM_SWAP_SIGNATURE_FIRST_ENABLED", "false");
  await expect(
    x.client.mutation(api.forumSwapSubmission.registerSigned, x.args),
  ).rejects.toThrow("unavailable");
  expect(await x.ledger()).toBeNull();
  vi.stubEnv("FORUM_SWAP_SIGNATURE_FIRST_ENABLED", "true");
  await expect(
    x.client.mutation(api.forumSwaps.beginWalletRequest, {
      quoteId: x.quoteId,
    }),
  ).rejects.toThrow("Refresh the page");
});

test("managed execute is bound to the saved order, invoked once, and never uses sendTransaction", async () => {
  const x = await fixture();
  vi.stubEnv("FORUM_SWAP_MANAGED_ENABLED", "true");
  vi.stubEnv("FORUM_PLATFORM_FEE_BPS", "50");
  vi.stubEnv("JUPITER_API_KEY", "fixture");
  vi.stubEnv("JUPITER_REFERRAL_ACCOUNT", x.f.wallet);
  await x.t.run((ctx) =>
    ctx.db.patch("forumSwapQuotes", x.quoteId, {
      execution: "jupiter-managed",
      platformFeeBps: 50,
      quoteJson: JSON.stringify({
        execution: "jupiter-managed",
        opaque: { requestId: "saved-managed-order" },
      }),
    }),
  );
  const fetcher = vi.fn(async () =>
    Response.json({
      status: "Success",
      code: 0,
      signature: x.binding.signature,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  await x.client.mutation(api.forumSwapSubmission.registerSigned, x.args);
  await Promise.all([
    x.client.action(api.forumSwapSubmission.relay, x.args),
    x.client.action(api.forumSwapSubmission.relay, x.args),
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.jup.ag/swap/v2/execute",
    expect.objectContaining({
      body: JSON.stringify({
        requestId: "saved-managed-order",
        signedTransaction: x.args.signedTransactionBase64,
      }),
    }),
  );
  const row = await x.t.run((ctx) => ctx.db.get("forumSwapQuotes", x.quoteId));
  expect(row?.status).toBe("submitted"); // Managed API success is not a finalized independent receipt.
  expect((await x.ledger())?.rpcState).toBe("accepted");
  expect(
    await x.client.mutation(api.forumSwapSubmission.cancelUnsubmitted, {
      quoteId: x.quoteId,
    }),
  ).toBe(false);
});

test("activation cannot convert an old prepared transaction into a managed order", async () => {
  const x = await fixture();
  vi.stubEnv("FORUM_SWAP_MANAGED_ENABLED", "true");
  vi.stubEnv("FORUM_PLATFORM_FEE_BPS", "50");
  vi.stubEnv("JUPITER_API_KEY", "fixture");
  vi.stubEnv("JUPITER_REFERRAL_ACCOUNT", x.f.wallet);
  await expect(
    x.client.mutation(api.forumSwapSubmission.registerSigned, x.args),
  ).rejects.toThrow("unavailable");
  expect(await x.ledger()).toBeNull();
  expect(
    (await x.t.run((ctx) => ctx.db.get("forumSwapQuotes", x.quoteId)))?.status,
  ).toBe("prepared");
});
