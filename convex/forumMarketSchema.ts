import { defineTable } from "convex/server";
import { v } from "convex/values";

const nullableNumber = v.union(v.number(), v.null());
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
  }).index("by_key", ["key"]),
};
