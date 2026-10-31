import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { RateLimiter } from "@convex-dev/rate-limiter";
import {
  action,
  internalMutation,
  type MutationCtx,
  env,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  claimDexSnapshot,
  dexSnapshot,
  freshDexSnapshot,
  normalizeDexPairs,
  parseDexSnapshot,
  completeSnapshotRef,
} from "./forumMarketSnapshot";
import { commerceLimiter } from "./forumCommerce";
import {
  marketFailureCodeValidator,
  marketFailureStageValidator,
  marketCandleProviderValidator,
} from "./forumMarketSchema";
import { SYMF_TOKEN } from "../lib/symf-token";
import { isSolanaAddress, record } from "../lib/forum-commerce";
import type { TerminalMarket } from "../lib/forum-terminal-model";
import {
  readPublicMarket,
  selectMarketBinding,
  marketPrice,
  MARKET_QUOTES,
} from "../lib/terminal-market-source";
import {
  parseMarketCandles,
  SYMF_CHART_INTERVALS,
  type SymfChartInterval,
} from "../lib/symf-market-data";
import {
  parseMarketStats,
  parseMarketTrades,
} from "../lib/symf-market-overview";
import { readTrackerCandles } from "../lib/tracker-market-candles";
import {
  CHART_CACHE_FRESH_MS,
  CHART_CACHE_RETENTION_MS,
  CHART_CACHE_LEASE_MS,
  PublicMarketSourceError,
  marketFailureBackoff,
  nextMarketBudgetReset,
  type MarketCacheView,
  type MarketFailureStage,
  type MarketFailureCode,
  type MarketCandleProvider,
} from "../lib/chart-cache-policy";

const limiter = new RateLimiter(components.rateLimiter, {
  terminalReadDaily: {
    kind: "fixed window",
    rate: 100,
    period: 86_400_000,
    start: 0,
  },
  terminalMarketBurst: {
    kind: "token bucket",
    rate: 1,
    period: 1500,
    capacity: 1,
  },
});
export const marketReadLimiter = limiter;
const kind = v.union(v.literal("chart"), v.literal("market"));
const state = v.union(
  v.literal("ready"),
  v.literal("loading"),
  v.literal("deferred"),
  v.literal("unavailable"),
  v.literal("budget"),
  v.literal("unsupported"),
);
const cacheStatus = v.object({
  lastSuccessAt: v.union(v.number(), v.null()),
  lastAttemptAt: v.union(v.number(), v.null()),
  nextRetryAt: v.union(v.number(), v.null()),
  failureCount: v.number(),
  failureStage: v.union(marketFailureStageValidator, v.null()),
  failureCode: v.union(marketFailureCodeValidator, v.null()),
  failureProvider: v.optional(v.union(marketCandleProviderValidator, v.null())),
});
const view = v.object({
  state,
  payload: v.union(v.string(), v.null()),
  stale: v.boolean(),
  cache: cacheStatus,
});
const noFetch = {
  fetch: false,
  candleProvider: null,
  marketSnapshot: null,
  marketCheckedAt: null,
  fetchSnapshot: false,
} as const;
type ClaimedView = MarketCacheView & {
  fetch: boolean;
  candleProvider: MarketCandleProvider | null;
  marketSnapshot: string | null;
  marketCheckedAt: number | null;
  fetchSnapshot: boolean;
};
const getMarket = makeFunctionReference<
  "query",
  { mint: string; now: number },
  TerminalMarket | null
>("forumTerminal:getMarket");
type CacheRow = Doc<"forumMarketDataCache">;
type ReadArgs = {
  mint: string;
  kind: "chart" | "market";
  interval: string;
  pinnedSymf?: boolean;
};
const cacheKey = (args: ReadArgs) =>
  `${args.pinnedSymf ? "pinned-chart" : args.kind}:${args.mint}:${args.kind === "chart" ? args.interval : "all"}`;
const stamp = (value: number | undefined): number | null =>
  Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
const count = (value: number | undefined) =>
  Number.isSafeInteger(value) && Number(value) >= 0
    ? Math.min(1000, Number(value))
    : 0;

