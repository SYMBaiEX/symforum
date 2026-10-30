import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { action, internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { commerceLimiter } from "./forumCommerce";
import { SYMF_TOKEN } from "../lib/symf-token";
import { isSolanaAddress } from "../lib/forum-commerce";
import type { TerminalMarket } from "../lib/forum-terminal-model";
import {
  readPublicMarket,
  selectMarketBinding,
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

const limiter = new RateLimiter(components.rateLimiter, {
  // Shared with owner terminal reads. This tightens, never raises, commerce's cap.
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
const kind = v.union(v.literal("chart"), v.literal("market"));
const state = v.union(
  v.literal("ready"),
  v.literal("loading"),
  v.literal("unavailable"),
  v.literal("budget"),
  v.literal("unsupported"),
);
const view = v.object({
  state,
  payload: v.union(v.string(), v.null()),
  stale: v.boolean(),
});
const getMarket = makeFunctionReference<
  "query",
  { mint: string; now: number },
  TerminalMarket | null
>("forumTerminal:getMarket");
const cacheKey = (mint: string, type: string, interval: string) =>
  `${type}:${mint}:${type === "chart" ? interval : "all"}`;

export const claim = internalMutation({
  args: { mint: v.string(), kind, interval: v.string(), lease: v.string() },
  returns: v.object({
    fetch: v.boolean(),
    state,
    payload: v.union(v.string(), v.null()),
    stale: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    if (
      !isSolanaAddress(args.mint) ||
      !Object.hasOwn(SYMF_CHART_INTERVALS, args.interval)
    )
      return {
        fetch: false,
        state: "unsupported" as const,
        payload: null,
        stale: false,
      };
    // Arbitrary mint requests must never create uncapped provider/cache fanout.
    if (args.mint !== SYMF_TOKEN.mint) {
      const market = await ctx.runQuery(getMarket, { mint: args.mint, now });
      if (
        !market ||
        !Number.isFinite(market.metricsAsOf) ||
        market.metricsAsOf < now - 15 * 60_000 ||
        market.metricsAsOf > now + 60_000
      )
        return {
          fetch: false,
          state: "unsupported" as const,
          payload: null,
          stale: false,
        };
    }
    const key = cacheKey(args.mint, args.kind, args.interval);
    const row = await ctx.db
      .query("forumMarketDataCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row && row.expiresAt > now)
      return {
        fetch: false,
        state: row.payload ? ("ready" as const) : ("unavailable" as const),
        payload: row.payload,
        stale: false,
      };
    if (row && row.leaseUntil > now)
      return {
        fetch: false,
        state: row.payload ? ("ready" as const) : ("loading" as const),
        payload: row.payload,
        stale: Boolean(row.payload),
      };
    const burst = await limiter.limit(ctx, "terminalMarketBurst", {
      key: "all",
    });
    if (!burst.ok)
      return {
        fetch: false,
        state: "loading" as const,
        payload: row?.payload ?? null,
        stale: Boolean(row?.payload),
      };
    const sub = await limiter.limit(ctx, "terminalReadDaily", {
      key: "all",
      count: 2,
    });
    if (!sub.ok)
      return {
        fetch: false,
        state: "budget" as const,
        payload: row?.payload ?? null,
        stale: Boolean(row?.payload),
      };
    const shared = await commerceLimiter.limit(ctx, "commerceNetworkDaily", {
      key: "all",
      count: 2,
    });
    if (!shared.ok)
      return {
        fetch: false,
        state: "budget" as const,
        payload: row?.payload ?? null,
        stale: Boolean(row?.payload),
      };
    const data = {
      key,
      payload: row?.payload ?? null,
      expiresAt: 0,
      lease: args.lease,
      leaseUntil: now + 25_000,
    };
    if (row) await ctx.db.replace("forumMarketDataCache", row._id, data);
    else await ctx.db.insert("forumMarketDataCache", data);
    return {
      fetch: true,
      state: "loading" as const,
      payload: row?.payload ?? null,
      stale: Boolean(row?.payload),
    };
  },
});

export const save = internalMutation({
  args: {
    key: v.string(),
    lease: v.string(),
    payload: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.payload && args.payload.length > 200_000)
      throw Error("invalid_market_cache");
    const row = await ctx.db
      .query("forumMarketDataCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (row && row.lease === args.lease) {
      await ctx.db.patch("forumMarketDataCache", row._id, {
        payload: args.payload,
        expiresAt: Date.now() + (args.payload ? 300_000 : 30_000),
        leaseUntil: 0,
      });
      await ctx.scheduler.runAfter(3_600_000, internal.forumMarketData.expire, {
        id: row._id,
      });
    }
    return null;
  },
});
export const expire = internalMutation({
  args: { id: v.id("forumMarketDataCache") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("forumMarketDataCache", id);
    if (row && row.expiresAt <= Date.now() && row.leaseUntil <= Date.now())
      await ctx.db.delete("forumMarketDataCache", id);
    return null;
  },
});

export const read = action({
  args: { mint: v.string(), kind, interval: v.optional(v.string()) },
  returns: view,
  handler: async (
    ctx,
    args,
  ): Promise<{
    state: "ready" | "loading" | "unavailable" | "budget" | "unsupported";
    payload: string | null;
    stale: boolean;
  }> => {
    const interval = args.interval ?? "15m",
      lease = crypto.randomUUID();
    const reserved = await ctx.runMutation(internal.forumMarketData.claim, {
      ...args,
      interval,
      lease,
    });
    if (!reserved.fetch)
      return {
        state: reserved.state,
        payload: reserved.payload,
        stale: reserved.stale,
      };
    let payload: string | null = null;
    try {
      const pairs = await readPublicMarket(
        `https://api.dexscreener.com/token-pairs/v1/solana/${args.mint}`,
        200_000,
      );
      const binding = selectMarketBinding(pairs, args.mint);
      const checkedAt = Date.now();
      if (args.kind === "chart") {
        const options = SYMF_CHART_INTERVALS[interval as SymfChartInterval];
        const data = await readPublicMarket(
          `https://api.geckoterminal.com/api/v2/networks/solana/pools/${binding.pool}/ohlcv/${options.timeframe}?${new URLSearchParams({ aggregate: options.aggregate, limit: "120", currency: "usd", token: "base" })}`,
          150_000,
        );
        payload = JSON.stringify({
          ...binding,
          interval,
          checkedAt,
          candles: parseMarketCandles(data, checkedAt, binding),
        });
      } else {
        const stats = parseMarketStats(pairs, binding);
        let trades = null;
        try {
          const data = await readPublicMarket(
            `https://api.geckoterminal.com/api/v2/networks/solana/pools/${binding.pool}/trades?trade_volume_in_usd_greater_than=0`,
            1_000_000,
          );
          trades = parseMarketTrades(data, checkedAt, binding);
        } catch {
          /* Independently valid stats remain useful when the trade source fails. */
        }
        payload = JSON.stringify({ ...binding, checkedAt, stats, trades });
      }
    } catch {
      /* Only a safe state is returned; no raw provider errors. */
    }
    await ctx.runMutation(internal.forumMarketData.save, {
      key: cacheKey(args.mint, args.kind, interval),
      lease,
      payload,
    });
    return { state: payload ? "ready" : "unavailable", payload, stale: false };
  },
});
