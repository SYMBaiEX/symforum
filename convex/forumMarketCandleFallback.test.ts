/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { SYMF_TOKEN } from "../lib/symf-token";
import { MARKET_QUOTES } from "../lib/terminal-market-source";
import { CHART_CACHE_FRESH_MS } from "../lib/chart-cache-policy";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.parse("2026-10-31T03:00:00Z"),
  DAY = 86_400_000;
const request = {
  mint: SYMF_TOKEN.mint,
  kind: "chart" as const,
  interval: "15m",
  pinnedSymf: true,
};
const key = `pinned-chart:${SYMF_TOKEN.mint}:15m`;
const candle = {
  time: NOW / 1000 - 900,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
};
const pairs = [
  {
    chainId: "solana",
    pairAddress: SYMF_TOKEN.pool,
    baseToken: { address: SYMF_TOKEN.mint },
    quoteToken: { address: MARKET_QUOTES[0] },
    priceUsd: "1.5",
    liquidity: { usd: 1000 },
    marketCap: 100_000,
    fdv: 100_000,
    volume: { h24: 100 },
  },
];
const gecko = {
  meta: {
    base: { address: SYMF_TOKEN.mint },
    quote: { address: MARKET_QUOTES[0] },
  },
  data: {
    attributes: {
      ohlcv_list: [
        [
          candle.time,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
        ],
      ],
    },
  },
};
function setup() {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  return t;
}
async function pilot(t: ReturnType<typeof setup>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("tokenAlphaControl", {
      key: "pilot",
      enabled: true,
      updatedAt: NOW,
    });
  });
}
async function legacyFailure(
  t: ReturnType<typeof setup>,
  extra: Record<string, unknown> = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("forumMarketDataCache", {
      key,
      payload: null,
      expiresAt: NOW - 1,
      lease: "historical-completed",
      leaseUntil: 0,
      lastAttemptAt: NOW - 60_001,
      nextAttemptAt: NOW - 1,
      failureStage: "candles",
      failureCode: "invalid-response",
      failureCount: 1,
      ...extra,
    }),
  );
}
async function usage(t: ReturnType<typeof setup>) {
  return t.run((ctx) => ctx.db.query("tokenAlphaUsageDays").take(34));
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("SOLANA_TRACKER_API_KEY", "fixture-key-not-real");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("legacy known Gecko failure selects a two-request Tracker substitute; 200 viewers share one reservation", async () => {
  const t = setup();
  await pilot(t);
  await legacyFailure(t);
  const heldId = await t.run((ctx) =>
    ctx.db.insert("tokenAlphaRuns", {
      runKey: "pumpfun:historical:held",
      platform: "pumpfun",
      claimToken: "retained-unknown",
      status: "held",
      createdAt: NOW - DAY,
      updatedAt: NOW - DAY,
      expiresAt: NOW + DAY,
      reason: "runtime_unknown",
    }),
  );
  const heldBefore = await t.run((ctx) => ctx.db.get("tokenAlphaRuns", heldId));
  const history = Array.from({ length: 160 }, (_, i) => ({
    ...candle,
    time: candle.time - i * 900,
  }));
  const fetcher = vi.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).includes("dexscreener") ? pairs : { oclhv: history },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const results = await Promise.all(
    Array.from({ length: 200 }, () =>
      t.action(api.forumMarketData.read, request),
    ),
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    fetcher.mock.calls.map(([url]) => new URL(String(url)).hostname),
  ).toEqual(["api.dexscreener.com", "data.solanatracker.io"]);
  const result = results.find((r) => r.state === "ready")!;
  expect(JSON.parse(result.payload!)).toMatchObject({
    candleSource: "solana-tracker",
    mint: SYMF_TOKEN.mint,
    pool: SYMF_TOKEN.pool,
    quote: MARKET_QUOTES[0],
    checkedAt: NOW,
  });
  expect(JSON.parse(result.payload!).candles).toEqual(
    history.slice(0, 120).reverse(),
  );
  const sourceUrl = new URL(String(fetcher.mock.calls[1]![0]));
  expect(sourceUrl.searchParams.has("time_from")).toBe(false);
  expect(sourceUrl.searchParams.has("time_to")).toBe(false);
  expect(await usage(t)).toMatchObject([
    { requests: 1, candleRequests: 1, enrichmentRequests: 0 },
  ]);
  expect(await t.run((ctx) => ctx.db.get("tokenAlphaRuns", heldId))).toEqual(
    heldBefore,
  );
  // A successful fallback does not permanently route future requests to Tracker.
  vi.setSystemTime(NOW + CHART_CACHE_FRESH_MS + 1);
  fetcher.mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(String(url).includes("dexscreener") ? pairs : gecko),
      ),
  );
  const next = await t.action(api.forumMarketData.read, request);
  expect(JSON.parse(next.payload!).candleSource).toBe("geckoterminal");
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(await usage(t)).toMatchObject([{ requests: 1, candleRequests: 1 }]);
});

