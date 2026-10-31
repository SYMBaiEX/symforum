/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { getBase58Decoder } from "@solana/kit";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { marketReadLimiter } from "./forumMarketData";
import { commerceLimiter } from "./forumCommerce";
import { SYMF_TOKEN } from "../lib/symf-token";
import {
  CHART_CACHE_FRESH_MS,
  CHART_CACHE_RETENTION_MS,
  marketFailureBackoff,
  nextMarketBudgetReset,
} from "../lib/chart-cache-policy";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.parse("2026-10-31T03:00:00Z");
const MINT = SYMF_TOKEN.mint,
  POOL = SYMF_TOKEN.pool;
const QUOTE = "So11111111111111111111111111111111111111112";
const request = { mint: MINT, kind: "chart" as const, interval: "15m" };
const key = `chart:${MINT}:15m`;
function setup() {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  return t;
}
function pairs(pool = POOL, liquidity = 1000) {
  return [
    {
      chainId: "solana",
      pairAddress: pool,
      baseToken: { address: MINT },
      quoteToken: { address: QUOTE },
      priceUsd: "1.5",
      marketCap: 75_000,
      fdv: 100_000,
      liquidity: { usd: liquidity },
      volume: { h24: 1200 },
    },
  ];
}
function candles() {
  return {
    meta: { base: { address: MINT }, quote: { address: QUOTE } },
    data: {
      attributes: {
        ohlcv_list: [[Math.floor(NOW / 1000) - 60, 1, 2, 0.5, 1.5, 10]],
      },
    },
  };
}
function payload(checkedAt = NOW, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    mint: MINT,
    pool: POOL,
    quote: QUOTE,
    interval: "15m",
    checkedAt,
    stats: {
      marketCap: 75_000,
      fdv: 100_000,
      liquidity: 1000,
      volume24h: 1200,
    },
    priceUsd: 1.5,
    candles: [
      {
        time: Math.floor(NOW / 1000) - 60,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
      },
    ],
    ...overrides,
  });
}
async function cache(t: ReturnType<typeof setup>) {
  return t.run((ctx) =>
    ctx.db
      .query("forumMarketDataCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique(),
  );
}
async function jobs(t: ReturnType<typeof setup>) {
  return t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(100));
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("success followed by upstream failure retains exact last-good bytes and original checkedAt", async () => {
  const t = setup();
  let fail = false;
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    String(url).includes("dexscreener")
      ? new Response(JSON.stringify(pairs()))
      : fail
        ? new Response("private upstream response must not persist", {
            status: 503,
          })
        : new Response(JSON.stringify(candles())),
  );
  vi.stubGlobal("fetch", fetcher);
  const first = await t.action(api.forumMarketData.read, request);
  expect(first).toMatchObject({
    state: "ready",
    stale: false,
    cache: { lastSuccessAt: NOW, failureCount: 0 },
  });
  fail = true;
  vi.setSystemTime(NOW + CHART_CACHE_FRESH_MS + 1);
  const failed = await t.action(api.forumMarketData.read, request);
  expect(failed).toMatchObject({
    state: "unavailable",
    stale: true,
    cache: {
      lastSuccessAt: NOW,
      failureStage: "candles",
      failureCode: "http-5xx",
      failureCount: 1,
    },
  });
  expect(failed.payload).toBe(first.payload);
  expect(JSON.parse(failed.payload!).checkedAt).toBe(NOW);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(await t.action(api.forumMarketData.read, request)).toEqual(failed);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(await cache(t))).not.toContain("private upstream");
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith("public_market_fetch_failed", {
    stage: "candles",
    code: "http-5xx",
    failureCount: 1,
  });
});

test("200 concurrent chart readers coalesce to one two-request transport and two reserved units", async () => {
  const t = setup();
  const fetcher = vi.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).includes("dexscreener") ? pairs() : candles(),
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
  expect(results.some((result) => result.state === "ready")).toBe(true);
  expect(
    await t.run((ctx) =>
      marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: 98,
      }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await t.run((ctx) =>
      marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: 99,
      }),
    ),
  ).toMatchObject({ ok: false });
  expect(
    await t.run((ctx) =>
      commerceLimiter.check(ctx, "commerceNetworkDaily", {
        key: "all",
        count: 998,
      }),
    ),
  ).toMatchObject({ ok: true });
});

