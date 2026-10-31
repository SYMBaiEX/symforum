/// <reference types="vite/client" />
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { getBase58Decoder } from "@solana/kit";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TokenSnapshot } from "../lib/token-alpha";
import type { TerminalMarketRefreshResult } from "../lib/forum-terminal-model";
import { classifyMarketCap } from "../lib/forum-market-cap";
import {
  MARKET_REFRESH_WINDOW_MS,
  parseMarketRefresh,
  type RefreshedMarket,
} from "../lib/terminal-market-refresh-source";
import { SYMF_TOKEN } from "../lib/symf-token";
import { api } from "./_generated/api";
import { commerceLimiter } from "./forumCommerce";
import { marketReadLimiter } from "./forumMarketData";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.parse("2026-10-31T02:05:00Z");
const MINT = SYMF_TOKEN.mint;
const BAGS = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";
type Claim = TerminalMarketRefreshResult & { fetch: boolean; mints: string[] };
const claim = makeFunctionReference<"mutation", { lease: string }, Claim>(
  "forumTerminalRefresh:claim",
);
const complete = makeFunctionReference<
  "mutation",
  { lease: string; checkedAt: number; quotes: RefreshedMarket[] | null },
  TerminalMarketRefreshResult | null
>("forumTerminalRefresh:complete");
const refresh = makeFunctionReference<
  "action",
  Record<string, never>,
  TerminalMarketRefreshResult
>("forumTerminalRefresh:refresh");
function setup() {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  return t;
}
function snapshot(
  mint = MINT,
  platform: "bags" | "pumpfun" = "pumpfun",
  observedAt = NOW - 3_600_000,
): TokenSnapshot {
  return {
    platform,
    mint,
    name: "Sample",
    symbol: "EX",
    observedAt,
    metricsAsOf: observedAt,
    priceUsd: 1,
    marketCapUsd: 75_000,
    holders: 123,
    volume1hUsd: 500,
    liquidityUsd: 5_000,
    priceChange1hPercent: 1,
    imageUrl: null,
    website: null,
    twitter: null,
    telegram: null,
    description: null,
    sourceUrl: `https://www.solanatracker.io/token/${mint}`,
    sourceRank: 3,
  };
}
async function seed(t: ReturnType<typeof setup>, sample = snapshot()) {
  return t.run((ctx) =>
    ctx.db.insert("forumTerminalMarkets", {
      mint: sample.mint,
      platform: sample.platform,
      band: classifyMarketCap(sample.marketCapUsd),
      observedAt: sample.observedAt,
      snapshot: sample,
    }),
  );
}
function pair(mint = MINT, cap: number | null = 750_000) {
  return {
    chainId: "solana",
    pairAddress: SYMF_TOKEN.pool,
    baseToken: { address: mint },
    quoteToken: { address: "So11111111111111111111111111111111111111112" },
    priceUsd: "2.5",
    marketCap: cap,
    fdv: 900_000,
    liquidity: { usd: 10_000 },
    volume: { h1: 1_000, h24: 20_000 },
    priceChange: { h1: -2.5 },
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("200 concurrent viewers admit one shared transport and reserve exactly one existing-budget unit", async () => {
  const t = setup();
  await seed(t);
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([pair()])),
  );
  vi.stubGlobal("fetch", fetcher);
  const results = await Promise.all(
    Array.from({ length: 200 }, () => t.action(refresh, {})),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]?.[0])).toBe(
    `https://api.dexscreener.com/tokens/v1/solana/${MINT}`,
  );
  expect(results.some((result) => result.state === "ready")).toBe(true);
  expect(
    await t.run((ctx) => ctx.db.query("forumMarketSampleCache").take(2)),
  ).toHaveLength(1);
  expect(
    await t.run((ctx) =>
      marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: 99,
      }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await t.run((ctx) =>
      marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: 100,
      }),
    ),
  ).toMatchObject({ ok: false });
  expect(
    await t.run((ctx) =>
      commerceLimiter.check(ctx, "commerceNetworkDaily", {
        key: "all",
        count: 999,
      }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await t.run((ctx) =>
      commerceLimiter.check(ctx, "commerceNetworkDaily", {
        key: "all",
        count: 1000,
      }),
    ),
  ).toMatchObject({ ok: false });
});

