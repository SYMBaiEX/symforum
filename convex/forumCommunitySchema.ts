import { defineTable } from "convex/server";
import { v } from "convex/values";

export const communityWorkKind = v.union(
  v.literal("bounty"),
  v.literal("research"),
);
export const communityWorkStatus = v.union(
  v.literal("open"),
  v.literal("selected"),
  v.literal("paid"),
  v.literal("cancelled"),
);
export const communityPaymentStatus = v.union(
  v.literal("ready"),
  v.literal("opened"),
  v.literal("checking"),
  v.literal("held"),
  v.literal("verified"),
  v.literal("expired"),
);

export const forumCommunityTables = {
  forumCommunityProjects: defineTable({
    mint: v.string(),
    name: v.string(),
    symbol: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_mint", ["mint"])
    .index("by_updatedAt", ["updatedAt"]),
  // A linked-wallet claim is self-declared affiliation, never proof of project ownership.
  forumCommunityProjectClaims: defineTable({
    projectId: v.id("forumCommunityProjects"),
    userId: v.id("users"),
    wallet: v.string(),
    role: v.string(),
    description: v.string(),
    website: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  })
    .index("by_projectId_and_userId", ["projectId", "userId"])
    .index("by_userId_and_updatedAt", ["userId", "updatedAt"]),
  forumCommunityRecipients: defineTable({
    userId: v.id("users"),
    wallet: v.string(),
    accepting: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_accepting_and_updatedAt", ["accepting", "updatedAt"]),
  forumCommunityWork: defineTable({
    sponsorId: v.id("users"),
    mint: v.union(v.string(), v.null()),
    kind: communityWorkKind,
    title: v.string(),
    brief: v.string(),
    amountLamports: v.string(),
    status: communityWorkStatus,
    selectedSubmissionId: v.optional(v.id("forumCommunitySubmissions")),
    paymentIntentId: v.optional(v.id("forumCommunityPayments")),
    paidIntentId: v.optional(v.id("forumCommunityPayments")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_mint_and_updatedAt", ["mint", "updatedAt"])
    .index("by_sponsorId_and_updatedAt", ["sponsorId", "updatedAt"]),
  forumCommunitySubmissions: defineTable({
    workId: v.id("forumCommunityWork"),
    authorId: v.id("users"),
    url: v.string(),
    summary: v.string(),
    submittedAt: v.number(),
  })
    .index("by_workId_and_authorId", ["workId", "authorId"])
    .index("by_workId_and_submittedAt", ["workId", "submittedAt"]),
  // Immutable exact payment binding. No signed bytes or custody, no send authority.
  forumCommunityPayments: defineTable({
    authUserId: v.string(),
    payerId: v.id("users"),
    wallet: v.string(),
    recipientId: v.id("users"),
    recipient: v.string(),
    amountLamports: v.string(),
    purpose: v.union(v.literal("tip"), v.literal("reward")),
    threadId: v.optional(v.id("forumThreads")),
    workId: v.optional(v.id("forumCommunityWork")),
    submissionId: v.optional(v.id("forumCommunitySubmissions")),
    reference: v.string(),
    memo: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    status: communityPaymentStatus,
    signature: v.optional(v.string()),
    checkedAt: v.optional(v.number()),
    nextCheckAt: v.optional(v.number()),
    checkLease: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    issue: v.optional(v.string()),
    finalizedAt: v.optional(v.number()),
    slot: v.optional(v.number()),
  })
    .index("by_payerId_and_createdAt", ["payerId", "createdAt"])
    .index("by_payerId_and_status_and_createdAt", [
      "payerId",
      "status",
      "createdAt",
    ])
    .index("by_workId", ["workId"])
    .index("by_workId_and_status", ["workId", "status"])
    .index("by_signature", ["signature"])
    .index("by_reference", ["reference"]),
  forumCommunitySupporters: defineTable({
    userId: v.id("users"),
    wallet: v.string(),
    optedIn: v.boolean(),
    eligible: v.boolean(),
    checkedAt: v.number(),
    expiresAt: v.number(),
    leaseUntil: v.number(),
    proofSlot: v.union(v.number(), v.null()),
  }).index("by_userId", ["userId"]),
};
