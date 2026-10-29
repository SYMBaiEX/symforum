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
  forumAlphaDeliveries: defineTable({
    installationBinding: v.optional(v.string()),
    threadId: v.id("forumThreads"),
    title: v.string(),
    body: v.string(),
    url: v.string(),
    sourceUrls: v.array(v.string()),
    sourcePublishedAt: v.number(),
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
    accountId: v.optional(v.id("xAgentAccounts")),
    accountEpoch: v.optional(v.number()),
    xText: v.optional(v.string()),
    issue: v.optional(v.string()),
  })
    .index("by_threadId", ["threadId"])
    .index("by_telegramStatus_and_createdAt", ["telegramStatus", "createdAt"])
    .index("by_xStatus_and_notBefore", ["xStatus", "notBefore"])
    .index("by_createdAt", ["createdAt"]),
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
