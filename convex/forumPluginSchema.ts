
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const pluginCapabilityValidator = v.union(
  v.literal("read"),
  v.literal("participate"),
  v.literal("personal"),
  v.literal("messages"),
  v.literal("feedback"),
  v.literal("attachments"),
  v.literal("moderate"),
  v.literal("administer"),
  v.literal("accounts"),
);
export const pluginActorModeValidator = v.union(
  v.literal("human"),
  v.literal("agent"),
);
export const pluginExecutionModeValidator = v.union(
  v.literal("direct"),
  v.literal("review"),
);
export const pluginConnectionOptions = {
  actorMode: pluginActorModeValidator,
  agentId: v.optional(v.string()),
  capabilities: v.array(pluginCapabilityValidator),
  executionMode: pluginExecutionModeValidator,
};
export const forumPluginTables = {
  forumPluginConnections: defineTable({
    ownerUserId: v.id("users"),
    credentialAgentIdentityId: v.id("agentIdentities"),
    actorUserId: v.id("users"),
    actorMode: pluginActorModeValidator,
    transport: v.union(v.literal("browser"), v.literal("oauth")),
    kind: v.literal("forum-plugin"),
    // Schema evaluation has no deployment environment. Keep historical resource
    // values; every authorized use checks the exact configured resource in
    // forumPluginPrincipal before granting capabilities.
    resource: v.string(),
    issuer: v.string(),
    subject: v.optional(v.string()),
    externalAuthHash: v.optional(v.string()),
    keyVersion: v.number(),
    capabilities: v.array(pluginCapabilityValidator),
    capabilityCeiling: v.array(pluginCapabilityValidator),
    executionMode: pluginExecutionModeValidator,
    policyVersion: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("revoked"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    activatedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_externalAuthHash", ["externalAuthHash"])
    .index("by_ownerUserId_and_status", ["ownerUserId", "status"])
    .index("by_ownerUserId_and_createdAt", ["ownerUserId", "createdAt"]),
  forumPluginCommands: defineTable({
    connectionId: v.id("forumPluginConnections"),
    ownerUserId: v.id("users"),
    actorUserId: v.id("users"),
    operation: v.string(),
    idempotencyKey: v.string(),
    fingerprint: v.string(),
    argsJson: v.string(),
    policyVersion: v.number(),
    targetVersionsJson: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("rejected"),
      v.literal("expired"),
      v.literal("invalidated"),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_connectionId_and_idempotencyKey", [
      "connectionId",
      "idempotencyKey",
    ])
    .index("by_ownerUserId_and_status_and_createdAt", [
      "ownerUserId",
      "status",
      "createdAt",
    ]),
};
