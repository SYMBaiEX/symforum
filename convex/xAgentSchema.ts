import { defineTable } from "convex/server";
import { v } from "convex/values";

export const xSealed = v.object({ ciphertext: v.string(), nonce: v.string() });
export const xActivityOptions = v.object({
  reposts: v.boolean(),
  comments: v.boolean(),
  aiRepliesApproved: v.boolean(),
  originals: v.optional(v.boolean()),
});
export const xDraftKind = v.union(
  v.literal("mascot"),
  v.literal("forum"),
  v.literal("reply"),
);
export const xOfficialPost = v.object({
  id: v.string(),
  authorId: v.string(),
  text: v.string(),
  createdAt: v.number(),
  replyEligible: v.optional(v.boolean()),
  invitationParent: v.optional(
    v.object({
      id: v.string(),
      authorId: v.string(),
      text: v.string(),
      createdAt: v.number(),
    }),
  ),
});
export const xCursor = v.object({
  userId: v.string(),
  sinceId: v.optional(v.string()),
  page: v.optional(v.string()),
  newestId: v.optional(v.string()),
});
export const xDraftStatus = v.union(
  v.literal("queued"),
  v.literal("generating"),
  v.literal("draft"),
  v.literal("held"),
  v.literal("archived"),
  v.literal("publishing"),
  v.literal("published"),
);
export const xAgentTables = {
  xAgentAccounts: defineTable({
    agentSlug: v.string(),
    ownerUserId: v.id("users"),
    expectedUsername: v.string(),
    epoch: v.number(),
    connected: v.boolean(),
    mode: v.union(v.literal("drafts"), v.literal("automatic")),
    xUserId: v.optional(v.string()),
    username: v.optional(v.string()),
    grant: v.optional(xSealed),
    scope: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    connectedAt: v.optional(v.number()),
    updatedAt: v.number(),
    originalOrdinal: v.optional(v.number()),
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
    activity: v.optional(xActivityOptions),
  })
    .index("by_stateHash", ["stateHash"])
    .index("by_expiresAt", ["expiresAt"]),
  xAgentDrafts: defineTable({
    ownerUserId: v.id("users"),
    agentSlug: v.string(),
    accountEpoch: v.number(),
    key: v.string(),
    sourceThreadId: v.optional(v.id("forumThreads")),
    kind: v.optional(xDraftKind),
    officialPost: v.optional(xOfficialPost),
    activityId: v.optional(v.id("xAgentOperations")),
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
  xAgentActivity: defineTable({
    accountId: v.id("xAgentAccounts"),
    enabled: v.boolean(),
    epoch: v.number(),
    options: xActivityOptions,
    enabledAt: v.number(),
    nextPollAt: v.number(),
    cursors: v.array(xCursor),
    lease: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    refreshClaimed: v.optional(v.boolean()),
    holdReason: v.optional(v.string()),
    nextSourcePollAt: v.optional(v.number()),
    nextOriginalAt: v.optional(v.number()),
    automaticOrdinal: v.optional(v.number()),
  })
    .index("by_accountId", ["accountId"])
    .index("by_enabled_and_nextPollAt", ["enabled", "nextPollAt"]),
  xAgentOperations: defineTable({
    accountId: v.id("xAgentAccounts"),
    epoch: v.number(),
    key: v.string(),
    kind: v.union(
      v.literal("repost"),
      v.literal("comment"),
      v.literal("original"),
    ),
    post: v.optional(xOfficialPost),
    ownerRequested: v.optional(v.boolean()),
    approvedText: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("sending"),
      v.literal("confirmed"),
      v.literal("held"),
    ),
    draftId: v.optional(v.id("xAgentDrafts")),
    notBefore: v.number(),
    expiresAt: v.number(),
    resultId: v.optional(v.string()),
    issue: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_accountId_and_status_and_notBefore", [
      "accountId",
      "status",
      "notBefore",
    ]),
};
