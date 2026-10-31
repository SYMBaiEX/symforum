import { defineTable } from "convex/server";
import { v } from "convex/values";

const nullableNumber = v.union(v.number(), v.null());
export const marketFailureStageValidator = v.union(
  v.literal("admission"),
  v.literal("pool"),
  v.literal("candles"),
  v.literal("trades"),
  v.literal("cache"),
);
export const marketFailureCodeValidator = v.union(
  v.literal("burst"),
  v.literal("budget"),
  v.literal("incomplete"),
  v.literal("http-429"),
  v.literal("http-4xx"),
  v.literal("http-5xx"),
  v.literal("timeout"),
  v.literal("network"),
  v.literal("invalid-response"),
  v.literal("pool-unavailable"),
  v.literal("unsupported"),
);
export const refreshedMarketValidator = v.object({
  mint: v.string(),
  checkedAt: v.number(),
  state: v.union(v.literal("available"), v.literal("unavailable")),
  sourceUrl: v.union(v.string(), v.null()),
  priceUsd: nullableNumber,
  marketCapUsd: nullableNumber,
  fdvUsd: nullableNumber,
  liquidityUsd: nullableNumber,
  volume1hUsd: nullableNumber,
  volume24hUsd: nullableNumber,
  priceChange1hPercent: nullableNumber,
});

export const forumMarketTables = {
  // One bounded shared display cache, not financial receipts or scout evidence.
  forumMarketSampleCache: defineTable({
    key: v.literal("markets"),
    status: v.union(
      v.literal("ready"),
      v.literal("loading"),
      v.literal("budget"),
      v.literal("unavailable"),
    ),
    windowStart: v.number(),
    claimedAt: v.number(),
    nextRefreshAt: v.number(),
    lease: v.string(),
    leaseUntil: v.number(),
    mints: v.array(v.string()),
    quotes: v.array(refreshedMarketValidator),
    checkedAt: nullableNumber,
  }).index("by_key", ["key"]),
  forumMarketDataCache: defineTable({
    key: v.string(),
    payload: v.union(v.string(), v.null()),
    expiresAt: v.number(),
    lease: v.string(),
    leaseUntil: v.number(),
    lastSuccessAt: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    retainUntil: v.optional(v.number()),
    failureCount: v.optional(v.number()),
    failureStage: v.optional(marketFailureStageValidator),
    failureCode: v.optional(marketFailureCodeValidator),
    cleanupAt: v.optional(v.number()),
  }).index("by_key", ["key"]),
};
