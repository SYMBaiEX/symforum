import { defineTable } from "convex/server";
import { v } from "convex/values";

export const forumMarketTables = {
  forumMarketDataCache: defineTable({
    key: v.string(),
    payload: v.union(v.string(), v.null()),
    expiresAt: v.number(),
    lease: v.string(),
    leaseUntil: v.number(),
  }).index("by_key", ["key"]),
};
