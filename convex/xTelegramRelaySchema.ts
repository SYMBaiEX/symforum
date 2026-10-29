import { defineTable } from "convex/server";
import { v } from "convex/values";

export const relaySource = v.object({
  id: v.string(),
  authorId: v.string(),
  text: v.string(),
  createdAt: v.number(),
});
export const xTelegramRelayTables = {
  xTelegramRelayConfig: defineTable({
    installationBinding: v.optional(v.string()),
    key: v.literal("symforum"),
    enabled: v.boolean(),
    topicId: v.number(),
    enabledAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  xTelegramDeliveries: defineTable({
    installationBinding: v.optional(v.string()),
    postId: v.string(),
    topicId: v.number(),
    sourceCreatedAt: v.number(),
    text: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("held"),
    ),
    issue: v.optional(v.string()),
    messageId: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_postId", ["postId"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),
};
