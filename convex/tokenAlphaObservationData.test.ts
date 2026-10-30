/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import type { TokenPlatform, TokenSnapshot } from "../lib/token-alpha";
import { internal } from "./_generated/api";
import type { ObservationClaim } from "./tokenAlphaObservationData";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const NOW = Date.parse("2026-10-30T19:12:00Z");
const MINT = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";
const claim = makeFunctionReference<
  "mutation",
  { platform: TokenPlatform; claimToken: string },
  ObservationClaim
>("tokenAlphaObservationData:claim");
const complete = makeFunctionReference<
  "mutation",
  { runKey: string; claimToken: string; snapshots: TokenSnapshot[] },
  boolean
>("tokenAlphaObservationData:complete");
const fail = makeFunctionReference<
  "mutation",
  { runKey: string; claimToken: string; reason: string },
  null
>("tokenAlphaObservationData:fail");

async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const infrastructure = await t.mutation(
    internal.tokenAlphaData.ensureInfrastructure,
    {},
  );
  await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: true });
  return {
    t,
    agent: infrastructure.agents.find((a) => a.platform === "bags")!,
  };
}
function snapshot(overrides: Partial<TokenSnapshot> = {}): TokenSnapshot {
  return {
    platform: "bags",
    mint: MINT,
    name: "Sample",
    symbol: "SAMPLE",
    observedAt: NOW,
    metricsAsOf: NOW,
    priceUsd: 0.001,
    marketCapUsd: 75_000,
    holders: 123,
    volume1hUsd: 5000,
    liquidityUsd: 15_000,
    priceChange1hPercent: 3,
    imageUrl: null,
    website: null,
    twitter: null,
    telegram: null,
    description: null,
    sourceUrl: `https://www.solanatracker.io/token/${MINT}`,
    sourceRank: 1,
    ...overrides,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("unknown model holds and failed model health do not starve source observation or authorize generation", async () => {
  const { t } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("elizaRuntimeOperations", {
      operationKey: "bags:2026-10-23T12",
      status: "unknown",
      jobId: "old-unknown",
      inputHash: "old-hash",
      updatedAt: NOW - 1000,
    });
  });
  const holdsBefore = await t.run((ctx) =>
    ctx.db
      .query("elizaRuntimeOperations")
      .withIndex("by_status_and_operationKey", (q) => q.eq("status", "unknown"))
      .take(10),
  );
  const admission = await t.mutation(claim, {
    platform: "bags",
    claimToken: "source-1",
  });
  expect(admission.state).toBe("claimed");
  expect(
    await t.mutation(complete, {
      runKey: admission.runKey,
      claimToken: "source-1",
      snapshots: [snapshot()],
    }),
  ).toBe(true);
  expect(
    await t.mutation(internal.tokenAlphaData.claimRun, {
      platform: "bags",
      claimToken: "model-1",
    }),
  ).toBeNull();
  const after = await t.run(async (ctx) => ({
    markets: await ctx.db
      .query("forumTerminalMarkets")
      .withIndex("by_mint", (q) => q.eq("mint", MINT))
      .take(2),
    holds: await ctx.db
      .query("elizaRuntimeOperations")
      .withIndex("by_status_and_operationKey", (q) => q.eq("status", "unknown"))
      .take(10),
    calls: await ctx.db
      .query("elizaRuntimeCalls")
      .withIndex("by_agentSlug_and_createdAt", (q) =>
        q.eq("agentSlug", "bags-scout"),
      )
      .take(10),
  }));
  expect(after.markets).toHaveLength(1);
  expect(after.markets[0].snapshot).toEqual(snapshot());
  expect(after.holds).toEqual(holdsBefore);
  expect(after.calls).toEqual([]);
});

test("concurrent duplicate source claims admit one permanent intent", async () => {
  const { t } = await setup();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      t.mutation(claim, { platform: "bags", claimToken: `source-${i}` }),
    ),
  );
  expect(results.filter((r) => r.state === "claimed")).toHaveLength(1);
  expect(results.filter((r) => r.state === "unavailable")).toHaveLength(19);
});

