/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { makeFunctionReference } from "convex/server";
import { FORUM_READ_POLICY } from "../lib/forum-read-policy";
import { classifyMarketCap } from "../lib/forum-market-cap";
import type { TokenSnapshot } from "../lib/token-alpha";
import { SYMF_TOKEN } from "../lib/symf-token";
import { MARKET_QUOTES } from "../lib/terminal-market-source";
const modules = import.meta.glob("./**/*.ts");
const now = Date.parse("2026-10-31T18:00:00Z");
const request = {
  mint: SYMF_TOKEN.mint,
  kind: "market" as const,
  pinnedSymf: true,
};
const pair = {
  chainId: "solana",
  pairAddress: SYMF_TOKEN.pool,
  baseToken: { address: SYMF_TOKEN.mint },
  quoteToken: { address: MARKET_QUOTES[0] },
  priceUsd: "1.5",
  marketCap: null,
  fdv: 10,
  liquidity: { usd: 20 },
  volume: { h24: 0 },
};
function setup() {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  return t;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const admit = makeFunctionReference<
  "mutation",
  { provider: "geckoterminal" | "dexscreener"; credits: number },
  { ok: boolean; retryAt: number | null }
>("forumProviderAdmission:admit");
test("a known Gecko admission denial preserves its exact deadline, emits no Gecko HTTP and never drains Tracker", async () => {
  const t = setup();
  vi.stubEnv("SOLANA_TRACKER_API_KEY", "fixture-not-a-real-key");
  await t.run((ctx) =>
    ctx.db.insert("tokenAlphaControl", {
      key: "pilot",
      enabled: true,
      updatedAt: now,
    }),
  );
  for (let i = 0; i < FORUM_READ_POLICY.geckoterminal.requestsPerWindow; i++)
    expect(
      await t.mutation(admit, { provider: "geckoterminal", credits: 1 }),
    ).toMatchObject({ ok: true });
  const denied = await t.mutation(admit, {
    provider: "geckoterminal",
    credits: 1,
  });
  expect(denied.ok).toBe(false);
  const candles = {
    meta: {
      base: { address: SYMF_TOKEN.mint },
      quote: { address: MARKET_QUOTES[0] },
    },
    data: {
      attributes: { ohlcv_list: [[now / 1000 - 60, 1, 2, 0.5, 1.5, 10]] },
    },
  };
  const fetcher = vi.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(String(url).includes("dexscreener") ? [pair] : candles),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const chart = {
    mint: SYMF_TOKEN.mint,
    kind: "chart" as const,
    interval: "15m",
    pinnedSymf: true,
  };
  const blocked = await t.action(api.forumMarketData.read, chart);
  expect(blocked).toMatchObject({
    state: "budget",
    payload: null,
    cache: {
      failureStage: "candles",
      failureCode: "budget",
      failureProvider: "geckoterminal",
      nextRetryAt: denied.retryAt,
    },
  });
  expect(
    fetcher.mock.calls.map(([url]) => new URL(String(url)).hostname),
  ).toEqual(["api.dexscreener.com"]);
  const before = await t.run((ctx) =>
    ctx.db.query("tokenAlphaUsageDays").take(34),
  );
  expect(before).toEqual([]);
  expect(await t.action(api.forumMarketData.read, chart)).toEqual(blocked);
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.setSystemTime(denied.retryAt! + 1);
  const next = await t.action(api.forumMarketData.read, chart);
  expect(next.state).toBe("ready");
  expect(JSON.parse(next.payload!).candleSource).toBe("geckoterminal");
  expect(
    fetcher.mock.calls.map(([url]) => new URL(String(url)).hostname),
  ).toEqual(["api.dexscreener.com", "api.geckoterminal.com"]);
  expect(
    await t.run((ctx) => ctx.db.query("tokenAlphaUsageDays").take(34)),
  ).toEqual(before);
});

test("Telegram source denial records only the safe provider deadline, emits no HTTP/send and preserves historical holds", async () => {
  const t = setup();
  vi.stubEnv("TELEGRAM_TRADE_FEED_ENABLED", "true");
  vi.stubEnv("TELEGRAM_TRADE_FEED_TOPIC_ID", "310");
  vi.stubEnv("TELEGRAM_AGENTS_ENABLED", "true");
  vi.stubEnv(
    "TELEGRAM_AGENT_BOTS",
    JSON.stringify({
      suki: {
        token: `123456789:${"a".repeat(35)}`,
        username: "symbaiex_suki_bot",
      },
    }),
  );
  for (let i = 0; i < FORUM_READ_POLICY.geckoterminal.requestsPerWindow; i++)
    await t.mutation(admit, { provider: "geckoterminal", credits: 1 });
  const denied = await t.mutation(admit, {
    provider: "geckoterminal",
    credits: 1,
  });
  const id = await t.run((ctx) =>
    ctx.db.insert("telegramTradeBatches", {
      eventIds: [],
      text: "Inert retained hold",
      status: "held",
      createdAt: now - 1000,
    }),
  );
  const before = await t.run((ctx) => ctx.db.get("telegramTradeBatches", id));
  const fetcher = vi.fn(() => {
    throw Error("Unexpected transport");
  });
  vi.stubGlobal("fetch", fetcher);
  await t.action(internal.telegramTradeFeedPoll.poll, {});
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("telegramTradeState")
        .withIndex("by_key", (q) => q.eq("key", "symf"))
        .unique(),
    ),
  ).toMatchObject({
    reason: "provider_admission_denied",
    retryAfterAt: denied.retryAt,
  });
  expect(await t.run((ctx) => ctx.db.get("telegramTradeBatches", id))).toEqual(
    before,
  );
  expect(
    await t.run((ctx) => ctx.db.query("telegramTradeEvents").take(20)),
  ).toEqual([]);
});

