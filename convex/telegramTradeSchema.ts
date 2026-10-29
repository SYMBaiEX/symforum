import { defineTable } from "convex/server";
import { v } from "convex/values";
export const feedBuy = v.object({
  key: v.string(),
  pool: v.string(),
  tx: v.string(),
  occurredAt: v.number(),
  tokens: v.string(),
  spent: v.string(),
  spentSymbol: v.string(),
  usd: v.optional(v.string()),
  anomalous: v.boolean(),
});
export const telegramTradeTables = {
  telegramTradePools: defineTable({
    installationBinding: v.optional(v.string()),
    pool: v.string(),
    headId: v.union(v.string(), v.null()),
    headAt: v.union(v.number(), v.null()),
    gap: v.boolean(),
    updatedAt: v.number(),
  }).index("by_pool", ["pool"]),
  telegramTradeState: defineTable({
    installationBinding: v.optional(v.string()),
    key: v.literal("symf"),
    startedAt: v.number(),
    coverageWarning: v.boolean(),
    lastPollAt: v.optional(v.number()),
    retryAfterAt: v.optional(v.number()),
    reason: v.optional(v.string()),
  }).index("by_key", ["key"]),
  telegramTradeEvents: defineTable({
    installationBinding: v.optional(v.string()),
    ...feedBuy.fields,
    status: v.union(
      v.literal("queued"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("held"),
    ),
    createdAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_status_and_occurredAt", ["status", "occurredAt"]),
  telegramTradeBatches: defineTable({
    installationBinding: v.optional(v.string()),
    eventIds: v.array(v.id("telegramTradeEvents")),
    text: v.string(),
    status: v.union(v.literal("sending"), v.literal("sent"), v.literal("held")),
    messageId: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_status_and_createdAt", ["status", "createdAt"]),
};