test("completed exact snapshots are reused without rewriting observation times", async () => {
  const { t } = await setup();
  const first = await t.mutation(claim, {
    platform: "bags",
    claimToken: "source-1",
  });
  await t.mutation(complete, {
    runKey: first.runKey,
    claimToken: "source-1",
    snapshots: [snapshot()],
  });
  vi.setSystemTime(NOW + 60_000);
  expect(
    await t.mutation(claim, { platform: "bags", claimToken: "source-2" }),
  ).toEqual({ runKey: first.runKey, state: "ready", snapshots: [snapshot()] });
});

test("failed and abandoned source intents never reopen in their hour", async () => {
  const { t } = await setup();
  const first = await t.mutation(claim, {
    platform: "bags",
    claimToken: "source-1",
  });
  await t.mutation(fail, {
    runKey: first.runKey,
    claimToken: "source-1",
    reason: "token-source-rankings-failed:http-429",
  });
  expect(
    (await t.mutation(claim, { platform: "bags", claimToken: "source-2" }))
      .state,
  ).toBe("unavailable");
  vi.setSystemTime(NOW + 60 * 60_000);
  expect(
    (await t.mutation(claim, { platform: "bags", claimToken: "next-hour" }))
      .state,
  ).toBe("claimed");
  vi.setSystemTime(NOW + 60 * 60_000 + 31 * 60_000);
  expect(
    (await t.mutation(claim, { platform: "bags", claimToken: "expired-lease" }))
      .state,
  ).toBe("unavailable");
});

test.each(["pilot", "agent", "identity"] as const)(
  "%s pause denies observation",
  async (kind) => {
    const { t, agent } = await setup();
    if (kind === "pilot")
      await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: false });
    if (kind === "agent")
      await t.run((ctx) =>
        ctx.db.patch("forumAgents", agent.agentId, { enabled: false }),
      );
    if (kind === "identity")
      await t.run((ctx) =>
        ctx.db.patch("users", agent.userId, {
          agentStatus: "revoked",
          agentRevokedAt: NOW,
        }),
      );
    expect(
      (await t.mutation(claim, { platform: "bags", claimToken: "source" }))
        .state,
    ).toBe("unavailable");
  },
);

test("revocation after fetch prevents projection, and a different lease cannot complete or fail", async () => {
  const { t, agent } = await setup();
  const first = await t.mutation(claim, {
    platform: "bags",
    claimToken: "source-1",
  });
  expect(
    await t.mutation(complete, {
      runKey: first.runKey,
      claimToken: "wrong-lease",
      snapshots: [snapshot()],
    }),
  ).toBe(false);
  await t.mutation(fail, {
    runKey: first.runKey,
    claimToken: "wrong-lease",
    reason: "token-source-rankings-failed",
  });
  await t.run((ctx) =>
    ctx.db.patch("forumAgents", agent.agentId, { enabled: false }),
  );
  expect(
    await t.mutation(complete, {
      runKey: first.runKey,
      claimToken: "source-1",
      snapshots: [snapshot()],
    }),
  ).toBe(false);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("forumTerminalMarkets")
        .withIndex("by_mint", (q) => q.eq("mint", MINT))
        .take(1),
    ),
  ).toEqual([]);
});

test.each([
  { metricsAsOf: NOW - 15 * 60_000 - 1 },
  { observedAt: NOW + 60_001 },
  { priceUsd: NaN },
  { platform: "pumpfun" as const },
  { mint: "invalid" },
  { sourceUrl: "https://attacker.invalid" },
])("invalid/stale snapshot is rejected atomically: %j", async (override) => {
  const { t } = await setup();
  const first = await t.mutation(claim, {
    platform: "bags",
    claimToken: "source-1",
  });
  await expect(
    t.mutation(complete, {
      runKey: first.runKey,
      claimToken: "source-1",
      snapshots: [snapshot(override)],
    }),
  ).rejects.toThrow("Invalid source observation");
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("forumTerminalMarkets")
        .withIndex("by_mint", (q) => q.eq("mint", MINT))
        .take(1),
    ),
  ).toEqual([]);
  expect(
    (await t.mutation(claim, { platform: "bags", claimToken: "source-2" }))
      .state,
  ).toBe("unavailable");
});

