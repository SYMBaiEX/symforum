import { defineTable } from "convex/server";
import { v } from "convex/values";

export const telegramRequestKind = v.union(
  v.literal("ask"),
  v.literal("help"),
  v.literal("menu"),
  v.literal("prompt"),
  v.literal("yap"),
  v.literal("meme"),
);

export const telegramAgentTables = {
  // Research topic metadata only. Confirmed discussion lives in Agent threads.
  telegramYapResearchTopics: defineTable({
    sourceThreadId: v.id("forumThreads"),
    conversationId: v.string(),
    tag: v.string(),
    createdAt: v.number(),
    lastStartedAt: v.number(),
    lastConfirmedAt: v.number(),
    hasConfirmed: v.boolean(),
    lastMessageId: v.optional(v.number()),
    lastOpenerMessageId: v.optional(v.number()),
  })
    .index("by_sourceThreadId", ["sourceThreadId"])
    .index("by_lastStartedAt", ["lastStartedAt"])
    .index("by_hasConfirmed_and_lastStartedAt", [
      "hasConfirmed",
      "lastStartedAt",
    ]),
  telegramMemeTemplates: defineTable({
    key: v.string(),
    name: v.string(),
    description: v.string(),
    storageId: v.id("_storage"),
    sourceUrl: v.string(),
    rank: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_rank", ["rank"]),
  telegramMemeAssets: defineTable({
    key: v.string(),
    kind: v.union(v.literal("reserve"), v.literal("generated")),
    media: v.union(v.literal("photo"), v.literal("animation")),
    storageId: v.optional(v.id("_storage")),
    telegramFileId: v.optional(v.string()),
    text: v.string(),
    sourceUrl: v.optional(v.string()),
    sourceName: v.optional(v.string()),
    lastUsedAt: v.number(),
    lastAttemptedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_kind_and_lastUsedAt", ["kind", "lastUsedAt"])
    .index("by_createdAt", ["createdAt"]),
  telegramMemeConfig: defineTable({
    key: v.literal("belle"),
    storageId: v.id("_storage"),
    threadId: v.optional(v.string()),
    lastQueuedAt: v.optional(v.number()),
    lastConfirmedAt: v.optional(v.number()),
    lastAssetId: v.optional(v.id("telegramMemeAssets")),
    sourceRefreshedAt: v.optional(v.number()),
    sourceError: v.optional(v.string()),
  }).index("by_key", ["key"]),
  telegramMemeFingerprints: defineTable({
    key: v.string(),
    requestId: v.id("telegramAgentRequests"),
  }).index("by_key", ["key"]),
  telegramForumDigests: defineTable({
    installationBinding: v.optional(v.string()),
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
    installationBinding: v.optional(v.string()),
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
    memeSlot: v.optional(v.number()),
    memeVersion: v.optional(v.number()),
    memeAssetId: v.optional(v.id("telegramMemeAssets")),
    memeTemplateId: v.optional(v.id("telegramMemeTemplates")),
    memeMode: v.optional(
      v.union(
        v.literal("original"),
        v.literal("template"),
        v.literal("recycle"),
        v.literal("fallback"),
      ),
    ),
    memeReview: v.optional(
      v.object({ approved: v.boolean(), issues: v.array(v.string()) }),
    ),
    memeRejectedDraft: v.optional(v.string()),
    memeFallbackReason: v.optional(v.string()),
    memeDeliveryAttempts: v.optional(v.number()),
    memeRetryAt: v.optional(v.number()),
    yapVersion: v.optional(v.union(v.literal(2), v.literal(3), v.literal(4))),
    yapResearchTopicId: v.optional(v.id("telegramYapResearchTopics")),
    yapPreviousMessageId: v.optional(v.number()),
    yapPreviousAgentSlug: v.optional(v.string()),
    yapRevisit: v.optional(v.boolean()),
    yapRoundStartedAt: v.optional(v.number()),
    yapDay: v.optional(v.string()),
    yapRound: v.optional(v.number()),
    yapTurn: v.optional(v.number()),
    prompt: v.optional(v.string()),
    reply: v.optional(v.string()),
    review: v.optional(
      v.object({
        approved: v.boolean(),
        issues: v.array(v.string()),
      }),
    ),
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
