import { defineTable } from "convex/server";
import { v } from "convex/values";

export const telegramRequestKind = v.union(
  v.literal("ask"),
  v.literal("help"),
  v.literal("menu"),
  v.literal("prompt"),
  v.literal("yap"),
);

export const telegramAgentTables = {
  telegramForumDigests: defineTable({
    key: v.string(),
    topicId: v.number(),
    from: v.number(),
    to: v.number(),
    preview: v.boolean(),
    status: v.union(
      v.literal("queued"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("held"),
      v.literal("skipped"),
    ),
    threadIds: v.array(v.id("forumThreads")),
    sentMessageId: v.optional(v.number()),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_createdAt", ["createdAt"]),
  telegramAgentConversations: defineTable({
    key: v.string(),
    agentSlug: v.string(),
    threadId: v.string(),
    createdAt: v.number(),
  }).index("by_key", ["key"]),
  // Delivery intent and deduplication tombstones, not a second chat-history store.
  // Conversation messages belong to the existing Agent component.
  telegramAgentRequests: defineTable({
    key: v.string(),
    agentSlug: v.string(),
    botId: v.string(),
    updateId: v.number(),
    messageId: v.number(),
    topicId: v.number(),
    senderId: v.string(),
    conversationId: v.string(),
    kind: telegramRequestKind,
    sourceAgentSlug: v.optional(v.string()),
    yapDay: v.optional(v.string()),
    yapRound: v.optional(v.number()),
    yapTurn: v.optional(v.number()),
    prompt: v.optional(v.string()),
    reply: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("generating"),
      v.literal("ready"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("held"),
    ),
    sentMessageId: v.optional(v.number()),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_kind_and_createdAt", ["kind", "createdAt"])
    .index("by_agentSlug_and_createdAt", ["agentSlug", "createdAt"]),
};
