/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { SYMF_TOKEN } from "../lib/symf-token";
import { FORUM_READ_POLICY } from "../lib/forum-read-policy";
import { MARKET_QUOTES } from "../lib/terminal-market-source";
import { marketReadLimiter } from "./forumMarketData";
import { commerceLimiter } from "./forumCommerce";
import {
  normalizeDexPairs,
  parseDexSnapshot,
  completeSnapshotRef,
  expireSnapshotRef,
} from "./forumMarketSnapshot";
import {
  CHART_CACHE_FRESH_MS,
  CHART_CACHE_RETENTION_MS,
} from "../lib/chart-cache-policy";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.parse("2026-10-31T18:00:00Z");
const pairs = [
  {
    chainId: "solana",
    pairAddress: SYMF_TOKEN.pool,
    baseToken: { address: SYMF_TOKEN.mint },
    quoteToken: { address: MARKET_QUOTES[0] },
    priceUsd: "1.5",
    marketCap: null,
    fdv: 100000,
    liquidity: { usd: 1000 },
    volume: { h24: null },
  },
];
const candles = {
  meta: {
    base: { address: SYMF_TOKEN.mint },
    quote: { address: MARKET_QUOTES[0] },
  },
  data: {
    attributes: { ohlcv_list: [[NOW / 1000 - 900, 1, 2, 0.5, 1.5, 10]] },
  },
};
function setup() {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  return t;
}
function mockTransport() {
  const fetcher = vi.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).includes("dexscreener")
            ? pairs
            : String(url).includes("/trades")
              ? { data: [] }
              : candles,
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
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

test("chart intervals and overview reuse one exact-mint DEX snapshot with independently dated statistics", async () => {
  const t = setup(),
    fetcher = mockTransport();
  const payloads: unknown[] = [];
  for (const [i, interval] of ["15m", "1m", "5m"].entries()) {
    vi.setSystemTime(NOW + i * 2000);
    const result = await t.action(api.forumMarketData.read, {
      mint: SYMF_TOKEN.mint,
      kind: "chart",
      interval,
      pinnedSymf: true,
    });
    expect(result.state).toBe("ready");
    payloads.push(JSON.parse(result.payload!));
  }
  vi.setSystemTime(NOW + 6000);
  expect(
    (
      await t.action(api.forumMarketData.read, {
        mint: SYMF_TOKEN.mint,
        kind: "market",
      })
    ).state,
  ).toBe("ready");
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("dexscreener")),
  ).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(5);
  for (const [i, payload] of payloads.entries())
    expect(payload).toMatchObject({
      checkedAt: NOW + i * 2000,
      marketCheckedAt: NOW,
      stats: { marketCap: null, volume24h: null },
    });
  expect(
    await t.run((ctx) =>
      marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: FORUM_READ_POLICY.terminalDailyUnits - 5,
      }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await t.run((ctx) =>
      marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: FORUM_READ_POLICY.terminalDailyUnits - 4,
      }),
    ),
  ).toMatchObject({ ok: false });
  expect(
    await t.run((ctx) =>
      commerceLimiter.check(ctx, "commerceNetworkDaily", {
        key: "all",
        count: FORUM_READ_POLICY.commerceDailyUnits - 5,
      }),
    ),
  ).toMatchObject({ ok: true });
});

const request = {
  mint: SYMF_TOKEN.mint,
  kind: "chart" as const,
  interval: "15m",
  pinnedSymf: true,
};
async function source(t: ReturnType<typeof setup>) {
  return t.run((ctx) =>
    ctx.db
      .query("forumDexMarketSnapshots")
      .withIndex("by_mint", (q) => q.eq("mint", SYMF_TOKEN.mint))
      .unique(),
  );
}