test("duplicates and oversized candidate sets are rejected before any projection", async () => {
  const { t } = await setup();
  const first = await t.mutation(claim, {
    platform: "bags",
    claimToken: "source-1",
  });
  for (const snapshots of [
    [snapshot(), snapshot()],
    Array.from({ length: 6 }, () => snapshot()),
  ])
    await expect(
      t.mutation(complete, {
        runKey: first.runKey,
        claimToken: "source-1",
        snapshots,
      }),
    ).rejects.toThrow("Invalid source observation");
});

test("pre-cutover ordinary run occupancy fences another source purchase", async () => {
  const { t } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("tokenAlphaRuns", {
      runKey: "bags:2026-10-30T19",
      platform: "bags",
      claimToken: "old-claim",
      status: "failed",
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: NOW + 60_000,
    }),
  );
  expect(
    (await t.mutation(claim, { platform: "bags", claimToken: "new-source" }))
      .state,
  ).toBe("unavailable");
});

test("expired completed samples stay unchanged and cannot authorize a same-hour refetch", async () => {
  const { t } = await setup();
  const first = await t.mutation(claim, {
    platform: "bags",
    claimToken: "source-1",
  });
  await t.mutation(complete, {
    runKey: first.runKey,
    claimToken: "source-1",
    snapshots: [snapshot()],
  });
  vi.setSystemTime(NOW + 16 * 60_000);
  expect(
    (await t.mutation(claim, { platform: "bags", claimToken: "source-2" }))
      .state,
  ).toBe("unavailable");
  const rows = await t.run((ctx) =>
    ctx.db
      .query("forumTerminalMarkets")
      .withIndex("by_mint", (q) => q.eq("mint", MINT))
      .take(2),
  );
  expect(rows[0].snapshot.metricsAsOf).toBe(NOW);
  expect(rows[0].snapshot.observedAt).toBe(NOW);
});

test("a downstream projection failure rolls back the receipt and every earlier row", async () => {
  const { t } = await setup();
  const first = await t.mutation(claim, {
    platform: "bags",
    claimToken: "source-1",
  });
  const otherMint = "So11111111111111111111111111111111111111112";
  const other = snapshot({
    mint: otherMint,
    sourceRank: 2,
    sourceUrl: `https://www.solanatracker.io/token/${otherMint}`,
  });
  // Simulate a corrupted downstream unique binding after the first candidate.
  await t.run(async (ctx) => {
    for (let i = 0; i < 2; i++)
      await ctx.db.insert("forumTerminalMarkets", {
        mint: otherMint,
        platform: "bags",
        band: "50k100k",
        observedAt: NOW,
        snapshot: other,
      });
  });
  await expect(
    t.mutation(complete, {
      runKey: first.runKey,
      claimToken: "source-1",
      snapshots: [snapshot(), other],
    }),
  ).rejects.toThrow();
  const state = await t.run(async (ctx) => ({
    receipt: await ctx.db
      .query("tokenAlphaObservations")
      .withIndex("by_runKey", (q) => q.eq("runKey", first.runKey))
      .unique(),
    firstMint: await ctx.db
      .query("forumTerminalMarkets")
      .withIndex("by_mint", (q) => q.eq("mint", MINT))
      .take(2),
  }));
  expect(state.receipt?.status).toBe("running");
  expect(state.receipt?.snapshots).toBeUndefined();
  expect(state.firstMint).toEqual([]);
});