test("a new Gecko failure never adds a third same-attempt fallback request", async () => {
  const t = setup();
  await pilot(t);
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    String(url).includes("dexscreener")
      ? new Response(JSON.stringify(pairs))
      : new Response("{}"),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await t.action(api.forumMarketData.read, request);
  expect(result).toMatchObject({
    state: "unavailable",
    cache: { failureCode: "candle-schema", failureProvider: "geckoterminal" },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await usage(t)).toEqual([]);
  await t.action(api.forumMarketData.read, request);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test.each([
  [{ ...candle, open: 0 }, "candle-price"],
  [{ ...candle, time: NOW }, "candle-time-unit"],
  [{ ...candle, time: NOW / 1000 + 61 }, "candle-future"],
] as const)(
  "Tracker rejection persists only safe diagnostic %s",
  async (invalid, code) => {
    const t = setup();
    await pilot(t);
    await legacyFailure(t);
    const fetcher = vi.fn(
      async (url: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(url).includes("dexscreener")
              ? pairs
              : { oclhv: [invalid], privateMarker: "never-save-provider-body" },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await t.action(api.forumMarketData.read, request);
    expect(result).toMatchObject({
      state: "unavailable",
      payload: null,
      cache: { failureCode: code, failureProvider: "solana-tracker" },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const row = await t.run((ctx) =>
      ctx.db
        .query("forumMarketDataCache")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique(),
    );
    expect(JSON.stringify(row)).not.toContain("never-save-provider-body");
    expect(console.warn).toHaveBeenLastCalledWith(
      "public_market_fetch_failed",
      { stage: "candles", code, failureCount: 2 },
    );
  },
);

test("a different eligible mint cannot select Tracker from a historical candle failure", async () => {
  const t = setup();
  await pilot(t);
  const mint = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";
  await t.run(async (ctx) => {
    await ctx.db.insert("forumTerminalMarkets", {
      mint,
      platform: "bags",
      band: "50k100k",
      observedAt: NOW,
      snapshot: {
        mint,
        platform: "bags",
        name: "Fixture",
        symbol: "F",
        observedAt: NOW,
        metricsAsOf: NOW,
        priceUsd: 1,
        marketCapUsd: 75000,
        holders: null,
        volume1hUsd: 100,
        liquidityUsd: 1000,
        priceChange1hPercent: null,
        imageUrl: null,
        website: null,
        twitter: null,
        telegram: null,
        description: null,
        sourceUrl: `https://www.solanatracker.io/token/${mint}`,
        sourceRank: 1,
      },
    });
    await ctx.db.insert("forumMarketDataCache", {
      key: `chart:${mint}:15m`,
      payload: null,
      expiresAt: NOW - 1,
      lease: "completed",
      leaseUntil: 0,
      lastAttemptAt: NOW - 60001,
      nextAttemptAt: NOW - 1,
      failureStage: "candles",
      failureCode: "http-429",
      failureCount: 1,
    });
  });
  const result = await t.mutation(internal.forumMarketData.claim, {
    mint,
    kind: "chart",
    interval: "15m",
    lease: "next",
  });
  expect(result).toMatchObject({
    fetch: true,
    candleProvider: "geckoterminal",
  });
  expect(await usage(t)).toEqual([]);
});

test.each(["pending", "incomplete", "hint", "tracker"])(
  "%s state cannot authorize a fallback early",
  async (state) => {
    const t = setup();
    await pilot(t);
    const extra =
      state === "pending"
        ? { leaseUntil: NOW + 10_000 }
        : state === "incomplete"
          ? { leaseUntil: NOW - 1 }
          : state === "hint"
            ? { nextAttemptAt: NOW + 3_600_000 }
            : { failureProvider: "solana-tracker" };
    await legacyFailure(t, extra);
    const admitted = await t.mutation(internal.forumMarketData.claim, {
      ...request,
      lease: "new",
    });
    if (state === "tracker" || state === "incomplete")
      expect(admitted.candleProvider).toBe("geckoterminal");
    else expect(admitted.fetch).toBe(false);
    expect(await usage(t)).toEqual([]);
  },
);

test.each(["due", "before-hint", "pending", "incomplete"])(
  "legacy Tracker candle-window %s requires ordinary due completed admission",
  async (state) => {
    const t = setup();
    await pilot(t);
    await legacyFailure(t, {
      failureProvider: "solana-tracker",
      failureCode: "candle-window",
      ...(state === "before-hint"
        ? { nextAttemptAt: NOW + 60000 }
        : state === "pending"
          ? { leaseUntil: NOW + 1000 }
          : state === "incomplete"
            ? { leaseUntil: NOW - 1 }
            : {}),
    });
    const admission = await t.mutation(internal.forumMarketData.claim, {
      ...request,
      lease: "shape-corrected-later-intent",
    });
    if (state === "due")
      expect(admission).toMatchObject({
        fetch: true,
        candleProvider: "solana-tracker",
      });
    else if (state === "incomplete")
      expect(admission.candleProvider).toBe("geckoterminal");
    else expect(admission.fetch).toBe(false);
    expect(await usage(t)).toEqual([]);
  },
);

test.each(["daily", "rolling", "subcap", "disabled"])(
  "%s quota denial sends no Tracker or third request and retains source provenance",
  async (block) => {
    const t = setup();
    if (block !== "disabled") await pilot(t);
    await legacyFailure(t);
    if (block !== "disabled")
      await t.run(async (ctx) => {
        await ctx.db.insert("tokenAlphaUsageDays", {
          dayKey: block === "rolling" ? "2026-10-30" : "2026-10-31",
          requests: block === "daily" ? 70 : block === "rolling" ? 2300 : 12,
          candleRequests: block === "subcap" ? 12 : 0,
          updatedAt: NOW,
        });
      });
    const before = await usage(t);
    const fetcher = vi.fn(async () => new Response(JSON.stringify(pairs)));
    vi.stubGlobal("fetch", fetcher);
    const result = await t.action(api.forumMarketData.read, request);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      state: "budget",
      cache: { failureCode: "budget", failureProvider: "solana-tracker" },
    });
    expect(result.cache.nextRetryAt).toBe(Date.parse("2026-11-01T00:00:00Z"));
    expect(await usage(t)).toEqual(before);
  },
);

test("unconfigured fallback stays on fixed Gecko; rejected DEX binding consumes no Tracker quota", async () => {
  const t = setup();
  await pilot(t);
  await legacyFailure(t);
  vi.stubEnv("SOLANA_TRACKER_API_KEY", "");
  const claim = await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "unconfigured",
  });
  expect(claim.candleProvider).toBe("geckoterminal");
  const other = setup();
  await pilot(other);
  await legacyFailure(other);
  vi.stubEnv("SOLANA_TRACKER_API_KEY", "fixture-key-not-real");
  const fetcher = vi.fn(async () => new Response(JSON.stringify([])));
  vi.stubGlobal("fetch", fetcher);
  const result = await other.action(api.forumMarketData.read, request);
  expect(result.cache.failureCode).toBe("pool-unavailable");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await usage(other)).toEqual([]);
});

test("Tracker failure cannot replace last-good Gecko bytes or become a Gecko failure; late saves cannot spoof source", async () => {
  const t = setup();
  await pilot(t);
  const good = JSON.stringify({
    mint: SYMF_TOKEN.mint,
    pool: SYMF_TOKEN.pool,
    quote: MARKET_QUOTES[0],
    interval: "15m",
    checkedAt: NOW - CHART_CACHE_FRESH_MS - 1,
    candleSource: "geckoterminal",
    candles: [candle],
    stats: { marketCap: null, fdv: null, liquidity: null, volume24h: null },
  });
  const id = await legacyFailure(t, {
    payload: good,
    lastSuccessAt: NOW - CHART_CACHE_FRESH_MS - 1,
  });
  const fetcher = vi.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).includes("dexscreener")
            ? pairs
            : { oclhv: [candle], pool: MARKET_QUOTES[1] },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await t.action(api.forumMarketData.read, request);
  expect(result.payload).toBe(good);
  expect(result.stale).toBe(true);
  expect(result.cache).toMatchObject({
    failureProvider: "solana-tracker",
    failureCode: "candle-identity",
  });
  const row = await t.run((ctx) => ctx.db.get("forumMarketDataCache", id));
  vi.setSystemTime(result.cache.nextRetryAt! + 1);
  const next = await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "new-gecko",
  });
  expect(next.candleProvider).toBe("geckoterminal");
  const late = await t.mutation(internal.forumMarketData.save, {
    key,
    lease: row!.lease,
    attemptAt: row!.lastAttemptAt,
    payload: good,
    candleProvider: "solana-tracker",
  });
  expect(late.state).toBe("loading");
  expect(late.payload).toBe(good);
});