test("cold failure history survives cleanup at retry time and backoff grows without cache-hit charges", async () => {
  const t = setup();
  let now = NOW;
  for (let failure = 1; failure <= 6; failure++) {
    vi.setSystemTime(now);
    const admission = await t.mutation(internal.forumMarketData.claim, {
      ...request,
      lease: `attempt-${failure}`,
    });
    expect(admission.fetch).toBe(true);
    const saved = await t.mutation(internal.forumMarketData.save, {
      key,
      lease: `attempt-${failure}`,
      attemptAt: now,
      payload: null,
      failureStage: "candles",
      failureCode: "http-5xx",
    });
    expect(saved.cache).toMatchObject({
      failureCount: failure,
      nextRetryAt: now + marketFailureBackoff(failure),
    });
    expect(
      (
        await t.mutation(internal.forumMarketData.claim, {
          ...request,
          lease: "not-due",
        })
      ).fetch,
    ).toBe(false);
    now = saved.cache.nextRetryAt! + 1;
    vi.setSystemTime(now);
    await t.mutation(internal.forumMarketData.expire, {
      id: (await cache(t))!._id,
    });
    expect((await cache(t))!.failureCount).toBe(failure);
  }
});

test("an expired/crashed lease cannot replay before its durable attempt fence and is never refunded", async () => {
  const t = setup();
  const first = await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "unknown",
  });
  expect(first.cache.nextRetryAt).toBe(NOW + 60_000);
  vi.setSystemTime(NOW + 26_000);
  expect(
    await t.mutation(internal.forumMarketData.claim, {
      ...request,
      lease: "too-early",
    }),
  ).toMatchObject({ fetch: false, cache: { failureCode: "incomplete" } });
  const ignored = await t.mutation(internal.forumMarketData.save, {
    key,
    lease: "unknown",
    attemptAt: NOW,
    payload: payload(),
  });
  expect(ignored.payload).toBeNull();
  expect(ignored.state).not.toBe("ready");
  vi.setSystemTime(NOW + 60_001);
  expect(
    (
      await t.mutation(internal.forumMarketData.claim, {
        ...request,
        lease: "new-attempt",
      })
    ).fetch,
  ).toBe(true);
  expect(
    await t.run((ctx) =>
      marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: 97,
      }),
    ),
  ).toMatchObject({ ok: false });
});

test("late or foreign completion returns the persisted current view, never its local candidate", async () => {
  const t = setup();
  await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "old",
  });
  vi.setSystemTime(NOW + 60_001);
  await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "current",
  });
  const good = await t.mutation(internal.forumMarketData.save, {
    key,
    lease: "current",
    attemptAt: NOW + 60_001,
    payload: payload(NOW + 60_001),
  });
  const old = await t.mutation(internal.forumMarketData.save, {
    key,
    lease: "old",
    attemptAt: NOW,
    payload: payload(),
  });
  expect(old).toEqual(good);
  expect(JSON.parse(old.payload!).checkedAt).toBe(NOW + 60_001);
  const other = setup();
  const fetcher = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes("dexscreener"))
      return new Response(JSON.stringify(pairs()));
    vi.setSystemTime(NOW + 120_001 + 26_000);
    return new Response(JSON.stringify(candles()));
  });
  vi.setSystemTime(NOW + 120_001);
  vi.stubGlobal("fetch", fetcher);
  const late = await other.action(api.forumMarketData.read, request);
  expect(late.state).not.toBe("ready");
  expect(late.payload).toBeNull();
});

test.each([429, 503])(
  "HTTP %s Retry-After is respected for both failed charts and partial market statistics",
  async (status) => {
    for (const type of ["chart", "market"] as const) {
      const t = setup();
      vi.setSystemTime(NOW);
      const fetcher = vi.fn(async (url: RequestInfo | URL) =>
        String(url).includes("dexscreener")
          ? new Response(JSON.stringify(pairs()))
          : new Response("private throttling text", {
              status,
              headers: { "Retry-After": "3600" },
            }),
      );
      vi.stubGlobal("fetch", fetcher);
      const result = await t.action(api.forumMarketData.read, {
        ...request,
        kind: type,
      });
      expect(result.cache).toMatchObject({
        nextRetryAt: NOW + 3_600_000,
        failureCode: status === 429 ? "http-429" : "http-5xx",
        failureStage: type === "chart" ? "candles" : "trades",
      });
      if (type === "market") {
        expect(result.state).toBe("ready");
        expect(JSON.parse(result.payload!).trades).toBeNull();
      } else expect(result.payload).toBeNull();
      vi.setSystemTime(NOW + CHART_CACHE_FRESH_MS + 1);
      await t.action(api.forumMarketData.read, { ...request, kind: type });
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  },
);

test("daily budget denial reports the UTC reset without a transport or minute retry", async () => {
  const t = setup();
  await t.run((ctx) =>
    marketReadLimiter.limit(ctx, "terminalReadDaily", {
      key: "all",
      count: 100,
    }),
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(await t.action(api.forumMarketData.read, request)).toMatchObject({
    state: "budget",
    cache: {
      nextRetryAt: nextMarketBudgetReset(NOW),
      failureCode: "budget",
      lastAttemptAt: null,
    },
  });
  vi.setSystemTime(NOW + 60_001);
  await t.action(api.forumMarketData.read, request);
  expect(fetcher).not.toHaveBeenCalled();
});

test("old cleanup callbacks do not multiply timers or delete a newer retained payload", async () => {
  const t = setup();
  await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "one",
  });
  await t.mutation(internal.forumMarketData.save, {
    key,
    lease: "one",
    attemptAt: NOW,
    payload: payload(),
  });
  const id = (await cache(t))!._id;
  const before = (await jobs(t)).length;
  vi.setSystemTime(NOW + 3_600_000);
  for (let index = 0; index < 5; index++)
    await t.mutation(internal.forumMarketData.expire, { id });
  expect((await jobs(t)).length).toBe(before);
  expect((await cache(t))!.payload).toBe(payload());
});