test("200 mixed-interval and overview readers share one source claim without extra I/O or reservations", async () => {
  const t = setup();
  let release!: (value: Response) => void;
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    String(url).includes("dexscreener")
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : new Response(JSON.stringify(candles)),
  );
  vi.stubGlobal("fetch", fetcher);
  const leader = t.action(api.forumMarketData.read, request);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const followers = await Promise.all(
    Array.from({ length: 199 }, (_, index) =>
      t.action(api.forumMarketData.read, {
        ...request,
        kind: index % 3 === 0 ? "market" : "chart",
        pinnedSymf: false,
        interval: ["1m", "5m", "15m", "1h", "4h"][index % 5],
      }),
    ),
  );
  expect(
    followers.every((r) => r.state === "deferred" || r.state === "loading"),
  ).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  release(new Response(JSON.stringify(pairs)));
  expect((await leader).state).toBe("ready");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    await t.run((ctx) =>
      marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: FORUM_READ_POLICY.terminalDailyUnits - 2,
      }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await t.run((ctx) =>
      marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: FORUM_READ_POLICY.terminalDailyUnits - 1,
      }),
    ),
  ).toMatchObject({ ok: false });
});

test.each(["negative", "timeout"])(
  "source %s is shared across intervals and preserves its backoff without new calls",
  async (failure) => {
    const t = setup();
    const fetcher = vi.fn(async () => {
      if (failure === "timeout")
        throw new DOMException("private upstream detail", "TimeoutError");
      return new Response(JSON.stringify([]));
    });
    vi.stubGlobal("fetch", fetcher);
    const first = await t.action(api.forumMarketData.read, request);
    expect(first.state).toBe("unavailable");
    const before = await source(t);
    vi.setSystemTime(NOW + 2000);
    const next = await t.action(api.forumMarketData.read, {
      ...request,
      interval: "1m",
    });
    expect(next).toMatchObject({
      state: "deferred",
      payload: null,
      cache: { nextRetryAt: before!.nextAttemptAt },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await source(t)).toEqual(before);
    expect(JSON.stringify(before)).not.toContain("private upstream");
  },
);

test("provider Retry-After and an incomplete source lease block other intervals until the original deadline", async () => {
  const t = setup();
  const fetcher = vi.fn(
    async () =>
      new Response("private", {
        status: 429,
        headers: { "retry-after": "600" },
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  await t.action(api.forumMarketData.read, request);
  vi.setSystemTime(NOW + 60_001);
  const next = await t.action(api.forumMarketData.read, {
    ...request,
    interval: "1m",
  });
  expect(next.cache.nextRetryAt).toBe(NOW + 600_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const another = setup();
  const claimed = await another.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "crashed",
  });
  expect(claimed.fetch).toBe(true);
  const crashed = await source(another);
  vi.setSystemTime(NOW + 60_001 + 25_001);
  expect(
    await another.mutation(internal.forumMarketData.claim, {
      ...request,
      interval: "5m",
      lease: "too-early",
    }),
  ).toMatchObject({ fetch: false, state: "deferred" });
  expect(await source(another)).toEqual(crashed);
});

test.each([true, false])(
  "late source completion success=%s cannot overwrite B or become old A's current result",
  async (succeeded) => {
    const t = setup();
    let release!: (response: Response) => void;
    let dex = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (!String(url).includes("dexscreener"))
        return new Response(JSON.stringify(candles));
      if (++dex === 1)
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return new Response(JSON.stringify(pairs));
    });
    vi.stubGlobal("fetch", fetcher);
    const old = t.action(api.forumMarketData.read, request);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    vi.setSystemTime((await source(t))!.nextAttemptAt + 1);
    const current = await t.action(api.forumMarketData.read, {
      ...request,
      interval: "1m",
    });
    expect(current.state).toBe("ready");
    const before = await source(t);
    release(
      new Response(
        succeeded
          ? JSON.stringify([{ ...pairs[0], marketCap: 999 }])
          : "private",
        { status: succeeded ? 200 : 503 },
      ),
    );
    const late = await old;
    expect(late.payload).toBeNull();
    expect(await source(t)).toEqual(before);
    expect(fetcher).toHaveBeenCalledTimes(3);
  },
);

test("exact expiry refuses A completion, later ABA leases fence old success and failure, and cleanup cannot erase fresh B", async () => {
  const t = setup();
  const a = await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "a",
  });
  const original = await source(t);
  const payload = JSON.stringify(normalizeDexPairs(pairs, SYMF_TOKEN.mint));
  vi.setSystemTime(NOW + 25_000);
  expect(
    await t.mutation(completeSnapshotRef, {
      mint: SYMF_TOKEN.mint,
      lease: "a",
      attemptAt: a.cache.lastAttemptAt!,
      checkedAt: Date.now(),
      payload,
    }),
  ).toBe(false);
  expect(await source(t)).toEqual(original);
  vi.setSystemTime(NOW + 60_001);
  const b = await t.mutation(internal.forumMarketData.claim, {
    ...request,
    interval: "1m",
    lease: "b",
  });
  expect(
    await t.mutation(completeSnapshotRef, {
      mint: SYMF_TOKEN.mint,
      lease: "b",
      attemptAt: b.cache.lastAttemptAt!,
      checkedAt: Date.now(),
      payload,
    }),
  ).toBe(true);
  const saved = await source(t);
  for (const stalePayload of [payload, null])
    expect(
      await t.mutation(completeSnapshotRef, {
        mint: SYMF_TOKEN.mint,
        lease: "a",
        attemptAt: a.cache.lastAttemptAt!,
        checkedAt: Date.now(),
        payload: stalePayload,
      }),
    ).toBe(false);
  await t.mutation(expireSnapshotRef, { id: saved!._id });
  expect(await source(t)).toEqual(saved);
  vi.setSystemTime(NOW + 60_001 + CHART_CACHE_FRESH_MS);
  const c = await t.mutation(internal.forumMarketData.claim, {
    ...request,
    interval: "5m",
    lease: "c",
  });
  expect(c.fetchSnapshot).toBe(true);
  expect(
    await t.mutation(completeSnapshotRef, {
      mint: SYMF_TOKEN.mint,
      lease: "b",
      attemptAt: b.cache.lastAttemptAt!,
      checkedAt: Date.now(),
      payload,
    }),
  ).toBe(false);
  expect((await source(t))!.lease).toBe("c");
});