test("known pre-I/O burst deferral spends no daily units and can later admit once", async () => {
  const t = setup();
  await seed(t);
  await t.run((ctx) =>
    marketReadLimiter.limit(ctx, "terminalMarketBurst", { key: "all" }),
  );
  const fetcher = vi.fn(async () => new Response(JSON.stringify([pair()])));
  vi.stubGlobal("fetch", fetcher);
  expect(await t.action(refresh, {})).toMatchObject({
    state: "deferred",
    nextRefreshAt: NOW + 1500,
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await t.run((ctx) => ctx.db.query("forumMarketSampleCache").take(1)),
  ).toEqual([]);
  expect(
    await t.run((ctx) =>
      marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: 100,
      }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await t.run((ctx) =>
      commerceLimiter.check(ctx, "commerceNetworkDaily", {
        key: "all",
        count: 1000,
      }),
    ),
  ).toMatchObject({ ok: true });
  vi.setSystemTime(NOW + 1501);
  expect((await t.action(refresh, {})).state).toBe("ready");
  expect((await t.action(refresh, {})).state).toBe("ready");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("a failed or abandoned intent is not reopened when its short lease expires", async () => {
  const t = setup();
  await seed(t);
  expect(await t.mutation(claim, { lease: "first" })).toMatchObject({
    fetch: true,
  });
  vi.setSystemTime(NOW + 26_000);
  expect(await t.mutation(claim, { lease: "not-a-retry" })).toMatchObject({
    fetch: false,
    state: "unavailable",
    nextRefreshAt: NOW + MARKET_REFRESH_WINDOW_MS,
  });
  expect(
    await t.mutation(complete, {
      lease: "first",
      checkedAt: NOW + 26_000,
      quotes: null,
    }),
  ).toBeNull();
  vi.setSystemTime(NOW + MARKET_REFRESH_WINDOW_MS);
  expect(await t.mutation(claim, { lease: "new-interval" })).toMatchObject({
    fetch: true,
  });
  expect(
    await t.mutation(complete, {
      lease: "first",
      checkedAt: NOW,
      quotes: null,
    }),
  ).toBeNull();
});

test("admission is ten full minutes even across a wall-clock bucket boundary", async () => {
  const t = setup();
  await seed(t);
  const start = Date.parse("2026-10-31T02:09:59Z");
  vi.setSystemTime(start);
  expect(await t.mutation(claim, { lease: "boundary" })).toMatchObject({
    fetch: true,
    nextRefreshAt: start + MARKET_REFRESH_WINDOW_MS,
  });
  vi.setSystemTime(start + 2_000);
  expect((await t.mutation(claim, { lease: "too-soon" })).fetch).toBe(false);
  vi.setSystemTime(start + 8_000);
  expect(
    await t.mutation(complete, {
      lease: "boundary",
      checkedAt: start + 8_000,
      quotes: parseMarketRefresh([pair()], [MINT], start + 8_000),
    }),
  ).toMatchObject({ state: "ready" });
});

test("HTTP failure is charged once, retains old dates, and has no automatic fallback or retry", async () => {
  const t = setup();
  await seed(t);
  const fetcher = vi.fn(
    async () => new Response("private provider body", { status: 503 }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(await t.action(refresh, {})).toMatchObject({
    state: "unavailable",
    checkedAt: null,
  });
  expect(await t.action(refresh, {})).toMatchObject({
    state: "unavailable",
    checkedAt: null,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const row = await t.run((ctx) =>
    ctx.db.query("forumMarketSampleCache").take(1),
  );
  expect(JSON.stringify(row)).not.toContain("private provider body");
});

test.each(["terminal", "shared"] as const)(
  "exhausted %s budget makes no provider request and cannot repeatedly reserve",
  async (kind) => {
    const t = setup();
    await seed(t);
    await t.run((ctx) =>
      kind === "terminal"
        ? marketReadLimiter.limit(ctx, "terminalReadDaily", {
            key: "all",
            count: 100,
          })
        : commerceLimiter.limit(ctx, "commerceNetworkDaily", {
            key: "all",
            count: 1000,
          }),
    );
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await t.action(refresh, {})).state).toBe("budget");
    expect((await t.action(refresh, {})).state).toBe("budget");
    expect(fetcher).not.toHaveBeenCalled();
  },
);

test("the stricter refresh-only ceiling leaves original terminal capacity untouched beyond its 48 units", async () => {
  const t = setup();
  await seed(t);
  for (let index = 0; index < 48; index++) {
    vi.setSystemTime(NOW + index * MARKET_REFRESH_WINDOW_MS);
    expect((await t.mutation(claim, { lease: `slot-${index}` })).fetch).toBe(
      true,
    );
  }
  vi.setSystemTime(NOW + 48 * MARKET_REFRESH_WINDOW_MS);
  expect(await t.mutation(claim, { lease: "no-more-refresh" })).toMatchObject({
    fetch: false,
    state: "budget",
  });
  expect(
    await t.run((ctx) =>
      marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: 52,
      }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await t.run((ctx) =>
      marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: 53,
      }),
    ),
  ).toMatchObject({ ok: false });
});

test("fair source interleaving keeps an older eligible Bags token among at most thirty mints", async () => {
  const t = setup();
  await seed(t, snapshot(BAGS, "bags", NOW - 3_600_000));
  for (let index = 1; index <= 30; index++)
    await seed(
      t,
      snapshot(
        getBase58Decoder().decode(new Uint8Array(32).fill(index)),
        "pumpfun",
        NOW - index * 1000,
      ),
    );
  const result = await t.mutation(claim, { lease: "fair" });
  expect(result.mints).toHaveLength(30);
  expect(result.mints).toContain(BAGS);
  expect(new Set(result.mints).size).toBe(30);
});

test("overlay changes display cap bands, never holders, scout evidence, alerts or uncertain holds", async () => {
  const t = setup();
  const id = await seed(t);
  await t.run((ctx) =>
    ctx.db.insert("elizaRuntimeOperations", {
      operationKey: "bags:old",
      status: "unknown",
      jobId: "held-job",
      inputHash: "held-hash",
      updatedAt: NOW - 1,
    }),
  );
  const before = await t.run(async (ctx) => ({
    source: await ctx.db.get("forumTerminalMarkets", id),
    holds: await ctx.db.query("elizaRuntimeOperations").take(2),
  }));
  await t.mutation(claim, { lease: "display" });
  await t.mutation(complete, {
    lease: "display",
    checkedAt: NOW,
    quotes: parseMarketRefresh([pair()], [MINT], NOW),
  });
  const low = await t.query(api.forumTerminal.listMarket, {
    now: NOW,
    band: "50k100k",
  });
  const high = await t.query(api.forumTerminal.listMarket, {
    now: NOW,
    band: "500k1m",
  });
  expect(low.markets).toHaveLength(0);
  expect(high.stale).toBe(false);
  expect(high.markets[0]).toMatchObject({
    priceUsd: 2.5,
    marketCapUsd: 750_000,
    holders: 123,
    metricsAsOf: NOW - 3_600_000,
    observedAt: NOW - 3_600_000,
    sourceRank: 3,
    marketData: { state: "available", checkedAt: NOW },
  });
  expect(
    (await t.query(api.forumTerminal.listMarket, { now: NOW + 901_000 })).stale,
  ).toBe(true);
  const after = await t.run(async (ctx) => ({
    source: await ctx.db.get("forumTerminalMarkets", id),
    holds: await ctx.db.query("elizaRuntimeOperations").take(2),
  }));
  expect(after).toEqual(before);
  expect(
    await t.run((ctx) => ctx.db.query("forumTerminalAlerts").take(1)),
  ).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("tokenAlphaUsageDays").take(1)),
  ).toEqual([]);
});

test("partial missing tokens clear current fields without inventing freshness, and newer scout data wins", async () => {
  const t = setup();
  const id = await seed(t);
  await seed(t, snapshot(BAGS, "bags"));
  const admission = await t.mutation(claim, { lease: "partial" });
  await t.mutation(complete, {
    lease: "partial",
    checkedAt: NOW,
    quotes: parseMarketRefresh([pair()], admission.mints, NOW),
  });
  const result = await t.query(api.forumTerminal.listMarket, { now: NOW });
  expect(result.markets.find((market) => market.mint === BAGS)).toMatchObject({
    priceUsd: null,
    marketCapUsd: null,
    holders: 123,
    marketData: { state: "unavailable" },
  });
  await t.run((ctx) =>
    ctx.db.patch("forumTerminalMarkets", id, {
      snapshot: snapshot(MINT, "pumpfun", NOW + 1000),
      observedAt: NOW + 1000,
    }),
  );
  const newer = await t.query(api.forumTerminal.listMarket, {
    now: NOW + 1000,
    band: "50k100k",
  });
  expect(newer.markets.find((market) => market.mint === MINT)).toMatchObject({
    priceUsd: 1,
    marketCapUsd: 75_000,
  });
  expect(
    newer.markets.find((market) => market.mint === MINT),
  ).not.toHaveProperty("marketData");
});

test("cohort expiry during transport returns the committed unavailable result and never extends retention", async () => {
  const t = setup();
  await seed(t, snapshot(MINT, "pumpfun", NOW - 24 * 3_600_000 + 1000));
  await t.mutation(claim, { lease: "expires" });
  vi.setSystemTime(NOW + 2000);
  expect(
    await t.mutation(complete, {
      lease: "expires",
      checkedAt: NOW + 2000,
      quotes: parseMarketRefresh([pair()], [MINT], NOW + 2000),
    }),
  ).toMatchObject({ state: "unavailable" });
  expect(
    (await t.query(api.forumTerminal.listMarket, { now: NOW + 2000 })).markets,
  ).toHaveLength(0);
});

test("no allowlisted cohort spends nothing; caller mint arguments and forged completion are denied", async () => {
  const t = setup();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect((await t.action(refresh, {})).state).toBe("unavailable");
  expect(fetcher).not.toHaveBeenCalled();
  await expect(t.action(refresh, { mint: MINT } as never)).rejects.toThrow();
  const other = setup();
  await seed(other);
  await other.mutation(claim, { lease: "bound" });
  await expect(
    other.mutation(complete, {
      lease: "bound",
      checkedAt: NOW,
      quotes: parseMarketRefresh([pair(BAGS)], [BAGS], NOW),
    }),
  ).rejects.toThrow("invalid_refresh_quote");
});
