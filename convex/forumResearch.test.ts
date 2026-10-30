/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { register as registerBetterAuth } from "@convex-dev/better-auth/test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { makeFunctionReference } from "convex/server";
import { getBase58Decoder } from "@solana/kit";
import schema from "./schema";
import { components } from "./_generated/api";
import { IDENTITY_MARKER } from "../lib/identity-config";
import {
  buildResearchReport,
  researchRequirements,
  researchResource,
  RESEARCH_PRODUCT,
} from "../lib/forum-research";

const modules = import.meta.glob("./**/*.ts"),
  issuer = "https://strong-bee-384.convex.site";
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(`forumResearch:${name}`);
const query = (name: string) =>
  makeFunctionReference<"query">(`forumResearch:${name}`);
beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", issuer);
  vi.stubEnv("BETTER_AUTH_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function setup() {
  const t = convexTest(schema, modules);
  registerBetterAuth(t);
  registerLimiter(t);
  return t;
}
type Test = ReturnType<typeof setup>;
const key = (n: number) =>
  getBase58Decoder().decode(new Uint8Array(32).fill(n));
async function actor(t: Test, n: number) {
  const now = Date.now(),
    wallet = key(n);
  const native = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: `Research ${n}`,
          email: `research${n}@example.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: `Research ${n}`,
      role: "reader",
    });
    await ctx.db.insert("betterAuthIdentityLinks", {
      authUserId: native._id,
      userId,
      linkedAt: now,
    });
    return userId;
  });
  const session = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: native._id,
          token: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 86_400_000,
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
          accountId: wallet,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  return {
    wallet,
    userId,
    client: t.withIdentity({
      issuer,
      subject: native._id,
      authSystem: IDENTITY_MARKER,
      sessionId: session._id,
    }),
  };
}
async function seed(
  t: Test,
  a: Awaited<ReturnType<typeof actor>>,
  intentKey = "a".repeat(64),
  expired = false,
) {
  const now = Date.now(),
    requirements = researchRequirements(intentKey, key(99));
  return await t.run(async (ctx) => {
    if (
      !(await ctx.db
        .query("forumResearchControl")
        .withIndex("by_key", (q) => q.eq("key", "x402-research-v1"))
        .unique())
    )
      await ctx.db.insert("forumResearchControl", {
        key: "x402-research-v1",
        enabled: true,
        feePayer: key(99),
        recipientAta: key(98),
        verifiedAt: now,
        creditLimit: 2,
        creditsReserved: 0,
        creditEvidence: "provider-dashboard-verified",
        updatedAt: now,
      });
    return await ctx.db.insert("forumResearchIntents", {
      intentKey,
      ownerUserId: a.userId,
      wallet: a.wallet,
      mint: a.wallet,
      idempotencyKey: intentKey,
      product: RESEARCH_PRODUCT,
      resource: researchResource(intentKey),
      method: "GET",
      bodyHash: "b".repeat(64),
      requirements: requirements as {
        scheme: "exact";
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
        asset: string;
        amount: "100000";
        payTo: string;
        maxTimeoutSeconds: number;
        extra: {
          feePayer: string;
          memo: string;
          transactionVersions: number[];
        };
      },
      requirementsHash: "c".repeat(64),
      report: buildResearchReport({
        mint: a.wallet,
        name: "Example",
        symbol: "EX",
        metricsAsOf: now,
        generatedAt: now,
        priceUsd: 1,
        marketCapUsd: 100_000,
        liquidityUsd: 10_000,
        volume1hUsd: 2000,
        holders: 100,
        priceChange1hPercent: 1,
        sourceUrl: `https://pump.fun/coin/${a.wallet}`,
        threadUrl: "https://forum.symbaiex.com/crypto-pumpfun/example",
      }),
      state: "quoted",
      createdAt: now,
      expiresAt: expired ? now - 1 : now + 300_000,
      updatedAt: now,
      sdkReads: 0,
      simulationHash: "d".repeat(64),
      simulationAt: now,
    });
  });
}
test("private reports and receipts cannot cross owner boundaries", async () => {
  const t = setup(),
    a = await actor(t, 10),
    b = await actor(t, 11),
    intentKey = "a".repeat(64);
  await seed(t, a);
  await expect(t.query(query("status"), { intentKey })).rejects.toThrow(
    "Sign in",
  );
  await expect(b.client.query(query("status"), { intentKey })).rejects.toThrow(
    "unavailable",
  );
  expect(
    (await a.client.query(query("status"), { intentKey })).report,
  ).toBeNull();
});
test("duplicate approval and settlement claims consume one permanent credit reservation", async () => {
  const t = setup(),
    a = await actor(t, 12),
    intentKey = "a".repeat(64);
  await seed(t, a);
  const args = {
    intentKey,
    payloadHash: "e".repeat(64),
    messageHash: "d".repeat(64),
  };
  expect(await a.client.mutation(mutation("claimPayment"), args)).toBe(true);
  expect(await a.client.mutation(mutation("claimPayment"), args)).toBe(false);
  const settle = { intentKey, payloadHash: args.payloadHash, payer: a.wallet };
  expect(await a.client.mutation(mutation("claimSettlement"), settle)).toBe(
    true,
  );
  expect(await a.client.mutation(mutation("claimSettlement"), settle)).toBe(
    false,
  );
  await a.client.mutation(mutation("finish"), {
    intentKey,
    payloadHash: args.payloadHash,
    state: "unknown",
  });
  await a.client.mutation(mutation("finish"), {
    intentKey,
    payloadHash: args.payloadHash,
    state: "rejected",
  });
  expect((await a.client.query(query("status"), { intentKey })).state).toBe(
    "unknown",
  );
  expect(await a.client.mutation(mutation("claimPayment"), args)).toBe(false);
  expect(
    await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("forumResearchControl")
            .withIndex("by_key", (q) => q.eq("key", "x402-research-v1"))
            .unique()
        )?.creditsReserved,
    ),
  ).toBe(2);
});
test("expired or changed simulated message never reaches settlement claim", async () => {
  const t = setup(),
    a = await actor(t, 13),
    intentKey = "a".repeat(64);
  await seed(t, a, intentKey, true);
  expect(
    await a.client.mutation(mutation("claimPayment"), {
      intentKey,
      payloadHash: "e".repeat(64),
      messageHash: "d".repeat(64),
    }),
  ).toBe(false);
  expect((await a.client.query(query("status"), { intentKey })).state).toBe(
    "expired",
  );
  const other = "b".repeat(64);
  await seed(t, a, other);
  await expect(
    a.client.mutation(mutation("claimPayment"), {
      intentKey: other,
      payloadHash: "e".repeat(64),
      messageHash: "f".repeat(64),
    }),
  ).rejects.toThrow("fresh research");
  expect(
    (await a.client.query(query("status"), { intentKey: other })).state,
  ).toBe("quoted");
});
test("known settlement signature is saved before finality and its bound callback survives logout without authorizing a replay", async () => {
  const t = setup(),
    a = await actor(t, 16),
    intentKey = "a".repeat(64),
    payloadHash = "e".repeat(64);
  await seed(t, a);
  await a.client.mutation(mutation("claimPayment"), {
    intentKey,
    payloadHash,
    messageHash: "d".repeat(64),
  });
  await a.client.mutation(mutation("claimSettlement"), {
    intentKey,
    payloadHash,
    payer: a.wallet,
  });
  const signature = getBase58Decoder().decode(new Uint8Array(64).fill(17));
  await expect(
    t.mutation(mutation("saveSettlementSignature"), {
      intentKey,
      payloadHash: "wrong",
      signature,
    }),
  ).rejects.toThrow("binding");
  // Internal receipt recording uses a claimed payload, not a fresh human session.
  await t.mutation(mutation("saveSettlementSignature"), {
    intentKey,
    payloadHash,
    signature,
  });
  const receipt = await a.client.query(query("status"), { intentKey });
  expect(receipt).toMatchObject({
    state: "unknown",
    signature,
    report: null,
  });
  await t.mutation(mutation("finish"), {
    intentKey,
    payloadHash,
    state: "unknown",
  });
  expect(
    await a.client.mutation(mutation("claimPayment"), {
      intentKey,
      payloadHash,
      messageHash: "d".repeat(64),
    }),
  ).toBe(false);
});
test("exhausted initial credits disable new approvals without releasing historical holds", async () => {
  const t = setup(),
    a = await actor(t, 15),
    intentKey = "a".repeat(64);
  await seed(t, a);
  await t.run(async (ctx) => {
    const control = await ctx.db
      .query("forumResearchControl")
      .withIndex("by_key", (q) => q.eq("key", "x402-research-v1"))
      .unique();
    await ctx.db.patch("forumResearchControl", control!._id, {
      creditsReserved: 2,
    });
  });
  expect((await t.query(query("getConfig"), { now: Date.now() })).enabled).toBe(
    false,
  );
  await expect(
    a.client.mutation(mutation("claimPayment"), {
      intentKey,
      payloadHash: "e".repeat(64),
      messageHash: "d".repeat(64),
    }),
  ).rejects.toThrow("paused");
  expect((await a.client.query(query("status"), { intentKey })).state).toBe(
    "quoted",
  );
});
test("SDK preparation reads are bounded and the initial credit cap cannot be raised", async () => {
  const t = setup(),
    a = await actor(t, 14),
    intentKey = "a".repeat(64);
  await seed(t, a);
  for (let n = 0; n < 3; n++)
    await a.client.mutation(mutation("claimRead"), {
      intentKey,
      purpose: "sdk",
    });
  await expect(
    a.client.mutation(mutation("claimRead"), { intentKey, purpose: "sdk" }),
  ).rejects.toThrow("consumed");
  await expect(
    t.mutation(mutation("configureReadiness"), {
      enabled: true,
      creditLimit: 3,
      feePayer: key(99),
      recipientAta: key(98),
      verifiedAt: Date.now(),
      creditEvidence: "provider-dashboard-verified",
    }),
  ).rejects.toThrow("cannot be increased");
});