test("missing source claim and invalid source payload cannot create a success; wrong mint remains unsupported without I/O", async () => {
  const t = setup(),
    fetcher = mockTransport();
  expect(
    await t.mutation(completeSnapshotRef, {
      mint: SYMF_TOKEN.mint,
      lease: "missing",
      attemptAt: NOW,
      checkedAt: NOW,
      payload: "[]",
    }),
  ).toBe(false);
  expect(await source(t)).toBeNull();
  expect(
    await t.action(api.forumMarketData.read, {
      mint: MARKET_QUOTES[1],
      kind: "chart",
    }),
  ).toMatchObject({ state: "unsupported", payload: null });
  expect(fetcher).not.toHaveBeenCalled();
  const claim = await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "valid",
  });
  const before = await source(t);
  await expect(
    t.mutation(completeSnapshotRef, {
      mint: SYMF_TOKEN.mint,
      lease: "valid",
      attemptAt: claim.cache.lastAttemptAt!,
      checkedAt: NOW,
      payload: JSON.stringify([{ mint: MARKET_QUOTES[1] }]),
    }),
  ).rejects.toThrow("invalid_market_snapshot");
  expect(await source(t)).toEqual(before);
});

test("only fresh complete exact-mint snapshots are reused; stale source causes a new reserved read, without renewing retained stats", async () => {
  const t = setup(),
    fetcher = mockTransport();
  const first = await t.action(api.forumMarketData.read, request);
  vi.setSystemTime(NOW + CHART_CACHE_FRESH_MS);
  const next = await t.action(api.forumMarketData.read, {
    ...request,
    interval: "1m",
  });
  expect(JSON.parse(next.payload!).marketCheckedAt).toBe(
    NOW + CHART_CACHE_FRESH_MS,
  );
  expect(JSON.parse(first.payload!).marketCheckedAt).toBe(NOW);
  expect(fetcher).toHaveBeenCalledTimes(4);
  const row = await source(t);
  vi.setSystemTime(NOW + CHART_CACHE_RETENTION_MS);
  await t.mutation(expireSnapshotRef, { id: row!._id });
  expect(await source(t)).not.toBeNull();
});