test("payload expires at original 24h while later failed-attempt history/fences stay protected", async () => {
  const t = setup();
  await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "good",
  });
  await t.mutation(internal.forumMarketData.save, {
    key,
    lease: "good",
    attemptAt: NOW,
    payload: payload(),
  });
  const nearExpiry = NOW + CHART_CACHE_RETENTION_MS - 60_000;
  vi.setSystemTime(nearExpiry);
  await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "failed",
  });
  await t.mutation(internal.forumMarketData.save, {
    key,
    lease: "failed",
    attemptAt: nearExpiry,
    payload: null,
    failureStage: "candles",
    failureCode: "http-429",
    retryAfterAt: nearExpiry + 3_600_000,
  });
  const id = (await cache(t))!._id;
  vi.setSystemTime(NOW + CHART_CACHE_RETENTION_MS + 1);
  await t.mutation(internal.forumMarketData.expire, { id });
  expect(await cache(t)).not.toBeNull();
  const retainedFence = await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "not-authorized-yet",
  });
  expect(retainedFence.fetch).toBe(false);
  expect(retainedFence.payload).toBeNull();
  vi.setSystemTime(nearExpiry + CHART_CACHE_RETENTION_MS + 1);
  await t.mutation(internal.forumMarketData.expire, { id });
  expect(await cache(t)).toBeNull();
});

test("pinned SYMF charts never fall back to a different high-liquidity pool or cache namespace", async () => {
  const t = setup();
  const otherPool = getBase58Decoder().decode(new Uint8Array(32).fill(9));
  let includePinned = false;
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    String(url).includes("dexscreener")
      ? new Response(
          JSON.stringify([
            ...pairs(otherPool, 10000),
            ...(includePinned ? pairs(POOL, 1000) : []),
          ]),
        )
      : new Response(JSON.stringify(candles())),
  );
  vi.stubGlobal("fetch", fetcher);
  const missing = await t.action(api.forumMarketData.read, {
    ...request,
    pinnedSymf: true,
  });
  expect(missing).toMatchObject({
    state: "unavailable",
    payload: null,
    cache: { failureCode: "pool-unavailable" },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.setSystemTime(NOW + 1600);
  const generic = await t.action(api.forumMarketData.read, request);
  expect(JSON.parse(generic.payload!).pool).toBe(otherPool);
  includePinned = true;
  vi.setSystemTime(NOW + 60_001);
  const stillMissing = await t.action(api.forumMarketData.read, {
    ...request,
    pinnedSymf: true,
  });
  expect(stillMissing.payload).toBeNull();
  expect(stillMissing.cache.failureCode).toBe("pool-unavailable");
  // The complete source observation is still fresh; a changed provider mock
  // cannot silently replace its missing official pool before normal expiry.
  expect(fetcher).toHaveBeenCalledTimes(2);
  vi.setSystemTime(NOW + CHART_CACHE_FRESH_MS + 1);
  const pinned = await t.action(api.forumMarketData.read, {
    ...request,
    pinnedSymf: true,
  });
  expect(JSON.parse(pinned.payload!).pool).toBe(POOL);
  expect(
    (await t.run((ctx) => ctx.db.query("forumMarketDataCache").take(3)))
      .map((row) => row.key)
      .sort(),
  ).toEqual([key, `pinned-chart:${MINT}:15m`]);
});

test("invalid bound payloads and arbitrary pinned requests cannot claim a cached success", async () => {
  const t = setup();
  await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "bound",
  });
  for (const bad of [
    "not-json-private-text",
    payload(NOW, { mint: QUOTE }),
    payload(NOW, { interval: "1m" }),
    payload(NOW, { candles: [] }),
    payload(NOW, {
      candles: [{ time: 1, open: 10, high: 1, low: 2, close: 4, volume: 1 }],
    }),
  ])
    await expect(
      t.mutation(internal.forumMarketData.save, {
        key,
        lease: "bound",
        attemptAt: NOW,
        payload: bad,
      }),
    ).rejects.toThrow("invalid_market_cache");
  expect((await cache(t))!.payload).toBeNull();
  expect(
    await t.action(api.forumMarketData.read, {
      ...request,
      mint: QUOTE,
      pinnedSymf: true,
    }),
  ).toMatchObject({ state: "unsupported", cache: { nextRetryAt: null } });
});