test("candle reservation subcap is atomic, migrates old rows, preserves ranking/enrichment, and rolls over", async () => {
  const t = setup();
  await pilot(t);
  await t.run((ctx) =>
    ctx.db.insert("tokenAlphaUsageDays", {
      dayKey: "2026-10-31",
      requests: 0,
      updatedAt: NOW,
    }),
  );
  const reservations = await Promise.all(
    Array.from({ length: 30 }, () =>
      t.mutation(internal.tokenAlphaData.reserveApiRequest, { kind: "candle" }),
    ),
  );
  expect(reservations.filter(Boolean)).toHaveLength(12);
  for (let i = 0; i < 10; i++)
    expect(
      await t.mutation(internal.tokenAlphaData.reserveApiRequest, {
        kind: "enrichment",
      }),
    ).toBe(true);
  for (let i = 0; i < 48; i++)
    expect(
      await t.mutation(internal.tokenAlphaData.reserveApiRequest, {
        kind: "ranking",
      }),
    ).toBe(true);
  expect(await usage(t)).toMatchObject([
    { requests: 70, candleRequests: 12, enrichmentRequests: 10 },
  ]);
  expect(
    await t.mutation(internal.tokenAlphaData.reserveApiRequest, {
      kind: "candle",
    }),
  ).toBe(false);
  vi.setSystemTime(NOW + DAY);
  expect(
    await t.mutation(internal.tokenAlphaData.reserveApiRequest, {
      kind: "candle",
    }),
  ).toBe(true);
  expect(await usage(t)).toMatchObject([
    { requests: 70, candleRequests: 12 },
    { requests: 1, candleRequests: 1 },
  ]);
});