test("Markets batch uses provider admission before transport and retains its original refresh window on denial", async () => {
  const t = setup();
  const snapshot: TokenSnapshot = {
    platform: "pumpfun",
    mint: SYMF_TOKEN.mint,
    name: "Sample",
    symbol: "SYMF",
    observedAt: now,
    metricsAsOf: now,
    priceUsd: 1,
    marketCapUsd: 75000,
    holders: 10,
    volume1hUsd: 1,
    liquidityUsd: 20,
    priceChange1hPercent: 0,
    imageUrl: null,
    website: null,
    twitter: null,
    telegram: null,
    description: null,
    sourceUrl: `https://www.solanatracker.io/token/${SYMF_TOKEN.mint}`,
    sourceRank: 1,
  };
  await t.run((ctx) =>
    ctx.db.insert("forumTerminalMarkets", {
      mint: snapshot.mint,
      platform: snapshot.platform,
      band: classifyMarketCap(snapshot.marketCapUsd),
      observedAt: now,
      snapshot,
    }),
  );
  for (let i = 0; i < FORUM_READ_POLICY.dexscreener.requestsPerWindow; i++)
    await t.mutation(admit, { provider: "dexscreener", credits: 1 });
  const fetcher = vi.fn(() => {
    throw Error("Unexpected transport");
  });
  vi.stubGlobal("fetch", fetcher);
  const refresh = makeFunctionReference<
    "action",
    Record<string, never>,
    { state: string; checkedAt: number | null; nextRefreshAt: number | null }
  >("forumTerminalRefresh:refresh");
  expect(await t.action(refresh, {})).toMatchObject({
    state: "unavailable",
    checkedAt: null,
    nextRefreshAt: now + FORUM_READ_POLICY.marketSampleIntervalMs,
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    (await t.run((ctx) =>
      ctx.db
        .query("forumMarketSampleCache")
        .withIndex("by_key", (q) => q.eq("key", "markets"))
        .unique(),
    ))!.quotes,
  ).toEqual([]);
});
test("pinned overview uses its own official cache while generic overview retains the highest-liquidity pool", async () => {
  const t = setup();
  const fetcher = vi.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).includes("dexscreener")
            ? [
                pair,
                {
                  ...pair,
                  pairAddress: MARKET_QUOTES[1],
                  liquidity: { usd: 2000 },
                },
              ]
            : { data: [] },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const pinned = await t.action(api.forumMarketData.read, request);
  expect(pinned.state).toBe("ready");
  expect(JSON.parse(pinned.payload!)).toMatchObject({
    pool: SYMF_TOKEN.pool,
    quote: MARKET_QUOTES[0],
    stats: { marketCap: null, volume24h: 0 },
    trades: [],
    marketCheckedAt: now,
  });
  vi.setSystemTime(now + 2000);
  const generic = await t.action(api.forumMarketData.read, {
    mint: SYMF_TOKEN.mint,
    kind: "market",
  });
  expect(JSON.parse(generic.payload!).pool).toBe(MARKET_QUOTES[1]);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(
    (await t.run((ctx) => ctx.db.query("forumMarketDataCache").take(10)))
      .map((r) => r.key)
      .sort(),
  ).toEqual([
    `market:${SYMF_TOKEN.mint}:all`,
    `pinned-market:${SYMF_TOKEN.mint}:all`,
  ]);
});

