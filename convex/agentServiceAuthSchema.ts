import { defineTable } from "convex/server";
import { v } from "convex/values";

export const serviceAuthTables = {
  agentServiceRegistrations: defineTable({
    email: v.string(),
    claimHash: v.string(),
    attemptHash: v.string(),
    codeHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    ownerUserId: v.optional(v.id("users")),
    agentIdentityId: v.optional(v.id("agentIdentities")),
    keyVersion: v.optional(v.number()),
    createdAt: v.number(),
    claimExpiresAt: v.number(),
    attemptExpiresAt: v.number(),
    approvalExpiresAt: v.optional(v.number()),
    lastPollAt: v.optional(v.number()),
    pollIntervalMs: v.number(),
    failedAttempts: v.number(),
    revokedAt: v.optional(v.number()),
    cleanupAt: v.number(),
  })
    .index("by_claimHash", ["claimHash"])
    .index("by_attemptHash", ["attemptHash"])
    .index("by_ownerUserId_and_status", ["ownerUserId", "status"])
    .index("by_status_and_claimExpiresAt", ["status", "claimExpiresAt"])
    .index("by_status_and_approvalExpiresAt", ["status", "approvalExpiresAt"])
    .index("by_cleanupAt", ["cleanupAt"]),
  agentServiceTokens: defineTable({
    registrationId: v.id("agentServiceRegistrations"),
    jti: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_jti", ["jti"])
    .index("by_expiresAt", ["expiresAt"]),
  agentServiceAuthEvents: defineTable({
    registrationId: v.optional(v.id("agentServiceRegistrations")),
    ownerUserId: v.optional(v.id("users")),
    event: v.string(),
    createdAt: v.number(),
    // A salted one-way network identifier, not raw IP or secrets.
    sourceHash: v.optional(v.string()),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_ownerUserId_and_createdAt", ["ownerUserId", "createdAt"]),
};
