import { RateLimiter } from "@convex-dev/rate-limiter";
import { FORUM_READ_POLICY } from "../lib/forum-read-policy";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { isSolanaAddress } from "../lib/forum-commerce";
import { TERMINAL_RETENTION_MS } from "../lib/forum-terminal-data";
import type { TerminalMarketRefreshResult } from "../lib/forum-terminal-model";
import {
  MARKET_REFRESH_MAX_MINTS,
  MARKET_REFRESH_WINDOW_MS,
  marketRefreshUrl,
  parseMarketRefresh,
  type RefreshedMarket,
} from "../lib/terminal-market-refresh-source";
import { readPublicMarket } from "../lib/terminal-market-source";
import { components } from "./_generated/api";
import {
  action,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { commerceLimiter } from "./forumCommerce";
import { marketReadLimiter, marketProviderFetch } from "./forumMarketData";
import { refreshedMarketValidator } from "./forumMarketSchema";

const LEASE_MS = 25_000;
const refreshLimiter = new RateLimiter(components.rateLimiter, {
  terminalSampleRefreshDaily: {
    kind: "fixed window",
    rate: FORUM_READ_POLICY.marketSampleDailyRefreshes,
    period: 86_400_000,
    start: 0,
  },
});
const refreshState = v.union(
  v.literal("ready"),
  v.literal("loading"),
  v.literal("deferred"),
  v.literal("budget"),
  v.literal("unavailable"),
);
const resultValidator = v.object({
  state: refreshState,
  checkedAt: v.union(v.number(), v.null()),
  nextRefreshAt: v.union(v.number(), v.null()),
});
type ClaimResult = TerminalMarketRefreshResult & {
  fetch: boolean;
  mints: string[];
};

async function allowedMarket(ctx: MutationCtx, mint: string, now: number) {
  const row = await ctx.db
    .query("forumTerminalMarkets")
    .withIndex("by_mint", (q) => q.eq("mint", mint))
    .unique();
  return (
    row &&
    row.mint === row.snapshot.mint &&
    isSolanaAddress(row.mint) &&
    row.observedAt >= now - TERMINAL_RETENTION_MS &&
    row.observedAt <= now + 60_000 &&
    row.snapshot.metricsAsOf >= now - TERMINAL_RETENTION_MS &&
    row.snapshot.metricsAsOf <= now + 60_000
  );
}

export const claim = internalMutation({
  args: { lease: v.string() },
  returns: v.object({
    ...resultValidator.fields,
    fetch: v.boolean(),
    mints: v.array(v.string()),
  }),
  handler: async (ctx, { lease }): Promise<ClaimResult> => {
    if (!lease.trim() || lease.length > 128)
      throw Error("invalid_refresh_lease");
    const now = Date.now();
    const row = await ctx.db
      .query("forumMarketSampleCache")
      .withIndex("by_key", (q) => q.eq("key", "markets"))
      .unique();
    if (row && row.nextRefreshAt > now)
      return {
        fetch: false,
        mints: [],
        state:
          row.status === "loading" && row.leaseUntil <= now
            ? "unavailable"
            : row.status,
        checkedAt: row.checkedAt,
        nextRefreshAt: row.nextRefreshAt,
      };
    const windowStart =
      Math.floor(now / MARKET_REFRESH_WINDOW_MS) * MARKET_REFRESH_WINDOW_MS;
    const nextRefreshAt = now + MARKET_REFRESH_WINDOW_MS;
    const cohorts = await Promise.all(
      (["bags", "pumpfun"] as const).map((platform) =>
        ctx.db
          .query("forumTerminalMarkets")
          .withIndex("by_platform_and_observedAt", (q) =>
            q
              .eq("platform", platform)
              .gte("observedAt", now - TERMINAL_RETENTION_MS)
              .lte("observedAt", now + 60_000),
          )
          .order("desc")
          .take(MARKET_REFRESH_MAX_MINTS),
      ),
    );
    const mints: string[] = [];
    // Fair deterministic interleaving reserves room for both source platforms.
    // A productive Pump lane cannot evict the only recent Bags token.
    for (
      let index = 0;
      index < MARKET_REFRESH_MAX_MINTS &&
      mints.length < MARKET_REFRESH_MAX_MINTS;
      index++
    )
      for (const cohort of cohorts) {
        const candidate = cohort[index];
        if (
          candidate &&
          mints.length < MARKET_REFRESH_MAX_MINTS &&
          isSolanaAddress(candidate.mint) &&
          candidate.snapshot.mint === candidate.mint &&
          candidate.snapshot.metricsAsOf >= now - TERMINAL_RETENTION_MS &&
          candidate.snapshot.metricsAsOf <= now + 60_000 &&
          !mints.includes(candidate.mint)
        )
          mints.push(candidate.mint);
      }
    let state: "loading" | "budget" | "unavailable" = "unavailable";
    if (mints.length) {
      const burst = await marketReadLimiter.limit(ctx, "terminalMarketBurst", {
        key: "all",
      });
      if (!burst.ok)
        return {
          fetch: false,
          mints: [],
          state: "deferred",
          checkedAt: row?.checkedAt ?? null,
          nextRefreshAt: now + 1_500,
        };
      // Every allowed transport is charged before fetch. Earlier reservations
      // remain consumed if a later gate denies; nothing is refunded or replayed.
      const own = await refreshLimiter.limit(
        ctx,
        "terminalSampleRefreshDaily",
        { key: "all" },
      );
      const terminal =
        own.ok &&
        (await marketReadLimiter.limit(ctx, "terminalReadDaily", {
          key: "all",
          count: 1,
        }));
      const shared =
        terminal &&
        terminal.ok &&
        (await commerceLimiter.limit(ctx, "commerceNetworkDaily", {
          key: "all",
          count: 1,
        }));
      state = shared && shared.ok ? "loading" : "budget";
    }
    const value = {
      key: "markets" as const,
      windowStart,
      claimedAt: now,
      nextRefreshAt,
      status: state,
      lease,
      leaseUntil: state === "loading" ? now + LEASE_MS : 0,
      mints,
      quotes: row?.quotes ?? [],
      checkedAt: row?.checkedAt ?? null,
    };
    if (row) await ctx.db.replace("forumMarketSampleCache", row._id, value);
    else await ctx.db.insert("forumMarketSampleCache", value);
    return {
      fetch: state === "loading",
      mints: state === "loading" ? mints : [],
      state,
      checkedAt: value.checkedAt,
      nextRefreshAt,
    };
  },
});

export const complete = internalMutation({
  args: {
    lease: v.string(),
    checkedAt: v.number(),
    quotes: v.union(v.array(refreshedMarketValidator), v.null()),
  },
  returns: v.union(resultValidator, v.null()),
  handler: async (
    ctx,
    { lease, checkedAt, quotes },
  ): Promise<TerminalMarketRefreshResult | null> => {
    const now = Date.now();
    const row = await ctx.db
      .query("forumMarketSampleCache")
      .withIndex("by_key", (q) => q.eq("key", "markets"))
      .unique();
    if (
      !row ||
      row.lease !== lease ||
      row.status !== "loading" ||
      row.leaseUntil <= now ||
      row.nextRefreshAt <= now
    )
      return null;
    if (
      !Number.isSafeInteger(checkedAt) ||
      checkedAt < row.claimedAt ||
      checkedAt > now + 60_000
    )
      throw Error("invalid_refresh_time");
    if (quotes === null) {
      await ctx.db.patch("forumMarketSampleCache", row._id, {
        status: "unavailable",
        leaseUntil: 0,
      });
      return {
        state: "unavailable",
        checkedAt: row.checkedAt,
        nextRefreshAt: row.nextRefreshAt,
      };
    }
    if (
      quotes.length !== row.mints.length ||
      quotes.length > MARKET_REFRESH_MAX_MINTS ||
      new Set(quotes.map((quote) => quote.mint)).size !== quotes.length
    )
      throw Error("invalid_refresh_cohort");
    for (const quote of quotes) {
      if (
        !row.mints.includes(quote.mint) ||
        quote.checkedAt !== checkedAt ||
        [
          quote.priceUsd,
          quote.marketCapUsd,
          quote.fdvUsd,
          quote.liquidityUsd,
          quote.volume1hUsd,
          quote.volume24hUsd,
        ].some(
          (value) => value !== null && (!Number.isFinite(value) || value < 0),
        ) ||
        (quote.priceChange1hPercent !== null &&
          !Number.isFinite(quote.priceChange1hPercent))
      )
        throw Error("invalid_refresh_quote");
      if (quote.state === "available") {
        const pool = quote.sourceUrl?.match(
          /^https:\/\/dexscreener\.com\/solana\/([1-9A-HJ-NP-Za-km-z]{32,44})$/,
        )?.[1];
        if (
          !pool ||
          !isSolanaAddress(pool) ||
          quote.priceUsd === null ||
          quote.priceUsd <= 0 ||
          quote.liquidityUsd === null ||
          quote.liquidityUsd <= 0
        )
          throw Error("invalid_refresh_binding");
      } else if (
        quote.sourceUrl !== null ||
        [
          quote.priceUsd,
          quote.marketCapUsd,
          quote.fdvUsd,
          quote.liquidityUsd,
          quote.volume1hUsd,
          quote.volume24hUsd,
          quote.priceChange1hPercent,
        ].some((value) => value !== null)
      )
        throw Error("invalid_unavailable_quote");
    }
    const eligible = await Promise.all(
      quotes.map((quote) => allowedMarket(ctx, quote.mint, now)),
    );
    const retained = quotes.filter((_quote, index) => eligible[index]);
    const state = retained.some((quote) => quote.state === "available")
      ? "ready"
      : "unavailable";
    await ctx.db.patch("forumMarketSampleCache", row._id, {
      quotes: retained,
      checkedAt,
      status: state,
      leaseUntil: 0,
    });
    return { state, checkedAt, nextRefreshAt: row.nextRefreshAt };
  },
});

const claimRef = makeFunctionReference<
  "mutation",
  { lease: string },
  ClaimResult
>("forumTerminalRefresh:claim");
const completeRef = makeFunctionReference<
  "mutation",
  { lease: string; checkedAt: number; quotes: RefreshedMarket[] | null },
  TerminalMarketRefreshResult | null
>("forumTerminalRefresh:complete");

/** A shared public display read. No model, wallet, posting or replay authority. */
export const refresh = action({
  args: {},
  returns: resultValidator,
  handler: async (ctx): Promise<TerminalMarketRefreshResult> => {
    const lease = crypto.randomUUID();
    const admission: ClaimResult = await ctx.runMutation(claimRef, { lease });
    const { state, checkedAt, nextRefreshAt } = admission;
    if (!admission.fetch) return { state, checkedAt, nextRefreshAt };
    let quotes: RefreshedMarket[] | null = null;
    let fetchedAt = Date.now();
    try {
      // One fixed, bounded batch. No automatic retry or alternate provider.
      const data = await readPublicMarket(
        marketRefreshUrl(admission.mints),
        1_000_000,
        marketProviderFetch(ctx),
      );
      fetchedAt = Date.now();
      quotes = parseMarketRefresh(data, admission.mints, fetchedAt);
    } catch {
      // Retain old independently dated display data and the charged slot.
    }
    const saved: TerminalMarketRefreshResult | null = await ctx.runMutation(
      completeRef,
      { lease, checkedAt: fetchedAt, quotes },
    );
    return saved ?? { state: "unavailable", checkedAt, nextRefreshAt };
  },
});