function successAt(row: CacheRow | null): number | null {
  if (!row) return null;
  if (stamp(row.lastSuccessAt)) return stamp(row.lastSuccessAt);
  // Legacy payload time is retained; a new request never renews its age.
  try {
    return stamp(record(JSON.parse(row.payload ?? "null")).checkedAt as number);
  } catch {
    return null;
  }
}
function retainedUntil(row: CacheRow | null) {
  const success = successAt(row);
  return success === null
    ? 0
    : Math.min(
        row?.retainUntil ?? success + CHART_CACHE_RETENTION_MS,
        success + CHART_CACHE_RETENTION_MS,
      );
}
function attemptAt(row: CacheRow | null) {
  return (
    stamp(row?.lastAttemptAt) ??
    (row?.leaseUntil ? stamp(row.leaseUntil - CHART_CACHE_LEASE_MS) : null)
  );
}
function retryAt(row: CacheRow | null) {
  if (!row) return null;
  return (
    stamp(row.nextAttemptAt) ??
    (row.leaseUntil > 0 && attemptAt(row) !== null
      ? Math.max(
          row.leaseUntil,
          attemptAt(row)! + marketFailureBackoff(count(row.failureCount) + 1),
        )
      : stamp(row.expiresAt))
  );
}
function persistedView(row: CacheRow | null, now: number): MarketCacheView {
  const lastSuccessAt = successAt(row);
  const payload =
    row?.payload &&
    lastSuccessAt !== null &&
    lastSuccessAt <= now + 60_000 &&
    retainedUntil(row) > now
      ? row.payload
      : null;
  const fresh =
    payload !== null &&
    lastSuccessAt !== null &&
    now < lastSuccessAt + CHART_CACHE_FRESH_MS;
  const pending = Boolean(row && row.leaseUntil > now);
  const incomplete = Boolean(
    row && row.leaseUntil > 0 && row.leaseUntil <= now,
  );
  return {
    state: pending
      ? "loading"
      : fresh
        ? "ready"
        : row?.failureCode === "budget"
          ? "budget"
          : "unavailable",
    payload,
    stale: payload !== null && !fresh,
    cache: {
      lastSuccessAt,
      lastAttemptAt: attemptAt(row),
      nextRetryAt: retryAt(row),
      failureCount: Math.min(
        1000,
        count(row?.failureCount) + (incomplete ? 1 : 0),
      ),
      failureStage: incomplete ? "cache" : (row?.failureStage ?? null),
      failureCode: incomplete ? "incomplete" : (row?.failureCode ?? null),
      failureProvider: incomplete
        ? null
        : (row?.failureProvider ??
          (row?.failureStage === "candles" ? "geckoterminal" : null)),
    },
  };
}
function unsupported(): MarketCacheView {
  return {
    state: "unsupported",
    payload: null,
    stale: false,
    cache: {
      lastSuccessAt: null,
      lastAttemptAt: null,
      nextRetryAt: null,
      failureCount: 0,
      failureStage: "admission",
      failureCode: "unsupported",
    },
  };
}
async function allowed(ctx: MutationCtx, args: ReadArgs, now: number) {
  if (
    !isSolanaAddress(args.mint) ||
    !Object.hasOwn(SYMF_CHART_INTERVALS, args.interval) ||
    (args.pinnedSymf &&
      (args.mint !== SYMF_TOKEN.mint || args.kind !== "chart"))
  )
    return false;
  if (args.mint === SYMF_TOKEN.mint) return true;
  const market = await ctx.runQuery(getMarket, { mint: args.mint, now });
  return Boolean(
    market &&
    Number.isFinite(market.metricsAsOf) &&
    market.metricsAsOf >= now - CHART_CACHE_RETENTION_MS &&
    market.metricsAsOf <= now + 60_000,
  );
}
function keyArgs(key: string): ReadArgs | null {
  const [type, mint, interval, extra] = key.split(":");
  if (
    extra ||
    !mint ||
    !interval ||
    !["chart", "pinned-chart", "market"].includes(type)
  )
    return null;
  return {
    mint,
    kind: type === "market" ? "market" : "chart",
    interval: type === "market" ? "15m" : interval,
    pinnedSymf: type === "pinned-chart",
  };
}
function validPayloadShape(
  payload: Record<string, unknown>,
  type: ReadArgs["kind"],
  checkedAt: number,
) {
  const stats = record(payload.stats);
  if (
    !["marketCap", "fdv", "liquidity", "volume24h"].every(
      (key) =>
        key in stats &&
        (stats[key] === null ||
          (typeof stats[key] === "number" &&
            Number.isFinite(stats[key]) &&
            Number(stats[key]) >= 0)),
    )
  )
    return false;
  if (type === "market")
    return (
      payload.trades === null ||
      (Array.isArray(payload.trades) && payload.trades.length <= 20)
    );
  if (
    !Array.isArray(payload.candles) ||
    payload.candles.length < 1 ||
    payload.candles.length > 200 ||
    new Set(payload.candles.map((raw) => record(raw).time)).size !==
      payload.candles.length
  )
    return false;
  return payload.candles.every((raw) => {
    const candle = record(raw);
    if (
      !["time", "open", "high", "low", "close"].every(
        (key) =>
          typeof candle[key] === "number" &&
          Number.isFinite(candle[key]) &&
          Number(candle[key]) > 0,
      ) ||
      typeof candle.volume !== "number" ||
      !Number.isFinite(candle.volume) ||
      candle.volume < 0
    )
      return false;
    return (
      Number.isSafeInteger(candle.time) &&
      Number(candle.time) * 1000 <= checkedAt + 60_000 &&
      Number(candle.high) >=
        Math.max(Number(candle.open), Number(candle.close)) &&
      Number(candle.low) <=
        Math.min(Number(candle.open), Number(candle.close)) &&
      Number(candle.low) <= Number(candle.high)
    );
  });
}
function cleanupDeadline(row: CacheRow) {
  const historyAt = attemptAt(row) ?? successAt(row) ?? row._creationTime;
  // Negative history must outlive its next retry, or a cold outage would reset
  // the failure streak each time its short backoff expires.
  return Math.max(
    retainedUntil(row),
    retryAt(row) ?? 0,
    row.leaseUntil,
    historyAt + CHART_CACHE_RETENTION_MS,
  );
}
async function scheduleCleanup(ctx: MutationCtx, row: CacheRow, now: number) {
  const deadline = cleanupDeadline(row);
  if (row.cleanupAt === deadline) return;
  await ctx.db.patch("forumMarketDataCache", row._id, { cleanupAt: deadline });
  await ctx.scheduler.runAfter(
    Math.max(1, deadline - now + 1),
    internal.forumMarketData.expire,
    { id: row._id },
  );
}

