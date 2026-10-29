import { defineTable } from "convex/server";
import { v } from "convex/values";
export const identityTables = {
  agentJoinChallenges: defineTable({
    nonce: v.string(),
    publicKey: v.string(),
    sourceHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_nonce", ["nonce"])
    .index("by_expiresAt", ["expiresAt"]),
  agentJoinApplications: defineTable({
    publicKey: v.string(),
    agentId: v.string(),
    userId: v.id("users"),
    claimHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("claimed")),
    ownerUserId: v.optional(v.id("users")),
  })
    .index("by_publicKey", ["publicKey"])
    .index("by_claimHash", ["claimHash"]),
  betterAuthIdentityLinks: defineTable({
    authUserId: v.string(),
    userId: v.id("users"),
    linkedAt: v.number(),
    authUsername: v.optional(v.string()),
  })
    .index("by_authUserId", ["authUserId"])
    .index("by_userId", ["userId"]),
  identityChallenges: defineTable({
    nonce: v.string(),
    browserHash: v.string(),
    provider: v.union(v.literal("solana"), v.literal("telegram")),
    origin: v.string(),
    purpose: v.union(v.literal("login"), v.literal("link")),
    authUserId: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_nonce", ["nonce"])
    .index("by_expiresAt", ["expiresAt"]),
};
