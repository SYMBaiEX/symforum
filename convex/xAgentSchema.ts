import { defineTable } from "convex/server";
import { v } from "convex/values";

export const xSealed = v.object({ ciphertext: v.string(), nonce: v.string() });
export const xDraftStatus = v.union(
  v.literal("queued"),
  v.literal("generating"),
  v.literal("draft"),
  v.literal("held"),
  v.literal("archived"),
);
export const xAgentTables = {
  xAgentAccounts: defineTable({
    agentSlug: v.string(),
    ownerUserId: v.id("users"),
    expectedUsername: v.string(),
    epoch: v.number(),
    connected: v.boolean(),
    mode: v.literal("drafts"),
    xUserId: v.optional(v.string()),
    username: v.optional(v.string()),
    grant: v.optional(xSealed),
    scope: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    connectedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_agentSlug", ["agentSlug"])
    .index("by_ownerUserId", ["ownerUserId"])
    .index("by_xUserId", ["xUserId"]),
  xAgentAuthorizations: defineTable({
    stateHash: v.string(),
    accountId: v.id("xAgentAccounts"),
    ownerUserId: v.id("users"),
    epoch: v.number(),
    verifier: v.optional(xSealed),
    consumed: v.boolean(),
    expiresAt: v.number(),
  })
    .index("by_stateHash", ["stateHash"])
    .index("by_expiresAt", ["expiresAt"]),
  xAgentDrafts: defineTable({
    ownerUserId: v.id("users"),
    agentSlug: v.string(),
    accountEpoch: v.number(),
    key: v.string(),
    sourceThreadId: v.id("forumThreads"),
    brief: v.string(),
    status: xDraftStatus,
    conversationId: v.string(),
    text: v.optional(v.string()),
    issues: v.optional(v.array(v.string())),
    manuallyEdited: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerUserId", ["ownerUserId"])
    .index("by_key", ["key"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),
};