test("a missing official pair never substitutes a generic pool for pinned stats or trades", async () => {
  const t = setup();
  const fetcher = vi.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).includes("dexscreener")
            ? [{ ...pair, pairAddress: MARKET_QUOTES[1] }]
            : { data: [] },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const pinned = await t.action(api.forumMarketData.read, request);
  expect(JSON.parse(pinned.payload!)).toMatchObject({
    pool: SYMF_TOKEN.pool,
    quote: MARKET_QUOTES[0],
    stats: null,
    trades: [],
  });
  expect(JSON.parse(pinned.payload!)).not.toHaveProperty("marketCheckedAt");
  expect(String(fetcher.mock.calls[1][0])).toContain(
    `/pools/${SYMF_TOKEN.pool}/trades`,
  );
  vi.setSystemTime(now + 2000);
  expect(
    JSON.parse(
      (
        await t.action(api.forumMarketData.read, {
          mint: SYMF_TOKEN.mint,
          kind: "market",
        })
      ).payload!,
    ).pool,
  ).toBe(MARKET_QUOTES[1]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test.each(["chart", "market"] as const)(
  "a generic %s never uses the new pinned-only partial fallback",
  async (kind) => {
    const t = setup();
    const fetcher = vi.fn(async () => new Response("private", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      await t.action(api.forumMarketData.read, { mint: SYMF_TOKEN.mint, kind }),
    ).toMatchObject({ state: "unavailable", payload: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

test("pinned partial cache rejects foreign identity, absent trades and malformed trade objects", async () => {
  const t = setup();
  const claim = await t.mutation(internal.forumMarketData.claim, {
    ...request,
    interval: "15m",
    lease: "partial",
  });
  const base = {
    mint: SYMF_TOKEN.mint,
    pool: SYMF_TOKEN.pool,
    quote: MARKET_QUOTES[0],
    checkedAt: now,
    stats: null,
    trades: [],
  };
  for (const payload of [
    { ...base, pool: MARKET_QUOTES[1] },
    { ...base, quote: MARKET_QUOTES[1] },
    { ...base, trades: null },
    { ...base, trades: [{}] },
    { ...base, marketCheckedAt: now },
  ])
    await expect(
      t.mutation(internal.forumMarketData.save, {
        key: `pinned-market:${SYMF_TOKEN.mint}:all`,
        lease: "partial",
        attemptAt: claim.cache.lastAttemptAt!,
        payload: JSON.stringify(payload),
      }),
    ).rejects.toThrow("invalid_market_cache");
  expect(
    (
      await t.mutation(internal.forumMarketData.save, {
        key: `pinned-market:${SYMF_TOKEN.mint}:all`,
        lease: "partial",
        attemptAt: claim.cache.lastAttemptAt!,
        payload: JSON.stringify(base),
      })
    ).state,
  ).toBe("ready");
});
test.each(["dex", "trades"])(
  "official overview preserves partial %s outage without invented source time or values",
  async (failed) => {
    const t = setup();
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("dexscreener") === (failed === "dex")
        ? new Response("private", { status: 503 })
        : new Response(
            JSON.stringify(
              String(url).includes("dexscreener") ? [pair] : { data: [] },
            ),
          ),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await t.action(api.forumMarketData.read, request);
    expect(result.state).toBe("ready");
    const payload = JSON.parse(result.payload!);
    expect(payload).toMatchObject({
      mint: SYMF_TOKEN.mint,
      pool: SYMF_TOKEN.pool,
      quote: MARKET_QUOTES[0],
      checkedAt: now,
    });
    if (failed === "dex") {
      expect(payload.stats).toBeNull();
      expect(payload.trades).toEqual([]);
      expect(payload).not.toHaveProperty("marketCheckedAt");
    } else {
      expect(payload.stats).toMatchObject({ marketCap: null, volume24h: 0 });
      expect(payload.trades).toBeNull();
      expect(payload.marketCheckedAt).toBe(now);
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);
test("total outage fails closed and a warm negative source permits only the reserved official trades read", async () => {
  const t = setup();
  const fetcher = vi.fn(async () => new Response("private", { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await t.action(api.forumMarketData.read, request)).toMatchObject({
    state: "unavailable",
    payload: null,
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  const another = setup();
  expect(
    (
      await another.action(api.forumMarketData.read, {
        mint: SYMF_TOKEN.mint,
        kind: "chart",
      })
    ).payload,
  ).toBeNull();
  fetcher.mockImplementation(
    async () => new Response(JSON.stringify({ data: [] })),
  );
  vi.setSystemTime(now + 2000);
  const partial = await another.action(api.forumMarketData.read, request);
  expect(partial.state).toBe("ready");
  expect(JSON.parse(partial.payload!)).toMatchObject({
    stats: null,
    trades: [],
    pool: SYMF_TOKEN.pool,
  });
  expect(fetcher).toHaveBeenCalledTimes(4); // two original failures, one chart DEX failure, one official trade read.
});
