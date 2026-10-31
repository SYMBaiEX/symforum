import { defineTable } from "convex/server";
import { v } from "convex/values";
export const alphaStatus = v.union(
  v.literal("queued"),
  v.literal("preparing"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("held"),
  v.literal("skipped"),
);
export const forumAlphaTables = {
  // Public search evidence only. Never grants, member histories or private posts.
  forumXResearch: defineTable({
    key: v.string(), ordinal: v.optional(v.number()), nextAt: v.number(),
    lease: v.optional(v.string()), status: v.union(v.literal("reading"), v.literal("ready"), v.literal("unavailable")),
    fetchedAt: v.number(), expiresAt: v.number(),
    posts: v.array(v.object({ id: v.string(), authorId: v.string(), username: v.string(), text: v.string(), publishedAt: v.number() })),
  }).index("by_key", ["key"]),
  // Admission is recorded atomically with workflow start. Even a skipped,
  // rejected or uncertain run cannot re-admit this source or agent/day slot.
  forumAlphaDeskRuns: defineTable({
    sourceKey: v.string(),
    sourcePublishedAt: v.number(),
    agentSlug: v.string(),
    runDate: v.string(),
    workflowId: v.string(),
    priority: v.union(
      v.literal("urgent"),
      v.literal("priority"),
      v.literal("routine"),
    ),
    createdAt: v.number(),
  })
    .index("by_sourceKey", ["sourceKey"])
    .index("by_runDate", ["runDate"])
    .index("by_createdAt", ["createdAt"]),
  forumAlphaDeliveries: defineTable({
    installationBinding: v.optional(v.string()),
    threadId: v.id("forumThreads"),
    title: v.string(),
    body: v.string(),
    url: v.string(),
    sourceUrls: v.array(v.string()),
    sourcePublishedAt: v.number(),
    newsPriority: v.optional(
      v.union(v.literal("urgent"), v.literal("priority"), v.literal("routine")),
    ),
    topicId: v.number(),
    telegramStatus: alphaStatus,
    xStatus: alphaStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
    telegramMessageId: v.optional(v.number()),
    telegramSentAt: v.optional(v.number()),
    notBefore: v.number(),
    expiresAt: v.number(),
    xPostId: v.optional(v.string()),
    xOperationId: v.optional(v.id("xAgentOperations")),
    xSentAt: v.optional(v.number()),
    accountId: v.optional(v.id("xAgentAccounts")),
    accountEpoch: v.optional(v.number()),
    xText: v.optional(v.string()),
    issue: v.optional(v.string()),
  })
    .index("by_threadId", ["threadId"])
    .index("by_telegramStatus_and_createdAt", ["telegramStatus", "createdAt"])
    .index("by_xStatus_and_notBefore", ["xStatus", "notBefore"])
    .index("by_createdAt", ["createdAt"])
    .index("by_telegramSentAt", ["telegramSentAt"])
    .index("by_xSentAt", ["xSentAt"]),
  // Operators verify a handle on an original project website before adding it.
  forumAlphaProjects: defineTable({
    name: v.optional(v.string()),
    host: v.string(),
    username: v.string(),
    proofUrl: v.string(),
    verifiedBy: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_host", ["host"])
    .index("by_updatedAt", ["updatedAt"]),
};