export const claim = internalMutation({
  args: {
    mint: v.string(),
    kind,
    interval: v.string(),
    lease: v.string(),
    pinnedSymf: v.optional(v.boolean()),
  },
  returns: v.object({
    ...view.fields,
    fetch: v.boolean(),
    candleProvider: v.union(marketCandleProviderValidator, v.null()),
    marketSnapshot: v.union(v.string(), v.null()),
    marketCheckedAt: v.union(v.number(), v.null()),
    fetchSnapshot: v.boolean(),
  }),
  handler: async (ctx, args): Promise<ClaimedView> => {
    const now = Date.now();
    if (
      !args.lease.trim() ||
      args.lease.length > 128 ||
      !(await allowed(ctx, args, now))
    )
      return { ...unsupported(), ...noFetch };
    const key = cacheKey(args);
    const row = await ctx.db
      .query("forumMarketDataCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const current = persistedView(row, now);
    if (
      (current.payload !== null && !current.stale) ||
      (current.cache.nextRetryAt ?? 0) > now ||
      (row?.leaseUntil ?? 0) > now
    )
      return { ...current, ...noFetch };
    const source = await dexSnapshot(ctx, args.mint);
    const sourcePayload = freshDexSnapshot(source, now);
    if (
      sourcePayload === null &&
      source &&
      (source.nextAttemptAt > now || source.leaseUntil > now)
    )
      return {
        ...current,
        ...noFetch,
        state: "deferred",
        cache: {
          ...current.cache,
          nextRetryAt: Math.max(source.nextAttemptAt, source.leaseUntil),
          failureStage: "pool",
          failureCode:
            source.leaseUntil > 0
              ? "incomplete"
              : (source.failureCode ?? "invalid-response"),
        },
      };
    const burst = await limiter.limit(ctx, "terminalMarketBurst", {
      key: "all",
    });
    if (!burst.ok)
      return {
        ...current,
        state: "deferred",
        ...noFetch,
        cache: {
          ...current.cache,
          nextRetryAt: now + 1500,
          failureStage: "admission",
          failureCode: "burst",
        },
      };
    const sub = await limiter.limit(ctx, "terminalReadDaily", {
      key: "all",
      count: sourcePayload === null ? 2 : 1,
    });
    const shared =
      sub.ok &&
      (await commerceLimiter.limit(ctx, "commerceNetworkDaily", {
        key: "all",
        count: sourcePayload === null ? 2 : 1,
      }));
    const admitted = Boolean(shared && shared.ok);
    if (admitted && sourcePayload === null)
      await claimDexSnapshot(ctx, source, args.mint, args.lease, now);
    const candleProvider: MarketCandleProvider | undefined =
      args.kind === "chart"
        ? args.mint === SYMF_TOKEN.mint &&
          Boolean(env.SOLANA_TRACKER_API_KEY?.trim()) &&
          row?.leaseUntil === 0 &&
          row.failureStage === "candles" &&
          row.failureCode !== undefined &&
          row.failureCode !== "incomplete" &&
          (current.cache.failureProvider === "geckoterminal" ||
            (current.cache.failureProvider === "solana-tracker" &&
              row.failureCode === "candle-window"))
          ? "solana-tracker"
          : "geckoterminal"
        : undefined;
    const value = {
      key,
      payload: current.payload,
      expiresAt: row?.expiresAt ?? 0,
      lease: args.lease,
      leaseUntil: admitted ? now + CHART_CACHE_LEASE_MS : 0,
      lastSuccessAt: current.cache.lastSuccessAt ?? undefined,
      retainUntil: retainedUntil(row),
      cleanupAt: row?.cleanupAt,
      lastAttemptAt: admitted
        ? now
        : (current.cache.lastAttemptAt ?? undefined),
      nextAttemptAt: admitted
        ? now + marketFailureBackoff(current.cache.failureCount + 1)
        : nextMarketBudgetReset(now),
      failureCount: current.cache.failureCount,
      failureStage: admitted
        ? (current.cache.failureStage ?? undefined)
        : ("admission" as const),
      failureCode: admitted
        ? (current.cache.failureCode ?? undefined)
        : ("budget" as const),
      failureProvider: admitted ? row?.failureProvider : undefined,
      attemptProvider: admitted ? candleProvider : undefined,
    };
    const id = row
      ? row._id
      : await ctx.db.insert("forumMarketDataCache", value);
    if (row) await ctx.db.replace("forumMarketDataCache", id, value);
    const persisted = await ctx.db.get("forumMarketDataCache", id);
    await scheduleCleanup(ctx, persisted!, now);
    return {
      ...persistedView(persisted, now),
      fetch: admitted,
      candleProvider: admitted ? (candleProvider ?? null) : null,
      marketSnapshot: admitted ? sourcePayload : null,
      marketCheckedAt:
        admitted && sourcePayload !== null ? source!.checkedAt : null,
      fetchSnapshot: admitted && sourcePayload === null,
    };
  },
});

export const save = internalMutation({
  args: {
    key: v.string(),
    lease: v.string(),
    attemptAt: v.optional(v.number()),
    payload: v.union(v.string(), v.null()),
    failureStage: v.optional(marketFailureStageValidator),
    failureCode: v.optional(marketFailureCodeValidator),
    retryAfterAt: v.optional(v.number()),
    candleProvider: v.optional(marketCandleProviderValidator),
  },
  returns: view,
  handler: async (ctx, args): Promise<MarketCacheView> => {
    const now = Date.now();
    const row = await ctx.db
      .query("forumMarketDataCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const request = keyArgs(args.key);
    if (!request || !(await allowed(ctx, request, now))) return unsupported();
    // Legacy and late callbacks cannot mutate a current/newer attempt.
    if (
      !row ||
      row.lease !== args.lease ||
      row.leaseUntil <= now ||
      args.attemptAt === undefined ||
      row.lastAttemptAt !== args.attemptAt ||
      (row.nextAttemptAt ?? 0) <= now
    )
      return persistedView(row, now);
    let checkedAt: number | null = null;
    const candleProvider =
      args.candleProvider ?? row.attemptProvider ?? "geckoterminal";
    if (
      args.candleProvider !== undefined &&
      args.candleProvider !== row.attemptProvider
    )
      return persistedView(row, now);
    if (args.payload !== null) {
      if (args.payload.length > 200_000) throw Error("invalid_market_cache");
      let payload: Record<string, unknown>;
      try {
        payload = record(JSON.parse(args.payload));
      } catch {
        throw Error("invalid_market_cache");
      }
      checkedAt = stamp(payload.checkedAt as number);
      if (
        !checkedAt ||
        checkedAt < args.attemptAt ||
        checkedAt > now + 60_000 ||
        (payload.marketCheckedAt !== undefined &&
          (!Number.isSafeInteger(payload.marketCheckedAt) ||
            Number(payload.marketCheckedAt) <= 0 ||
            Number(payload.marketCheckedAt) > checkedAt ||
            checkedAt - Number(payload.marketCheckedAt) >=
              CHART_CACHE_FRESH_MS)) ||
        payload.mint !== request.mint ||
        !isSolanaAddress(String(payload.pool)) ||
        !MARKET_QUOTES.includes(
          payload.quote as (typeof MARKET_QUOTES)[number],
        ) ||
        (request.kind === "chart" && payload.interval !== request.interval) ||
        (request.kind === "chart" &&
          payload.candleSource !== undefined &&
          payload.candleSource !== candleProvider) ||
        (request.kind === "chart" &&
          candleProvider === "solana-tracker" &&
          payload.candleSource !== "solana-tracker") ||
        (request.pinnedSymf &&
          (payload.pool !== SYMF_TOKEN.pool ||
            payload.quote !== MARKET_QUOTES[0])) ||
        !validPayloadShape(payload, request.kind, checkedAt)
      )
        throw Error("invalid_market_cache");
    }
    const failures =
      args.payload !== null ? 0 : Math.min(1000, count(row.failureCount) + 1);
    const retryAfterAt = stamp(args.retryAfterAt);
    const nextAttemptAt =
      checkedAt !== null
        ? Math.max(
            checkedAt + CHART_CACHE_FRESH_MS,
            retryAfterAt !== null
              ? Math.min(retryAfterAt, now + CHART_CACHE_RETENTION_MS)
              : 0,
          )
        : Math.max(
            row.nextAttemptAt ?? 0,
            now + marketFailureBackoff(failures),
            retryAfterAt !== null
              ? Math.min(retryAfterAt, now + CHART_CACHE_RETENTION_MS)
              : 0,
          );
    const old = persistedView(row, now);
    await ctx.db.patch("forumMarketDataCache", row._id, {
      payload: args.payload ?? old.payload,
      expiresAt:
        checkedAt !== null ? checkedAt + CHART_CACHE_FRESH_MS : row.expiresAt,
      lastSuccessAt: checkedAt ?? successAt(row) ?? undefined,
      retainUntil:
        checkedAt !== null
          ? checkedAt + CHART_CACHE_RETENTION_MS
          : retainedUntil(row),
      nextAttemptAt,
      leaseUntil: 0,
      failureCount: failures,
      failureStage:
        args.failureStage ?? (args.payload === null ? "cache" : undefined),
      failureCode:
        args.failureCode ??
        (args.payload === null ? "invalid-response" : undefined),
      failureProvider:
        args.failureStage === "candles" ? candleProvider : undefined,
    });
    const persisted = await ctx.db.get("forumMarketDataCache", row._id);
    await scheduleCleanup(ctx, persisted!, now);
    return persistedView(persisted, now);
  },
});
export const expire = internalMutation({
  args: { id: v.id("forumMarketDataCache") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("forumMarketDataCache", id);
    if (row) {
      const now = Date.now();
      if (cleanupDeadline(row) <= now)
        await ctx.db.delete("forumMarketDataCache", id);
      // Current writes already own their timer; obsolete callbacks die here.
      else if (row.cleanupAt === undefined)
        await scheduleCleanup(ctx, row, now);
    }
    return null;
  },
});

function safeFailure(error: unknown): {
  code: MarketFailureCode;
  retryAfterAt?: number;
} {
  if (error instanceof PublicMarketSourceError)
    return {
      code: error.code,
      ...(error.retryAfterAt !== null
        ? { retryAfterAt: error.retryAfterAt }
        : {}),
    };
  return {
    code:
      error instanceof Error && error.message === "market_pool_unavailable"
        ? "pool-unavailable"
        : "invalid-response",
  };
}
export const read = action({
  args: {
    mint: v.string(),
    kind,
    interval: v.optional(v.string()),
    pinnedSymf: v.optional(v.boolean()),
  },
  returns: view,
  handler: async (ctx, args): Promise<MarketCacheView> => {
    const interval = args.interval ?? "15m",
      lease = crypto.randomUUID();
    const request = { ...args, interval };
    const reserved: ClaimedView = await ctx.runMutation(
      internal.forumMarketData.claim,
      {
        ...request,
        lease,
      },
    );
    if (!reserved.fetch) {
      const {
        fetch: ignored,
        candleProvider: ignoredProvider,
        marketSnapshot: ignoredSnapshot,
        marketCheckedAt: ignoredMarketTime,
        fetchSnapshot: ignoredSnapshotFetch,
        ...current
      } = reserved;
      void ignored;
      void ignoredProvider;
      void ignoredSnapshot;
      void ignoredMarketTime;
      void ignoredSnapshotFetch;
      return current;
    }
    let payload: string | null = null;
    let stage: MarketFailureStage = "pool";
    let diagnostic: { code: MarketFailureCode; retryAfterAt?: number } | null =
      null;
    let diagnosticStage: MarketFailureStage | undefined;
    try {
      let sourcePayload = reserved.marketSnapshot;
      let marketCheckedAt = reserved.marketCheckedAt;
      if (reserved.fetchSnapshot) {
        try {
          const raw = await readPublicMarket(
            `https://api.dexscreener.com/token-pairs/v1/solana/${args.mint}`,
            200_000,
          );
          const normalized = normalizeDexPairs(raw, args.mint);
          if (normalized.length === 0) throw Error("market_pool_unavailable");
          sourcePayload = JSON.stringify(normalized);
          marketCheckedAt = Date.now();
          const saved: boolean = await ctx.runMutation(completeSnapshotRef, {
            mint: args.mint,
            lease,
            attemptAt: reserved.cache.lastAttemptAt!,
            payload: sourcePayload,
            checkedAt: marketCheckedAt,
          });
          if (!saved)
            throw new PublicMarketSourceError(
              "incomplete",
              "market_source_expired",
            );
        } catch (error) {
          const failure = safeFailure(error);
          await ctx.runMutation(completeSnapshotRef, {
            mint: args.mint,
            lease,
            attemptAt: reserved.cache.lastAttemptAt!,
            payload: null,
            checkedAt: Date.now(),
            failureCode: failure.code,
            retryAfterAt: failure.retryAfterAt,
          });
          throw error;
        }
      }
      if (
        sourcePayload === null ||
        marketCheckedAt === null ||
        Date.now() - marketCheckedAt >= CHART_CACHE_FRESH_MS
      )
        throw new PublicMarketSourceError(
          "incomplete",
          "market_source_expired",
        );
      const sourcePairs = parseDexSnapshot(sourcePayload, args.mint);
      const pairs = sourcePairs.map((pair) => ({
        chainId: "solana",
        pairAddress: pair.pool,
        baseToken: { address: pair.mint },
        quoteToken: { address: pair.quote },
        priceUsd: pair.priceUsd === null ? null : String(pair.priceUsd),
        marketCap: pair.stats.marketCap,
        fdv: pair.stats.fdv,
        liquidity: { usd: pair.stats.liquidity },
        volume: { h24: pair.stats.volume24h },
      }));
      const poolCandidates = args.pinnedSymf
        ? Array.isArray(pairs) && pairs.length <= 100
          ? pairs.filter((pair) => record(pair).pairAddress === SYMF_TOKEN.pool)
          : []
        : pairs;
      const binding = selectMarketBinding(poolCandidates, args.mint);
      if (
        args.pinnedSymf &&
        (binding.pool !== SYMF_TOKEN.pool || binding.quote !== MARKET_QUOTES[0])
      )
        throw Error("market_pool_unavailable");
      const checkedAt = Date.now();
      if (args.kind === "chart") {
        stage = "candles";
        const options = SYMF_CHART_INTERVALS[interval as SymfChartInterval];
        let candles;
        if (reserved.candleProvider === "solana-tracker") {
          const apiKey = env.SOLANA_TRACKER_API_KEY?.trim();
          if (!apiKey)
            throw new PublicMarketSourceError(
              "budget",
              "market_provider_unavailable",
            );
          const quota: boolean = await ctx.runMutation(
            internal.tokenAlphaData.reserveApiRequest,
            { kind: "candle" },
          );
          if (!quota)
            throw new PublicMarketSourceError(
              "budget",
              "market_provider_unavailable",
            );
          candles = await readTrackerCandles(
            binding,
            interval as SymfChartInterval,
            checkedAt,
            apiKey,
          );
        } else {
          const data = await readPublicMarket(
            `https://api.geckoterminal.com/api/v2/networks/solana/pools/${binding.pool}/ohlcv/${options.timeframe}?${new URLSearchParams({ aggregate: options.aggregate, limit: "120", currency: "usd", token: binding.mint })}`,
            150_000,
          );
          candles = parseMarketCandles(
            data,
            checkedAt,
            binding,
            "explicit-mint",
          );
        }
        payload = JSON.stringify({
          ...binding,
          interval,
          checkedAt,
          marketCheckedAt,
          stats: parseMarketStats(pairs, binding),
          priceUsd: marketPrice(pairs, binding),
          candles,
          candleSource: reserved.candleProvider ?? "geckoterminal",
        });
      } else {
        const stats = parseMarketStats(pairs, binding);
        let trades = null;
        stage = "trades";
        try {
          const data = await readPublicMarket(
            `https://api.geckoterminal.com/api/v2/networks/solana/pools/${binding.pool}/trades?trade_volume_in_usd_greater_than=0`,
            1_000_000,
          );
          trades = parseMarketTrades(data, checkedAt, binding);
        } catch (error) {
          diagnostic = safeFailure(error);
          diagnosticStage = "trades";
        }
        // Valid statistics remain independently useful; failed trades are null.
        payload = JSON.stringify({
          ...binding,
          checkedAt,
          marketCheckedAt,
          stats,
          trades,
        });
      }
    } catch (error) {
      diagnostic = safeFailure(error);
      diagnosticStage = stage;
    }
    if (diagnostic)
      console.warn("public_market_fetch_failed", {
        stage: diagnosticStage,
        code: diagnostic.code,
        failureCount: payload === null ? reserved.cache.failureCount + 1 : 0,
      });
    return await ctx.runMutation(internal.forumMarketData.save, {
      key: cacheKey(request),
      lease,
      ...(args.kind === "chart"
        ? { candleProvider: reserved.candleProvider ?? "geckoterminal" }
        : {}),
      attemptAt: reserved.cache.lastAttemptAt ?? undefined,
      payload,
      ...(diagnostic
        ? {
            failureStage: diagnosticStage,
            failureCode: diagnostic.code,
            retryAfterAt: diagnostic.retryAfterAt,
          }
        : {}),
    });
  },
});