test("a completed DEX observation survives a candle failure and a different interval can reuse it", async () => {
  const t = setup();
  let fail = true;
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    String(url).includes("dexscreener")
      ? new Response(JSON.stringify(pairs))
      : fail
        ? new Response("private", { status: 503 })
        : new Response(JSON.stringify(candles)),
  );
  vi.stubGlobal("fetch", fetcher);
  expect((await t.action(api.forumMarketData.read, request)).state).toBe(
    "unavailable",
  );
  const successfulSource = await source(t);
  expect(successfulSource!.checkedAt).toBe(NOW);
  fail = false;
  vi.setSystemTime(NOW + 2000);
  const other = await t.action(api.forumMarketData.read, {
    ...request,
    interval: "1m",
  });
  expect(other.state).toBe("ready");
  expect(JSON.parse(other.payload!).marketCheckedAt).toBe(NOW);
  expect(await source(t)).toEqual(successfulSource);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test("latest source cleanup retains a new success beyond an obsolete timer and never removes it early", async () => {
  const t = setup();
  const claim = await t.mutation(internal.forumMarketData.claim, {
    ...request,
    lease: "a",
  });
  const before = await source(t);
  vi.setSystemTime(NOW + 1000);
  expect(
    await t.mutation(completeSnapshotRef, {
      mint: SYMF_TOKEN.mint,
      lease: "a",
      attemptAt: claim.cache.lastAttemptAt!,
      checkedAt: Date.now(),
      payload: JSON.stringify(normalizeDexPairs(pairs, SYMF_TOKEN.mint)),
    }),
  ).toBe(true);
  const current = await source(t);
  expect(current!.cleanupAt).toBe(NOW + 1000 + CHART_CACHE_RETENTION_MS);
  vi.setSystemTime(before!.cleanupAt + 1);
  await t.mutation(expireSnapshotRef, { id: current!._id });
  expect(await source(t)).toEqual(current);
  vi.setSystemTime(current!.cleanupAt + 1);
  await t.mutation(expireSnapshotRef, { id: current!._id });
  expect(await source(t)).toBeNull();
});

test("normalization retains authoritative null and zero, filters foreign identities, rejects duplicate/oversized or malformed saved pairs", () => {
  const normalized = normalizeDexPairs(
    [
      {
        ...pairs[0],
        marketCap: 0,
        volume: { h24: 0 },
        ignored: "raw private text",
      },
      { ...pairs[0], baseToken: { address: MARKET_QUOTES[0] } },
    ],
    SYMF_TOKEN.mint,
  );
  expect(normalized).toHaveLength(1);
  expect(normalized[0].stats).toMatchObject({ marketCap: 0, volume24h: 0 });
  expect(JSON.stringify(normalized)).not.toContain("private");
  for (const liquidity of ["1000", 0, null, -1, Infinity])
    expect(
      normalizeDexPairs(
        [{ ...pairs[0], liquidity: { usd: liquidity } }],
        SYMF_TOKEN.mint,
      ),
    ).toEqual([]);
  expect(() =>
    normalizeDexPairs([...pairs, ...pairs], SYMF_TOKEN.mint),
  ).toThrow();
  expect(() =>
    normalizeDexPairs(Array(101).fill(pairs[0]), SYMF_TOKEN.mint),
  ).toThrow();
  for (const bad of [
    { ...normalized[0], mint: MARKET_QUOTES[0] },
    { ...normalized[0], quote: "invalid" },
    { ...normalized[0], stats: { ...normalized[0].stats, liquidity: -1 } },
  ])
    expect(() =>
      parseDexSnapshot(JSON.stringify([bad]), SYMF_TOKEN.mint),
    ).toThrow();
});
