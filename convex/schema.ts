import { authTables } from "@convex-dev/auth/server";
import { identityTables } from "./identitySchema";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { agentScopeValidator } from "./agentScopeSchema";
import { serviceAuthTables } from "./agentServiceAuthSchema";
import { forumPluginTables } from "./forumPluginSchema";
import { elizaShadowTables } from "./elizaShadowSchema";
import { elizaRuntimeTables } from "./elizaRuntimeSchema";
import { elizaPilotTables } from "./elizaPilotSchema";
import { tokenAlphaTables } from "./tokenAlphaSchema";
import { xAgentTables } from "./xAgentSchema";
import { xTelegramRelayTables } from "./xTelegramRelaySchema";
import { telegramTradeTables } from "./telegramTradeSchema";
import { telegramAgentTables } from "./telegramAgentSchema";

const agentIdentityFields = {
  agentId: v.string(),
  userId: v.id("users"),
  ownerUserId: v.optional(v.id("users")),
  scopes: v.array(agentScopeValidator),
  status: v.union(v.literal("active"), v.literal("revoked")),
  keyVersion: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  revokedAt: v.optional(v.number()),
};

// The schema is normally optional, but Convex Auth
// requires indexes defined on `authTables`.
export default defineSchema({
  ...authTables,
  ...identityTables,
  ...serviceAuthTables,
  ...forumPluginTables,
  ...elizaShadowTables,
  ...elizaRuntimeTables,
  ...elizaPilotTables,
  ...tokenAlphaTables,
  ...xAgentTables,
  ...xTelegramRelayTables,
  ...telegramAgentTables,
  ...telegramTradeTables,
  authIdentityLinks: defineTable({
    tokenIdentifier: v.string(),
    provider: v.literal("workos-authkit"),
    workosUserId: v.string(),
    userId: v.id("users"),
    email: v.string(),
    linkedAt: v.number(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_workosUserId", ["workosUserId"])
    .index("by_userId", ["userId"]),
  authIdentityLinkChallenges: defineTable({
    challengeHash: v.string(),
    userId: v.id("users"),
    expectedEmail: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
  }).index("by_challengeHash", ["challengeHash"]),
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    username: v.optional(v.string()),
    usernameNormalized: v.optional(v.string()),
    usernameSource: v.optional(v.union(v.literal("auto"), v.literal("chosen"))),
    role: v.optional(
      v.union(v.literal("owner"), v.literal("admin"), v.literal("reader")),
    ),
    roleAssignedAt: v.optional(v.number()),
    roleAssignedBy: v.optional(v.id("users")),
    forumRole: v.optional(v.union(v.literal("moderator"), v.literal("admin"))),
    forumRoleAssignedAt: v.optional(v.number()),
    forumRoleAssignedBy: v.optional(v.id("users")),
    contactEmail: v.optional(v.string()),
    bio: v.optional(v.string()),
    onboardedAt: v.optional(v.number()),
    forumTrustedAt: v.optional(v.number()),
    forumTrustedBy: v.optional(v.id("users")),
    forumTrustRevokedAt: v.optional(v.number()),
    forumTrustRevokedBy: v.optional(v.id("users")),
    forumSuspendedUntil: v.optional(v.number()),
    forumSuspendedReason: v.optional(v.string()),
    forumSuspendedBy: v.optional(v.id("users")),
    forumBannedAt: v.optional(v.number()),
    forumBannedReason: v.optional(v.string()),
    forumBannedBy: v.optional(v.id("users")),
    isAgent: v.optional(v.boolean()),
    agentSlug: v.optional(v.string()),
    agentStatus: v.optional(v.union(v.literal("active"), v.literal("revoked"))),
    agentScopes: v.optional(v.array(agentScopeValidator)),
    agentKeyVersion: v.optional(v.number()),
    agentEnrolledAt: v.optional(v.number()),
    agentRevokedAt: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_usernameNormalized", ["usernameNormalized"])
    .index("by_agentSlug", ["agentSlug"])
    .index("by_role", ["role"])
    .index("by_forumRole", ["forumRole"])
    // The public forum overview only needs active trusted members. Keeping
    // revocation first lets that path avoid scanning every site account.
    .index("by_forumTrustRevokedAt_and_forumTrustedAt", [
      "forumTrustRevokedAt",
      "forumTrustedAt",
    ]),
  posts: defineTable({
    slug: v.string(),
    title: v.string(),
    excerpt: v.string(),
    body: v.string(),
    tags: v.array(v.string()),
    status: v.union(v.literal("draft"), v.literal("published")),
    publishedAt: v.number(),
    readingMinutes: v.number(),
    featured: v.boolean(),
    imageUrl: v.optional(v.string()),
    imageAlt: v.optional(v.string()),
    imageCredit: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_publishedAt", ["publishedAt"])
    .index("by_status_and_publishedAt", ["status", "publishedAt"])
    .index("by_featured_and_publishedAt", ["featured", "publishedAt"]),
  postDigests: defineTable({
    postId: v.id("posts"),
    postCreatedAt: v.number(),
    slug: v.string(),
    title: v.string(),
    excerpt: v.string(),
    tags: v.array(v.string()),
    status: v.union(v.literal("draft"), v.literal("published")),
    publishedAt: v.number(),
    readingMinutes: v.number(),
    featured: v.boolean(),
    imageUrl: v.optional(v.string()),
    imageAlt: v.optional(v.string()),
    imageCredit: v.optional(v.string()),
  })
    .index("by_postId", ["postId"])
    .index("by_slug", ["slug"])
    .index("by_status_and_publishedAt", ["status", "publishedAt"]),
  sitePages: defineTable({
    slug: v.string(),
    title: v.string(),
    subtitle: v.string(),
    heroHeading: v.string(),
    heroBody: v.string(),
    body: v.string(),
    status: v.union(v.literal("draft"), v.literal("published")),
    updatedAt: v.number(),
    showImage: v.optional(v.boolean()),
    imageUrl: v.optional(v.string()),
    imageLightUrl: v.optional(v.string()),
    imageAlt: v.optional(v.string()),
    imageCredit: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_status_and_slug", ["status", "slug"]),
  portfolioProjects: defineTable({
    slug: v.string(),
    name: v.string(),
    type: v.string(),
    role: v.string(),
    timeframe: v.string(),
    summary: v.string(),
    problem: v.string(),
    approach: v.string(),
    outcome: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("archived"),
    ),
    order: v.number(),
    tags: v.array(v.string()),
    imageUrl: v.optional(v.string()),
    imageAlt: v.optional(v.string()),
    homepageUrl: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
    writeupUrl: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_order", ["order"])
    .index("by_status_and_order", ["status", "order"]),
  githubPortfolioSnapshots: defineTable({
    key: v.string(),
    metricsJson: v.string(),
    source: v.union(v.literal("cron"), v.literal("manual")),
    refreshedAt: v.number(),
    lastErrorMessage: v.optional(v.string()),
    lastErrorAt: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_refreshedAt", ["refreshedAt"]),
  newsSnapshots: defineTable({
    snapshotDate: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    storyCount: v.number(),
    errorMessage: v.optional(v.string()),
  }).index("by_snapshotDate", ["snapshotDate"]),
  hnStories: defineTable({
    hnItemId: v.number(),
    snapshotDate: v.string(),
    rank: v.number(),
    title: v.string(),
    url: v.optional(v.string()),
    host: v.optional(v.string()),
    by: v.optional(v.string()),
    text: v.optional(v.string()),
    score: v.optional(v.number()),
    descendants: v.optional(v.number()),
    timePosted: v.optional(v.number()),
    fetchedAt: v.number(),
  })
    .index("by_snapshotDate_and_rank", ["snapshotDate", "rank"])
    .index("by_hnItemId", ["hnItemId"])
    .index("by_hnItemId_and_fetchedAt", ["hnItemId", "fetchedAt"]),
  comments: defineTable({
    userId: v.id("users"),
    entityType: v.union(
      v.literal("post"),
      v.literal("hnStory"),
      v.literal("portfolioProject"),
    ),
    entityId: v.string(),
    parentId: v.optional(v.id("comments")),
    body: v.string(),
    status: v.optional(
      v.union(v.literal("active"), v.literal("deleted"), v.literal("hidden")),
    ),
    updatedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
    moderationReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_entityType_and_entityId_and_createdAt", [
      "entityType",
      "entityId",
      "createdAt",
    ])
    .index("by_entityType_and_entityId_and_parentId_and_createdAt", [
      "entityType",
      "entityId",
      "parentId",
      "createdAt",
    ])
    .index("by_userId_and_createdAt", ["userId", "createdAt"]),
  interactions: defineTable({
    userId: v.id("users"),
    entityType: v.union(v.literal("post"), v.literal("hnStory")),
    entityId: v.string(),
    vote: v.number(),
    saved: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_entityType_and_entityId", [
      "userId",
      "entityType",
      "entityId",
    ])
    .index("by_entityType_and_entityId", ["entityType", "entityId"])
    .index("by_updatedAt", ["updatedAt"]),
  optimizationMigrations: defineTable({
    key: v.string(),
    status: v.union(v.literal("running"), v.literal("completed")),
    processed: v.number(),
    // Checkpoints make aggregate backfills resumable across scheduler retries
    // and operator restarts. Optional for pre-existing migration records.
    cursor: v.optional(v.string()),
    phase: v.optional(
      v.union(v.literal("interactions"), v.literal("comments")),
    ),
    scheduledAt: v.optional(v.number()),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_key", ["key"]),
  apiKeys: defineTable({
    name: v.string(),
    tokenHash: v.string(),
    tokenPreview: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_createdAt", ["createdAt"]),
  agentIdentities: defineTable(
    v.union(
      v.object({
        ...agentIdentityFields,
        credentialKind: v.optional(v.literal("ed25519")),
        publicKey: v.string(),
      }),
      v.object({
        ...agentIdentityFields,
        credentialKind: v.literal("oauth"),
        publicKey: v.optional(v.null()),
      }),
    ),
  )
    .index("by_agentId", ["agentId"])
    .index("by_userId", ["userId"])
    .index("by_ownerUserId", ["ownerUserId"])
    .index("by_publicKey", ["publicKey"]),
  agentOAuthGrants: defineTable({
    ownerUserId: v.id("users"),
    agentIdentityId: v.id("agentIdentities"),
    issuer: v.string(),
    subject: v.optional(v.string()),
    externalAuthHash: v.string(),
    keyVersion: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("revoked"),
    ),
    createdAt: v.number(),
    activatedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_externalAuthHash", ["externalAuthHash"])
    .index("by_ownerUserId_and_status", ["ownerUserId", "status"])
    .index("by_ownerUserId_and_createdAt", ["ownerUserId", "createdAt"]),
  workosAgentRegistrations: defineTable({
    registrationId: v.string(),
    ownerUserId: v.id("users"),
    ownerWorkosUserId: v.string(),
    agentIdentityId: v.id("agentIdentities"),
    status: v.union(v.literal("active"), v.literal("revoked")),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_registrationId", ["registrationId"])
    .index("by_agentIdentityId_and_status", ["agentIdentityId", "status"])
    .index("by_ownerUserId_and_status", ["ownerUserId", "status"]),
  organizations: defineTable({
    slug: v.string(),
    name: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
    archivedByUserId: v.optional(v.id("users")),
  })
    .index("by_slug", ["slug"])
    .index("by_createdByUserId_and_createdAt", [
      "createdByUserId",
      "createdAt",
    ]),
  organizationMembers: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("developer"),
      v.literal("auditor"),
    ),
    status: v.union(v.literal("active"), v.literal("removed")),
    joinedAt: v.number(),
    updatedAt: v.number(),
    removedAt: v.optional(v.number()),
    removedByUserId: v.optional(v.id("users")),
  })
    .index("by_organizationId_and_userId", ["organizationId", "userId"])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_organizationId_and_status_and_role", [
      "organizationId",
      "status",
      "role",
    ]),
  organizationInvites: defineTable({
    organizationId: v.id("organizations"),
    inviteeUserId: v.id("users"),
    role: v.union(
      v.literal("admin"),
      v.literal("developer"),
      v.literal("auditor"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
    ),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedByUserId: v.optional(v.id("users")),
    revokedAt: v.optional(v.number()),
    revokedByUserId: v.optional(v.id("users")),
  })
    .index("by_organizationId_and_inviteeUserId_and_status", [
      "organizationId",
      "inviteeUserId",
      "status",
    ])
    .index("by_inviteeUserId_and_status_and_expiresAt", [
      "inviteeUserId",
      "status",
      "expiresAt",
    ])
    .index("by_organizationId_and_status_and_createdAt", [
      "organizationId",
      "status",
      "createdAt",
    ]),
  organizationProjects: defineTable({
    organizationId: v.id("organizations"),
    projectKey: v.string(),
    name: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    allowedAgentScopes: v.array(agentScopeValidator),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
    archivedByUserId: v.optional(v.id("users")),
  })
    .index("by_organizationId_and_projectKey", ["organizationId", "projectKey"])
    .index("by_organizationId_and_status_and_updatedAt", [
      "organizationId",
      "status",
      "updatedAt",
    ]),
  organizationServiceAccounts: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("organizationProjects"),
    agentIdentityId: v.id("agentIdentities"),
    agentUserId: v.id("users"),
    ownerUserId: v.id("users"),
    name: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked")),
    allowedScopes: v.array(agentScopeValidator),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokedByUserId: v.optional(v.id("users")),
  })
    .index("by_agentUserId", ["agentUserId"])
    .index("by_organizationId_and_projectId_and_status", [
      "organizationId",
      "projectId",
      "status",
    ])
    .index("by_organizationId_and_ownerUserId_and_status", [
      "organizationId",
      "ownerUserId",
      "status",
    ])
    .index("by_organizationId_and_status_and_updatedAt", [
      "organizationId",
      "status",
      "updatedAt",
    ]),
  organizationBudgets: defineTable({
    organizationId: v.id("organizations"),
    monthKey: v.string(),
    currency: v.literal("USD"),
    limitMicros: v.number(),
    spentMicros: v.number(),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organizationId_and_monthKey", ["organizationId", "monthKey"]),
  organizationUsageLedger: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("organizationProjects"),
    serviceAccountId: v.id("organizationServiceAccounts"),
    idempotencyKey: v.string(),
    scope: agentScopeValidator,
    amountMicros: v.number(),
    // Optional during the staged migration. Legacy rows are debits.
    entryType: v.optional(v.union(v.literal("debit"), v.literal("reversal"))),
    commandId: v.optional(v.id("apiCommands")),
    requestFingerprint: v.optional(v.string()),
    reversesUsageId: v.optional(v.id("organizationUsageLedger")),
    spentAfterMicros: v.number(),
    currency: v.literal("USD"),
    monthKey: v.string(),
    chargedAt: v.number(),
  })
    .index("by_serviceAccountId_and_idempotencyKey", [
      "serviceAccountId",
      "idempotencyKey",
    ])
    .index("by_organizationId_and_monthKey_and_chargedAt", [
      "organizationId",
      "monthKey",
      "chargedAt",
    ])
    .index("by_projectId_and_monthKey_and_chargedAt", [
      "projectId",
      "monthKey",
      "chargedAt",
    ]),
  organizationAuditRecords: defineTable({
    organizationId: v.id("organizations"),
    eventType: v.union(
      v.literal("organization_created"),
      v.literal("member_invited"),
      v.literal("invite_accepted"),
      v.literal("invite_revoked"),
      v.literal("member_role_changed"),
      v.literal("owner_transferred"),
      v.literal("member_removed"),
      v.literal("project_created"),
      v.literal("project_scopes_changed"),
      v.literal("service_account_created"),
      v.literal("service_account_revoked"),
      v.literal("budget_changed"),
    ),
    actorUserId: v.id("users"),
    actorKind: v.union(v.literal("human"), v.literal("service_account")),
    actorServiceAccountId: v.optional(v.id("organizationServiceAccounts")),
    targetUserId: v.optional(v.id("users")),
    projectId: v.optional(v.id("organizationProjects")),
    serviceAccountId: v.optional(v.id("organizationServiceAccounts")),
    previousRole: v.optional(
      v.union(
        v.literal("owner"),
        v.literal("admin"),
        v.literal("developer"),
        v.literal("auditor"),
      ),
    ),
    nextRole: v.optional(
      v.union(
        v.literal("owner"),
        v.literal("admin"),
        v.literal("developer"),
        v.literal("auditor"),
      ),
    ),
    previousAmountMicros: v.optional(v.number()),
    nextAmountMicros: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_organizationId_and_createdAt", ["organizationId", "createdAt"])
    .index("by_actorUserId_and_createdAt", ["actorUserId", "createdAt"])
    .index("by_targetUserId_and_createdAt", ["targetUserId", "createdAt"]),
  agentLoginChallenges: defineTable({
    agentId: v.string(),
    challengeHash: v.string(),
    audience: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_challengeHash", ["challengeHash"])
    .index("by_agentId_and_createdAt", ["agentId", "createdAt"]),
  agentQuotaBudgets: defineTable({
    ownerUserId: v.id("users"),
    monthKey: v.string(),
    freeAllowanceUnits: v.number(),
    hardCapUnits: v.number(),
    usedUnits: v.number(),
    hardCapReachedAt: v.optional(v.number()),
    hardCapMetadataJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_ownerUserId_and_monthKey", ["ownerUserId", "monthKey"]),
  // Durable operator-only receipts for the one-time forum read quota correction.
  forumReadQuotaRefunds: defineTable({
    connectionId: v.id("forumPluginConnections"),
    ownerUserId: v.id("users"),
    agentId: v.string(),
    monthKey: v.string(),
    fingerprint: v.string(),
    sourceCount: v.number(),
    refundedUnits: v.number(),
    ownerUsedBefore: v.number(),
    ownerUsedAfter: v.number(),
    agentUsedBefore: v.number(),
    agentUsedAfter: v.number(),
    appliedAt: v.number(),
  }).index("by_connectionId_and_monthKey_and_ownerUserId_and_agentId", [
    "connectionId",
    "monthKey",
    "ownerUserId",
    "agentId",
  ]),
  agentQuotaLimits: defineTable({
    ownerUserId: v.id("users"),
    agentId: v.string(),
    monthlyLimitUnits: v.number(),
    requestLimitUnits: v.number(),
    updatedAt: v.number(),
  }).index("by_ownerUserId_and_agentId", ["ownerUserId", "agentId"]),
  agentQuotaUsageCounters: defineTable({
    ownerUserId: v.id("users"),
    agentId: v.string(),
    monthKey: v.string(),
    usedUnits: v.number(),
    updatedAt: v.number(),
  }).index("by_ownerUserId_and_agentId_and_monthKey", [
    "ownerUserId",
    "agentId",
    "monthKey",
  ]),
  agentQuotaUsage: defineTable({
    ownerUserId: v.id("users"),
    agentId: v.string(),
    monthKey: v.string(),
    idempotencyKey: v.string(),
    operation: v.string(),
    units: v.number(),
    createdAt: v.number(),
    metadataJson: v.optional(v.string()),
    requestFingerprint: v.optional(v.string()),
  })
    .index("by_ownerUserId_and_agentId_and_monthKey_and_idempotencyKey", [
      "ownerUserId",
      "agentId",
      "monthKey",
      "idempotencyKey",
    ])
    .index("by_ownerUserId_and_agentId_and_monthKey_and_createdAt", [
      "ownerUserId",
      "agentId",
      "monthKey",
      "createdAt",
    ]),
  contactRequests: defineTable({
    name: v.string(),
    email: v.string(),
    emailNormalized: v.string(),
    subject: v.string(),
    description: v.string(),
    status: v.union(v.literal("new"), v.literal("read"), v.literal("archived")),
    source: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    emailedAt: v.optional(v.number()),
    emailError: v.optional(v.string()),
    // The Resend component owns provider delivery; retain its durable email id
    // here so lifecycle callbacks can be associated without email matching.
    resendEmailId: v.optional(v.string()),
    emailDeliveryStatus: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("sent"),
        v.literal("delivered"),
        v.literal("bounced"),
        v.literal("complained"),
        v.literal("failed"),
        v.literal("delivery_delayed"),
      ),
    ),
    emailEventAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_resendEmailId", ["resendEmailId"])
    .index("by_emailNormalized_and_createdAt", [
      "emailNormalized",
      "createdAt",
    ]),
  // Minimal callback ledger for contact delivery. It intentionally stores no
  // message body, recipient address, or provider event metadata.
  contactEmailEvents: defineTable({
    eventId: v.string(),
    resendEmailId: v.string(),
    eventType: v.string(),
    receivedAt: v.number(),
  }).index("by_eventId", ["eventId"]),
  accountEmailVerificationChallenges: defineTable({
    userId: v.id("users"),
    email: v.string(),
    status: v.union(v.literal("queued"), v.literal("sent")),
    codeHash: v.optional(v.string()),
    expiresAt: v.number(),
    attempts: v.number(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_expiresAt", ["expiresAt"]),
  newsletterSubscribers: defineTable({
    email: v.string(),
    emailNormalized: v.string(),
    userId: v.optional(v.id("users")),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("unsubscribed"),
      v.literal("bounced"),
    ),
    source: v.string(),
    dailyOptIn: v.optional(v.boolean()),
    weeklyOptIn: v.optional(v.boolean()),
    tokenHash: v.string(),
    // Version 2 capabilities are generated only by the backend, never callers.
    tokenVersion: v.optional(v.literal(2)),
    tokenExpiresAt: v.optional(v.number()),
    tokenPurpose: v.optional(
      v.union(v.literal("confirm"), v.literal("manage")),
    ),
    resendContactId: v.optional(v.string()),
    resendSyncStatus: v.union(
      v.literal("idle"),
      v.literal("synced"),
      v.literal("failed"),
      v.literal("not_configured"),
    ),
    resendSyncedAt: v.optional(v.number()),
    resendError: v.optional(v.string()),
    createdAt: v.number(),
    confirmedAt: v.optional(v.number()),
    unsubscribedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_emailNormalized", ["emailNormalized"])
    .index("by_tokenHash", ["tokenHash"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"]),
  newsletterManagementLinks: defineTable({
    subscriberId: v.id("newsletterSubscribers"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  }).index("by_tokenHash", ["tokenHash"]),
  newsletterIssues: defineTable({
    slug: v.string(),
    subject: v.string(),
    previewText: v.string(),
    body: v.string(),
    edition: v.optional(
      v.union(v.literal("daily-signal"), v.literal("weekly-field-note")),
    ),
    editorialVersion: v.optional(v.number()),
    qualityScore: v.optional(v.number()),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("sent"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    linkedPostSlug: v.optional(v.string()),
    forumCategorySlug: v.optional(v.string()),
    forumThreadSlug: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    resendBroadcastId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_resendBroadcastId", ["resendBroadcastId"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_scheduledAt", ["scheduledAt"]),
  newsletterIssueDigests: defineTable({
    issueId: v.id("newsletterIssues"),
    issueCreatedAt: v.number(),
    slug: v.string(),
    subject: v.string(),
    previewText: v.string(),
    headline: v.string(),
    dek: v.string(),
    edition: v.optional(
      v.union(v.literal("daily-signal"), v.literal("weekly-field-note")),
    ),
    qualityScore: v.optional(v.number()),
    sourceCount: v.number(),
    routingJson: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("sent"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    forumCategorySlug: v.optional(v.string()),
    forumThreadSlug: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_issueId", ["issueId"])
    .index("by_slug", ["slug"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),
  newsletterEvents: defineTable({
    provider: v.literal("resend"),
    eventId: v.string(),
    eventType: v.string(),
    email: v.optional(v.string()),
    subscriberId: v.optional(v.id("newsletterSubscribers")),
    issueId: v.optional(v.id("newsletterIssues")),
    resendEmailId: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
    receivedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_receivedAt", ["receivedAt"])
    .index("by_issueId_and_receivedAt", ["issueId", "receivedAt"])
    .index("by_issueId_and_eventType_and_receivedAt", [
      "issueId",
      "eventType",
      "receivedAt",
    ])
    .index("by_subscriberId_and_receivedAt", ["subscriberId", "receivedAt"]),
  newsletterEngagements: defineTable({
    issueId: v.id("newsletterIssues"),
    eventType: v.union(
      v.literal("archive_view"),
      v.literal("archive_click"),
      v.literal("source_click"),
      v.literal("discussion_click"),
      v.literal("forum_click"),
      v.literal("news_index_click"),
    ),
    hnItemId: v.optional(v.number()),
    visitorKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_issueId_and_createdAt", ["issueId", "createdAt"])
    .index("by_issueId_and_eventType_and_createdAt", [
      "issueId",
      "eventType",
      "createdAt",
    ])
    .index("by_issueId_and_hnItemId_and_createdAt", [
      "issueId",
      "hnItemId",
      "createdAt",
    ])
    .index("by_issue_event_visitor_story_created", [
      "issueId",
      "eventType",
      "visitorKey",
      "hnItemId",
      "createdAt",
    ]),
  newsletterSettings: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  dailyNewsletterRuns: defineTable({
    runDate: v.string(),
    snapshotDate: v.optional(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("generated"),
      v.literal("sent"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    mode: v.union(v.literal("cron"), v.literal("manual"), v.literal("test")),
    sendEnabled: v.boolean(),
    startedAt: v.number(),
    attemptCount: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    issueId: v.optional(v.id("newsletterIssues")),
    storyCount: v.number(),
    topStoryIds: v.array(v.number()),
    qualityScore: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    resendBroadcastId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_runDate", ["runDate"])
    .index("by_issueId", ["issueId"])
    .index("by_startedAt", ["startedAt"])
    .index("by_status_and_startedAt", ["status", "startedAt"]),
  dailyQuotes: defineTable({
    quoteKey: v.string(),
    quote: v.string(),
    author: v.string(),
    source: v.string(),
    sourceUrl: v.optional(v.string()),
    reflection: v.string(),
    usedDate: v.string(),
    usedAt: v.number(),
  })
    .index("by_usedDate", ["usedDate"])
    .index("by_quoteKey_and_usedAt", ["quoteKey", "usedAt"]),
  newsletterSendLogs: defineTable({
    runDate: v.string(),
    issueId: v.optional(v.id("newsletterIssues")),
    provider: v.literal("resend"),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    resendBroadcastId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_runDate_and_createdAt", ["runDate", "createdAt"])
    .index("by_issueId_and_createdAt", ["issueId", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_status_and_errorMessage_and_createdAt", [
      "status",
      "errorMessage",
      "createdAt",
    ]),
  forumCategories: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    kind: v.optional(v.union(v.literal("section"), v.literal("board"))),
    parentCategoryId: v.optional(v.id("forumCategories")),
    status: v.union(v.literal("active"), v.literal("archived")),
    viewAccess: v.optional(
      v.union(
        v.literal("public"),
        v.literal("members"),
        v.literal("trusted"),
        v.literal("staff"),
      ),
    ),
    threadAccess: v.optional(
      v.union(
        v.literal("members"),
        v.literal("trusted"),
        v.literal("staff"),
        v.literal("closed"),
      ),
    ),
    replyAccess: v.optional(
      v.union(
        v.literal("members"),
        v.literal("trusted"),
        v.literal("staff"),
        v.literal("closed"),
      ),
    ),
    pollAccess: v.optional(
      v.union(
        v.literal("members"),
        v.literal("trusted"),
        v.literal("staff"),
        v.literal("closed"),
      ),
    ),
    position: v.number(),
    threadCount: v.number(),
    postCount: v.number(),
    lastThreadId: v.optional(v.id("forumThreads")),
    lastPostId: v.optional(v.id("forumPosts")),
    lastPostAt: v.optional(v.number()),
    moderationActivityAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_position", ["position"])
    .index("by_parentCategoryId_and_position", ["parentCategoryId", "position"])
    .index("by_status_and_position", ["status", "position"]),
  forumCategoryModerators: defineTable({
    categoryId: v.id("forumCategories"),
    userId: v.id("users"),
    assignedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_categoryId", ["categoryId"])
    .index("by_userId", ["userId"])
    .index("by_categoryId_and_userId", ["categoryId", "userId"])
    .index("by_userId_and_categoryId", ["userId", "categoryId"]),
  forumThreadPrefixes: defineTable({
    categoryId: v.optional(v.id("forumCategories")),
    key: v.string(),
    slug: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived")),
    position: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_position", ["position"])
    .index("by_categoryId_and_position", ["categoryId", "position"])
    .index("by_status_and_position", ["status", "position"])
    .index("by_categoryId_and_status_and_position", [
      "categoryId",
      "status",
      "position",
    ]),
  forumAnnouncements: defineTable({
    categoryId: v.optional(v.id("forumCategories")),
    key: v.string(),
    slug: v.string(),
    title: v.string(),
    body: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    position: v.number(),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_slug", ["slug"])
    .index("by_position", ["position"])
    .index("by_categoryId_and_position", ["categoryId", "position"])
    .index("by_status_and_position", ["status", "position"])
    .index("by_categoryId_and_status_and_position", [
      "categoryId",
      "status",
      "position",
    ]),
  forumHelpDocuments: defineTable({
    slug: v.string(),
    title: v.string(),
    body: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    position: v.number(),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_position_and_title", ["position", "title"])
    .index("by_status_and_position_and_title", ["status", "position", "title"]),
  forumCalendarEvents: defineTable({
    slug: v.string(),
    title: v.string(),
    body: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    startsAt: v.number(),
    endsAt: v.optional(v.number()),
    allDay: v.boolean(),
    month: v.string(),
    day: v.string(),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_month_and_startsAt_and_title", ["month", "startsAt", "title"])
    .index("by_status_and_month_and_startsAt_and_title", [
      "status",
      "month",
      "startsAt",
      "title",
    ])
    .index("by_startsAt_and_title", ["startsAt", "title"])
    .index("by_status_and_startsAt_and_title", ["status", "startsAt", "title"]),
  forumBoardRules: defineTable({
    categoryId: v.id("forumCategories"),
    title: v.string(),
    body: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_categoryId", ["categoryId"])
    .index("by_categoryId_and_updatedAt", ["categoryId", "updatedAt"])
    .index("by_categoryId_and_status_and_updatedAt", [
      "categoryId",
      "status",
      "updatedAt",
    ])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"]),
  forumThreads: defineTable({
    categoryId: v.id("forumCategories"),
    categorySlug: v.string(),
    kind: v.optional(
      v.union(
        v.literal("discussion"),
        v.literal("question"),
        v.literal("link"),
        v.literal("showcase"),
      ),
    ),
    sourceUrl: v.optional(v.string()),
    acceptedPostId: v.optional(v.id("forumPosts")),
    newsItemId: v.optional(v.number()),
    prefixId: v.optional(v.id("forumThreadPrefixes")),
    prefixSlug: v.optional(v.string()),
    prefixLabel: v.optional(v.string()),
    prefixColor: v.optional(v.string()),
    slug: v.string(),
    title: v.string(),
    body: v.string(),
    authorId: v.id("users"),
    agentAssisted: v.optional(v.boolean()),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("locked"),
      v.literal("hidden"),
      v.literal("deleted"),
    ),
    pinned: v.boolean(),
    replyCount: v.number(),
    ratingCount: v.optional(v.number()),
    ratingTotal: v.optional(v.number()),
    lastAssignedPostNumber: v.optional(v.number()),
    viewCount: v.number(),
    lastPostId: v.optional(v.id("forumPosts")),
    lastPostAt: v.number(),
    lastPostUserId: v.id("users"),
    moderationActivityAt: v.optional(v.number()),
    moderationRootActivityAt: v.optional(v.number()),
    searchText: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lockedAt: v.optional(v.number()),
    lockedBy: v.optional(v.id("users")),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
    moderationReason: v.optional(v.string()),
    lastEditedAt: v.optional(v.number()),
    lastEditedBy: v.optional(v.id("users")),
    lastEditReason: v.optional(v.string()),
    editCount: v.optional(v.number()),
    visibilityProfileDeltaToken: v.optional(v.string()),
    categoryReferenceSyncToken: v.optional(v.string()),
  })
    .index("by_categorySlug_and_slug", ["categorySlug", "slug"])
    .index("by_categoryId_and_lastPostAt", ["categoryId", "lastPostAt"])
    .index("by_categoryId_and_status_and_lastPostAt", [
      "categoryId",
      "status",
      "lastPostAt",
    ])
    .index("by_categoryId_and_status_and_pinned_and_lastPostAt", [
      "categoryId",
      "status",
      "pinned",
      "lastPostAt",
    ])
    .index("by_categoryId_and_prefixId_and_status_and_pinned_and_lastPostAt", [
      "categoryId",
      "prefixId",
      "status",
      "pinned",
      "lastPostAt",
    ])
    .index("by_status_and_lastPostAt", ["status", "lastPostAt"])
    .index("by_lastPostAt", ["lastPostAt"])
    .index("by_prefixId_and_updatedAt", ["prefixId", "updatedAt"])
    .index("by_authorId_and_createdAt", ["authorId", "createdAt"])
    .index("by_authorId_and_status_and_createdAt", [
      "authorId",
      "status",
      "createdAt",
    ])
    .searchIndex("search_by_searchText", {
      searchField: "searchText",
      filterFields: ["status", "categorySlug", "categoryId", "authorId"],
    }),
  forumThreadEditorialDigests: defineTable({
    threadId: v.id("forumThreads"),
    threadCreatedAt: v.optional(v.number()),
    categoryId: v.id("forumCategories"),
    categorySlug: v.string(),
    prefixId: v.optional(v.id("forumThreadPrefixes")),
    prefixSlug: v.optional(v.string()),
    prefixLabel: v.optional(v.string()),
    prefixColor: v.optional(v.string()),
    slug: v.string(),
    title: v.string(),
    feedExcerpt: v.optional(v.string()),
    kind: v.optional(
      v.union(
        v.literal("discussion"),
        v.literal("question"),
        v.literal("link"),
        v.literal("showcase"),
      ),
    ),
    sourceUrl: v.optional(v.string()),
    acceptedPostId: v.optional(v.id("forumPosts")),
    authorId: v.id("users"),
    agentAssisted: v.optional(v.boolean()),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("locked"),
      v.literal("hidden"),
      v.literal("deleted"),
    ),
    pinned: v.optional(v.boolean()),
    replyCount: v.number(),
    ratingCount: v.optional(v.number()),
    ratingTotal: v.optional(v.number()),
    lastAssignedPostNumber: v.optional(v.number()),
    viewCount: v.number(),
    lastPostId: v.optional(v.id("forumPosts")),
    lastPostAt: v.number(),
    lastPostUserId: v.optional(v.id("users")),
    moderationActivityAt: v.optional(v.number()),
    moderationRootActivityAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_threadCreatedAt", ["threadCreatedAt"])
    .index("by_lastPostAt", ["lastPostAt", "threadCreatedAt"])
    .index("by_status_and_lastPostAt", ["status", "lastPostAt"])
    .index("by_categoryId_and_status_and_lastPostAt", [
      "categoryId",
      "status",
      "lastPostAt",
    ])
    .index("by_categoryId_and_status_and_pinned_and_lastPostAt", [
      "categoryId",
      "status",
      "pinned",
      "lastPostAt",
    ])
    .index("by_categoryId_and_prefixId_and_status_and_pinned_and_lastPostAt", [
      "categoryId",
      "prefixId",
      "status",
      "pinned",
      "lastPostAt",
    ]),
  forumThreadEngagementCounters: defineTable({
    threadId: v.id("forumThreads"),
    viewCount: v.number(),
    updatedAt: v.number(),
  }).index("by_threadId", ["threadId"]),
  // General-board live chat. Status indexes keep public and moderator reads bounded.
  forumChatMessages: defineTable({
    replyToId: v.optional(v.id("forumChatMessages")),
    categoryId: v.id("forumCategories"),
    authorId: v.id("users"),
    agentAssisted: v.optional(v.boolean()),
    ownerUserId: v.id("users"),
    connectionId: v.optional(v.id("forumPluginConnections")),
    body: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("pending"),
      v.literal("hidden"),
      v.literal("deleted"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    moderatedBy: v.optional(v.id("users")),
    moderatedOwnerUserId: v.optional(v.id("users")),
  })
    .index("by_categoryId_and_status_and_createdAt", [
      "categoryId",
      "status",
      "createdAt",
    ])
    .index("by_categoryId_and_authorId_and_status_and_createdAt", [
      "categoryId",
      "authorId",
      "status",
      "createdAt",
    ]),
  forumPosts: defineTable({
    parentPostId: v.optional(v.id("forumPosts")),
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    authorId: v.id("users"),
    agentAssisted: v.optional(v.boolean()),
    body: v.string(),
    postNumber: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("hidden"),
      v.literal("deleted"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
    moderationReason: v.optional(v.string()),
    moderationMovedAt: v.optional(v.number()),
    lastEditedAt: v.optional(v.number()),
    lastEditedBy: v.optional(v.id("users")),
    lastEditReason: v.optional(v.string()),
    editCount: v.optional(v.number()),
  })
    .index("by_threadId_and_status_and_createdAt", [
      "threadId",
      "status",
      "createdAt",
    ])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_threadId_and_postNumber", ["threadId", "postNumber"])
    .index("by_threadId_and_status_and_postNumber", [
      "threadId",
      "status",
      "postNumber",
    ])
    .index("by_threadId_and_status_and_moderationMovedAt", [
      "threadId",
      "status",
      "moderationMovedAt",
    ])
    .index("by_categoryId_and_createdAt", ["categoryId", "createdAt"])
    .index("by_categoryId_and_status_and_createdAt", [
      "categoryId",
      "status",
      "createdAt",
    ])
    .index("by_authorId_and_createdAt", ["authorId", "createdAt"])
    .index("by_authorId_and_status_and_createdAt", [
      "authorId",
      "status",
      "createdAt",
    ])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .searchIndex("search_by_body", {
      searchField: "body",
      filterFields: ["status", "threadId", "categoryId", "authorId"],
    }),
  // Search reads these small, purpose-built records instead of forumThreads and
  // forumPosts.  Keeping the indexed text bounded prevents a single very long
  // discussion from making every search result expensive to read.
  forumThreadSearchProjections: defineTable({
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    categorySlug: v.string(),
    prefixId: v.optional(v.id("forumThreadPrefixes")),
    prefixSlug: v.optional(v.string()),
    prefixLabel: v.optional(v.string()),
    prefixColor: v.optional(v.string()),
    slug: v.string(),
    title: v.string(),
    authorId: v.id("users"),
    lastPostUserId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("locked"),
      v.literal("hidden"),
      v.literal("deleted"),
    ),
    pinned: v.boolean(),
    replyCount: v.number(),
    viewCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastPostAt: v.number(),
    searchText: v.string(),
    excerpt: v.string(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_categorySlug_and_slug", ["categorySlug", "slug"])
    .index("by_authorId_and_status_and_createdAt", [
      "authorId",
      "status",
      "createdAt",
    ])
    .searchIndex("search_by_searchText", {
      searchField: "searchText",
      filterFields: ["status", "categorySlug", "categoryId", "authorId"],
    }),
  forumPostSearchProjections: defineTable({
    postId: v.id("forumPosts"),
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    authorId: v.id("users"),
    postNumber: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("hidden"),
      v.literal("deleted"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    searchText: v.string(),
    excerpt: v.string(),
  })
    .index("by_postId", ["postId"])
    .index("by_threadId", ["threadId"])
    .index("by_authorId_and_status_and_createdAt", [
      "authorId",
      "status",
      "createdAt",
    ])
    .searchIndex("search_by_searchText", {
      searchField: "searchText",
      filterFields: ["status", "threadId", "categoryId", "authorId"],
    }),
  forumAttachments: defineTable({
    threadId: v.id("forumThreads"),
    postId: v.optional(v.id("forumPosts")),
    categoryId: v.id("forumCategories"),
    authorId: v.id("users"),
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
    altText: v.optional(v.string()),
    credit: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("deleted")),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    .index("by_threadId_and_status_and_createdAt", [
      "threadId",
      "status",
      "createdAt",
    ])
    .index("by_postId_and_status_and_createdAt", [
      "postId",
      "status",
      "createdAt",
    ])
    .index("by_status_and_deletedAt", ["status", "deletedAt"])
    .index("by_threadId_and_postId_and_status_and_createdAt", [
      "threadId",
      "postId",
      "status",
      "createdAt",
    ])
    .index("by_authorId_and_createdAt", ["authorId", "createdAt"])
    .index("by_storageId", ["storageId"]),
  forumAgents: defineTable({
    slug: v.string(),
    name: v.string(),
    userId: v.id("users"),
    persona: v.string(),
    model: v.string(),
    dailyPostTarget: v.number(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_userId", ["userId"]),
  forumAgentRuns: defineTable({
    runKey: v.string(),
    agentSlug: v.string(),
    runDate: v.string(),
    slot: v.number(),
    attempt: v.number(),
    status: v.union(
      v.literal("running"),
      v.literal("published"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    model: v.string(),
    candidateCount: v.optional(v.number()),
    categoryId: v.optional(v.id("forumCategories")),
    categorySlug: v.optional(v.string()),
    threadId: v.optional(v.id("forumThreads")),
    title: v.optional(v.string()),
    sourceUrls: v.array(v.string()),
    imageSourceUrl: v.optional(v.string()),
    contentFormat: v.optional(v.string()),
    topicFingerprint: v.optional(v.string()),
    qualityScore: v.optional(v.number()),
    groundingScore: v.optional(v.number()),
    noveltyScore: v.optional(v.number()),
    utilityScore: v.optional(v.number()),
    presentationScore: v.optional(v.number()),
    imageScore: v.optional(v.number()),
    sourceCount: v.optional(v.number()),
    followUpPostId: v.optional(v.id("forumPosts")),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    agentThreadId: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_runKey", ["runKey"])
    .index("by_agentSlug_and_runDate_and_slot", [
      "agentSlug",
      "runDate",
      "slot",
    ])
    .index("by_agentSlug_and_status_and_startedAt", [
      "agentSlug",
      "status",
      "startedAt",
    ])
    .index("by_threadId_and_startedAt", ["threadId", "startedAt"])
    .index("by_runDate", ["runDate"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_startedAt", ["startedAt"]),
  // Bounded, private provenance for the already-evaluated claim ledger that
  // accompanied an automated forum publication. One row per claim keeps the
  // ledger queryable without growing the thread or run document.
  forumAgentClaimCitations: defineTable({
    citationKey: v.string(),
    runKey: v.string(),
    threadId: v.id("forumThreads"),
    postId: v.optional(v.id("forumPosts")),
    claimIndex: v.number(),
    claimText: v.string(),
    claimHash: v.string(),
    bodySpanStart: v.optional(v.number()),
    bodySpanEnd: v.optional(v.number()),
    bodySpanText: v.optional(v.string()),
    bodySpanMatch: v.union(
      v.literal("exact"),
      v.literal("lexical_fallback"),
      v.literal("unmatched"),
    ),
    sourceCandidateId: v.string(),
    sourceCandidateKey: v.string(),
    sourceUrl: v.string(),
    snapshotHash: v.string(),
    snapshotVersion: v.string(),
    kind: v.union(v.literal("fact"), v.literal("analysis")),
    confidence: v.union(v.literal("high"), v.literal("medium")),
    supportStatus: v.union(
      v.literal("supported"),
      v.literal("partial"),
      v.literal("unsupported"),
    ),
    supportScore: v.number(),
    agentSlug: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    assessmentId: v.optional(v.id("researchQualityAssessments")),
    reviewId: v.optional(v.id("researchQualityReviews")),
    correctionOfCitationId: v.optional(v.id("forumAgentClaimCitations")),
    supersededByCitationId: v.optional(v.id("forumAgentClaimCitations")),
    createdAt: v.number(),
  })
    .index("by_citationKey", ["citationKey"])
    .index("by_runKey_and_claimIndex", ["runKey", "claimIndex"])
    .index("by_runKey_and_claimHash", ["runKey", "claimHash"])
    .index("by_threadId_and_claimIndex", ["threadId", "claimIndex"])
    .index("by_threadId_and_claimHash", ["threadId", "claimHash"])
    .index("by_postId_and_claimIndex", ["postId", "claimIndex"])
    .index("by_sourceCandidateKey", ["sourceCandidateKey"]),
  // Private research state. These tables are intentionally exposed only
  // through internal functions; public forum records retain only the final
  // publication and its bounded citation provenance.
  forumAgentResearchPackets: defineTable({
    runKey: v.string(),
    agentSlug: v.string(),
    state: v.union(
      v.literal("researching"),
      v.literal("drafting"),
      v.literal("publishable"),
      v.literal("held"),
      v.literal("published"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    currentStage: v.union(
      v.literal("source_discovery"),
      v.literal("entity_resolution"),
      v.literal("claim_extraction"),
      v.literal("contradiction_detection"),
      v.literal("reconstruction"),
      v.literal("quality_evaluation"),
      v.literal("publication_decision"),
    ),
    sourceCount: v.number(),
    latestRevision: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    claimHash: v.optional(v.string()),
    decisionReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_runKey", ["runKey"])
    .index("by_agentSlug_and_updatedAt", ["agentSlug", "updatedAt"])
    .index("by_state_and_updatedAt", ["state", "updatedAt"]),
  forumAgentResearchSources: defineTable({
    packetId: v.id("forumAgentResearchPackets"),
    runKey: v.string(),
    sourceKey: v.string(),
    sourceUrl: v.string(),
    snapshotHash: v.string(),
    titleHash: v.string(),
    state: v.union(v.literal("selected"), v.literal("verified")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_packetId_and_sourceKey", ["packetId", "sourceKey"])
    .index("by_runKey_and_sourceKey", ["runKey", "sourceKey"]),
  forumAgentResearchStages: defineTable({
    packetId: v.id("forumAgentResearchPackets"),
    runKey: v.string(),
    stage: v.union(
      v.literal("source_discovery"),
      v.literal("entity_resolution"),
      v.literal("claim_extraction"),
      v.literal("contradiction_detection"),
      v.literal("reconstruction"),
      v.literal("quality_evaluation"),
      v.literal("publication_decision"),
    ),
    state: v.union(
      v.literal("started"),
      v.literal("completed"),
      v.literal("held"),
      v.literal("failed"),
    ),
    payloadHash: v.string(),
    itemCount: v.optional(v.number()),
    score: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_packetId_and_stage", ["packetId", "stage"])
    .index("by_runKey_and_stage", ["runKey", "stage"]),
  forumAgentDraftRevisions: defineTable({
    packetId: v.id("forumAgentResearchPackets"),
    runKey: v.string(),
    agentSlug: v.string(),
    revision: v.number(),
    state: v.union(
      v.literal("drafting"),
      v.literal("publishable"),
      v.literal("held"),
      v.literal("published"),
    ),
    title: v.string(),
    body: v.string(),
    contentHash: v.string(),
    claimHash: v.string(),
    claimCount: v.number(),
    qualityScore: v.optional(v.number()),
    decisionReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_packetId_and_revision", ["packetId", "revision"])
    .index("by_runKey_and_revision", ["runKey", "revision"])
    .index("by_runKey_and_state", ["runKey", "state"]),
  // One bounded deduplication receipt and fenced indexing lease per thread.
  forumAgentMemoryIndexes: defineTable({
    threadId: v.id("forumThreads"),
    completedHash: v.optional(v.string()),
    leaseToken: v.optional(v.string()),
    leaseHash: v.optional(v.string()),
    leaseModel: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    leaseAttempt: v.optional(v.number()),
    leaseRecoveryId: v.optional(v.id("_scheduled_functions")),
    followupScheduled: v.boolean(),
  }).index("by_threadId", ["threadId"]),
  // One private Agent component thread backs the full reply conversation for
  // an agent in a forum thread. Component ids never enter public forum rows.
  forumAgentConversations: defineTable({
    forumThreadId: v.id("forumThreads"),
    agentSlug: v.string(),
    conversationId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_forumThreadId_and_agentSlug", ["forumThreadId", "agentSlug"])
    .index("by_conversationId", ["conversationId"]),
  forumAgentReplyRuns: defineTable({
    runKey: v.string(),
    agentSlug: v.string(),
    runDate: v.string(),
    sourceKind: v.union(v.literal("thread"), v.literal("reply")),
    sourcePostId: v.optional(v.id("forumPosts")),
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    authorId: v.id("users"),
    // Optional for rolling compatibility with rows queued before this field
    // was introduced. New rows persist their source author kind at admission.
    sourceAuthorIsAgent: v.optional(v.boolean()),
    attempt: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("replied"),
      v.literal("ignored"),
      v.literal("failed"),
    ),
    model: v.string(),
    // Versioned so a bounded release helper can reconsider an ignored source
    // exactly once after the reply contract materially improves.
    promptVersion: v.optional(v.string()),
    // Optional only for legacy queued rows. Claiming lazily admits and maps
    // those rows before any model generation can run.
    admittedAt: v.optional(v.number()),
    conversationId: v.optional(v.string()),
    reason: v.optional(v.string()),
    replyPostId: v.optional(v.id("forumPosts")),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_runKey", ["runKey"])
    .index("by_sourcePostId", ["sourcePostId"])
    .index("by_runDate", ["runDate"])
    .index("by_agentSlug_and_runDate_and_status", [
      "agentSlug",
      "runDate",
      "status",
    ])
    .index("by_agentSlug_and_status_and_updatedAt", [
      "agentSlug",
      "status",
      "updatedAt",
    ])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"]),
  // Private operational evidence for reply sweeps and admission decisions.
  // No public query exposes this table; rows are retained only long enough to
  // distinguish healthy idle sweeps from quality, policy, or route failures.
  forumAgentReplySweepEvents: defineTable({
    agentSlug: v.string(),
    runDate: v.string(),
    outcome: v.union(
      v.literal("no-candidate"),
      v.literal("rejected-agent"),
      v.literal("rejected-self"),
      v.literal("rejected-nonpublic"),
      v.literal("rejected-nonsubstantive"),
      v.literal("daily-limit"),
      v.literal("canary-blocked"),
      v.literal("route-failed"),
      v.literal("ignored"),
      v.literal("replied"),
    ),
    runId: v.optional(v.id("forumAgentReplyRuns")),
    sourceKind: v.optional(v.union(v.literal("thread"), v.literal("reply"))),
    threadId: v.optional(v.id("forumThreads")),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_runDate_and_agentSlug", ["runDate", "agentSlug"]),
  forumAgentUsageEvents: defineTable({
    runKey: v.string(),
    reservationKey: v.optional(v.string()),
    agentSlug: v.string(),
    stage: v.union(
      v.literal("topic"),
      v.literal("draft"),
      v.literal("revision"),
      v.literal("reply"),
      v.literal("embedding"),
      v.literal("research"),
      v.literal("canary"),
      v.literal("owner-console"),
    ),
    model: v.string(),
    requestedModel: v.optional(v.string()),
    servedModel: v.optional(v.string()),
    categorySlug: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    estimatedCostMicroUsd: v.optional(v.number()),
    providerReportedCostMicroUsd: v.optional(v.number()),
    qualityBefore: v.optional(v.number()),
    qualityAfter: v.optional(v.number()),
    durationMs: v.number(),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),
  aiRouteEvents: defineTable({
    correlationId: v.string(),
    feature: v.string(),
    runKey: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    stage: v.string(),
    attempt: v.number(),
    // Legacy provider values remain accepted so existing telemetry can be
    // read after the runtime migrated to OpenRouter-only routing.
    provider: v.union(
      v.literal("openrouter"),
      v.literal("muse"),
      v.literal("gateway"),
    ),
    model: v.string(),
    outcome: v.union(v.literal("completed"), v.literal("failed")),
    fallback: v.boolean(),
    durationMs: v.number(),
    // Estimate held in the shared daily budget for this provider attempt.
    // Failed attempts remain conservative reservations until the day rolls.
    estimatedCostMicroUsd: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),
  aiProviderCircuits: defineTable({
    model: v.string(),
    consecutiveFailures: v.number(),
    reason: v.optional(v.string()),
    disabledUntil: v.number(),
    lastFailureAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_model", ["model"])
    .index("by_disabledUntil", ["disabledUntil"]),
  aiProviderLeases: defineTable({
    key: v.string(),
    holder: v.string(),
    expiresAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  aiSpendBuckets: defineTable({
    dayKey: v.string(),
    provider: v.string(),
    bucket: v.number(),
    spentMicroUsd: v.number(),
    requests: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dayKey_and_provider_and_bucket", [
      "dayKey",
      "provider",
      "bucket",
    ])
    .index("by_updatedAt", ["updatedAt"]),
  aiModelCallReservations: defineTable({
    reservationKey: v.string(),
    model: v.string(),
    dayKey: v.string(),
    bucket: v.number(),
    estimatedMicroUsd: v.number(),
    estimatedInputTokens: v.number(),
    estimatedOutputTokens: v.number(),
    status: v.union(
      v.literal("reserved"),
      v.literal("failed"),
      v.literal("settled"),
    ),
    settledMicroUsd: v.optional(v.number()),
    settledInputTokens: v.optional(v.number()),
    settledOutputTokens: v.optional(v.number()),
    // Links a conservative usage-unknown receipt so later token telemetry can
    // update the same event instead of double-counting a provider call.
    usageEventId: v.optional(v.id("forumAgentUsageEvents")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_reservationKey", ["reservationKey"])
    .index("by_createdAt", ["createdAt"]),
  aiOperationalStates: defineTable({
    key: v.string(),
    healthy: v.boolean(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    detail: v.optional(v.string()),
    checkedAt: v.number(),
    pauseUntil: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  // Durable, per-request reservations make semantic embedding costs
  // replay-safe. They are operational accounting records, not public data.
  semanticSearchOperations: defineTable({
    operationKey: v.string(),
    kind: v.union(v.literal("index"), v.literal("query")),
    fingerprint: v.string(),
    model: v.string(),
    status: v.union(
      v.literal("leased"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("refunded"),
    ),
    holder: v.string(),
    leaseExpiresAt: v.optional(v.number()),
    reservationDayKey: v.string(),
    reservationBucket: v.number(),
    reservedMicroUsd: v.number(),
    settledMicroUsd: v.optional(v.number()),
    reservedInputTokens: v.number(),
    settledInputTokens: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    refundedAt: v.optional(v.number()),
  })
    .index("by_operationKey", ["operationKey"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_leaseExpiresAt", ["leaseExpiresAt"])
    .index("by_status_and_leaseExpiresAt", ["status", "leaseExpiresAt"])
    .index("by_kind_and_status_and_updatedAt", ["kind", "status", "updatedAt"]),
  forumAgentEditorialCohorts: defineTable({
    cohortKey: v.string(),
    agentSlug: v.string(),
    categorySlug: v.string(),
    contentFormat: v.string(),
    promptVersion: v.string(),
    sampleCount: v.number(),
    totalViews: v.number(),
    totalReplies: v.number(),
    totalPollVotes: v.number(),
    totalQuality: v.number(),
    feedbackSampleCount: v.optional(v.number()),
    helpfulCount: v.optional(v.number()),
    sourceIssueCount: v.optional(v.number()),
    duplicateConfirmedCount: v.optional(v.number()),
    disclosureIssueCount: v.optional(v.number()),
    minimumSampleSize: v.optional(v.number()),
    score: v.number(),
    updatedAt: v.number(),
  })
    .index("by_cohortKey", ["cohortKey"])
    .index("by_agentSlug_and_score", ["agentSlug", "score"]),
  // Outcome-only counters. Moderator notes and identities never enter this
  // aggregate or the agent selection prompt.
  forumAgentModerationOutcomeAggregates: defineTable({
    cohortKey: v.string(),
    agentSlug: v.string(),
    categorySlug: v.string(),
    contentFormat: v.string(),
    promptVersion: v.string(),
    sampleCount: v.number(),
    helpfulCount: v.number(),
    sourceIssueCount: v.number(),
    duplicateConfirmedCount: v.number(),
    disclosureIssueCount: v.number(),
    minimumSampleSize: v.number(),
    score: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_cohortKey", ["cohortKey"])
    .index("by_agentSlug_and_updatedAt", ["agentSlug", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"]),
  forumAgentMaintenanceState: defineTable({
    key: v.string(),
    cursor: v.optional(v.string()),
    completedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  forumAgentResearchCache: defineTable({
    cacheKey: v.string(),
    sourceName: v.string(),
    feedUrl: v.string(),
    payloadJson: v.string(),
    fetchedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_cacheKey", ["cacheKey"])
    .index("by_expiresAt", ["expiresAt"]),
  forumAgentSourceUses: defineTable({
    sourceKey: v.string(),
    sourceUrl: v.string(),
    agentSlug: v.string(),
    categoryId: v.id("forumCategories"),
    threadId: v.id("forumThreads"),
    usedAt: v.number(),
  })
    .index("by_sourceKey", ["sourceKey"])
    .index("by_agentSlug_and_usedAt", ["agentSlug", "usedAt"])
    .index("by_threadId", ["threadId"])
    .index("by_usedAt", ["usedAt"]),
  forumAgentSourceReservations: defineTable({
    sourceKey: v.string(),
    runKey: v.string(),
    agentSlug: v.string(),
    status: v.union(
      v.literal("reserved"),
      v.literal("published"),
      v.literal("released"),
    ),
    threadId: v.optional(v.id("forumThreads")),
    reservedAt: v.number(),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sourceKey", ["sourceKey"])
    .index("by_runKey", ["runKey"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),
  forumAgentTopicReservations: defineTable({
    topicFingerprint: v.string(),
    runKey: v.string(),
    agentSlug: v.string(),
    status: v.union(
      v.literal("reserved"),
      v.literal("published"),
      v.literal("released"),
    ),
    threadId: v.optional(v.id("forumThreads")),
    reservedAt: v.number(),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_topicFingerprint", ["topicFingerprint"])
    .index("by_runKey", ["runKey"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),
  forumAgentMediaCache: defineTable({
    sourceKey: v.string(),
    sourceUrl: v.string(),
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
    altText: v.optional(v.string()),
    credit: v.optional(v.string()),
    fetchedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_sourceKey", ["sourceKey"])
    .index("by_expiresAt", ["expiresAt"]),
  forumPendingUploads: defineTable({
    userId: v.id("users"),
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
    status: v.union(v.literal("pending"), v.literal("consumed")),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.optional(v.number()),
    consumedAt: v.optional(v.number()),
  })
    .index("by_storageId", ["storageId"])
    .index("by_userId_and_storageId", ["userId", "storageId"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"])
    .index("by_userId_and_status_and_createdAt", [
      "userId",
      "status",
      "createdAt",
    ]),
  forumContentEdits: defineTable({
    entityType: v.union(v.literal("thread"), v.literal("post")),
    threadId: v.id("forumThreads"),
    postId: v.optional(v.id("forumPosts")),
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    previousTitle: v.optional(v.string()),
    nextTitle: v.optional(v.string()),
    previousPrefixId: v.optional(v.id("forumThreadPrefixes")),
    nextPrefixId: v.optional(v.id("forumThreadPrefixes")),
    previousPrefixLabel: v.optional(v.string()),
    nextPrefixLabel: v.optional(v.string()),
    previousBody: v.string(),
    nextBody: v.string(),
    editReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_postId_and_createdAt", ["postId", "createdAt"])
    .index("by_actorUserId_and_createdAt", ["actorUserId", "createdAt"])
    .index("by_targetUserId_and_createdAt", ["targetUserId", "createdAt"])
    .index("by_entityType_and_createdAt", ["entityType", "createdAt"]),
  forumPolls: defineTable({
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    question: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    optionCount: v.number(),
    totalVotes: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    closedAt: v.optional(v.number()),
    closedBy: v.optional(v.id("users")),
  })
    .index("by_threadId", ["threadId"])
    .index("by_status_and_createdAt", ["status", "createdAt"]),
  forumPollOptions: defineTable({
    pollId: v.id("forumPolls"),
    threadId: v.id("forumThreads"),
    label: v.string(),
    position: v.number(),
    voteCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_pollId_and_position", ["pollId", "position"])
    .index("by_threadId", ["threadId"]),
  forumPollVotes: defineTable({
    pollId: v.id("forumPolls"),
    optionId: v.id("forumPollOptions"),
    threadId: v.id("forumThreads"),
    userId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_pollId_and_userId", ["pollId", "userId"])
    .index("by_optionId_and_userId", ["optionId", "userId"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"]),
  forumThreadViews: defineTable({
    userId: v.id("users"),
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    lastViewedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_threadId", ["userId", "threadId"])
    .index("by_threadId_and_updatedAt", ["threadId", "updatedAt"]),
  forumThreadRatings: defineTable({
    userId: v.id("users"),
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    score: v.union(
      v.literal(1),
      v.literal(2),
      v.literal(3),
      v.literal(4),
      v.literal(5),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_threadId", ["userId", "threadId"])
    .index("by_userId_and_updatedAt", ["userId", "updatedAt"])
    .index("by_threadId_and_updatedAt", ["threadId", "updatedAt"]),
  forumNewsDiscussions: defineTable({
    hnItemId: v.number(),
    threadId: v.id("forumThreads"),
    createdAt: v.number(),
  }).index("by_hnItemId", ["hnItemId"]),
  forumChatReadMarkers: defineTable({
    userId: v.id("users"),
    lastReadAt: v.number(),
  }).index("by_userId", ["userId"]),
  forumExperienceDailyCounters: defineTable({
    dayKey: v.string(),
    actorKind: v.union(
      v.literal("human"),
      v.literal("agent"),
      v.literal("assisted"),
    ),
    event: v.string(),
    count: v.number(),
  })
    .index("by_dayKey", ["dayKey"])
    .index("by_dayKey_and_actorKind_and_event", [
      "dayKey",
      "actorKind",
      "event",
    ]),
  forumExperienceSettings: defineTable({
    userId: v.id("users"),
    defaultFeed: v.union(v.literal("discover"), v.literal("following")),
    authorFilter: v.union(
      v.literal("all"),
      v.literal("humans"),
      v.literal("agents"),
    ),
    mutedWords: v.array(v.string()),
    mutedUntil: v.optional(v.number()),
    onboardingCompleted: v.boolean(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),
  forumUserProfiles: defineTable({
    userId: v.id("users"),
    avatarUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
    birthday: v.optional(v.string()),
    signature: v.optional(v.string()),
    customTitle: v.optional(v.string()),
    location: v.optional(v.string()),
    showSignatures: v.boolean(),
    timeZone: v.optional(v.string()),
    threadCount: v.number(),
    postCount: v.number(),
    reputationScore: v.optional(v.number()),
    websiteUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_threadCount_and_updatedAt", ["threadCount", "updatedAt"])
    .index("by_reputationScore_and_updatedAt", ["reputationScore", "updatedAt"])
    .index("by_postCount_and_updatedAt", ["postCount", "updatedAt"]),
  forumPresence: defineTable({
    userId: v.id("users"),
    locationType: v.union(
      v.literal("index"),
      v.literal("board"),
      v.literal("thread"),
      v.literal("search"),
      v.literal("members"),
      v.literal("online"),
      v.literal("newPosts"),
      v.literal("help"),
      v.literal("calendar"),
      v.literal("userCp"),
      v.literal("messages"),
      v.literal("subscriptions"),
      v.literal("saved"),
    ),
    path: v.string(),
    label: v.string(),
    lastSeenAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_lastSeenAt", ["lastSeenAt"])
    .index("by_locationType_and_lastSeenAt", ["locationType", "lastSeenAt"]),
  forumReputations: defineTable({
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    targetType: v.union(v.literal("thread"), v.literal("post")),
    targetKey: v.string(),
    threadId: v.id("forumThreads"),
    postId: v.optional(v.id("forumPosts")),
    categoryId: v.id("forumCategories"),
    score: v.union(v.literal(-1), v.literal(0), v.literal(1)),
    comment: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_fromUserId_and_targetKey", ["fromUserId", "targetKey"])
    .index("by_fromUserId_and_createdAt", ["fromUserId", "createdAt"])
    .index("by_fromUserId_and_updatedAt", ["fromUserId", "updatedAt"])
    .index("by_toUserId_and_createdAt", ["toUserId", "createdAt"])
    .index("by_targetKey_and_createdAt", ["targetKey", "createdAt"])
    .index("by_postId_and_createdAt", ["postId", "createdAt"])
    .index("by_threadId_and_updatedAt", ["threadId", "updatedAt"]),
  forumThreadReads: defineTable({
    userId: v.id("users"),
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    lastReadAt: v.number(),
    lastReadPostNumber: v.optional(v.number()),
    lastPostAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_threadId", ["userId", "threadId"])
    .index("by_userId_and_categoryId_and_updatedAt", [
      "userId",
      "categoryId",
      "updatedAt",
    ])
    .index("by_threadId_and_updatedAt", ["threadId", "updatedAt"]),
  forumCategoryReads: defineTable({
    userId: v.id("users"),
    categoryId: v.id("forumCategories"),
    lastReadAt: v.number(),
    lastPostAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_categoryId", ["userId", "categoryId"])
    .index("by_userId_and_updatedAt", ["userId", "updatedAt"]),
  forumThreadSubscriptions: defineTable({
    userId: v.id("users"),
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    status: v.union(v.literal("active"), v.literal("muted")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_threadId", ["userId", "threadId"])
    .index("by_userId_and_updatedAt", ["userId", "updatedAt"])
    .index("by_userId_and_status_and_updatedAt", [
      "userId",
      "status",
      "updatedAt",
    ])
    .index("by_threadId_and_status", ["threadId", "status"]),
  forumThreadBookmarks: defineTable({
    userId: v.id("users"),
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_threadId", ["userId", "threadId"])
    .index("by_userId_and_updatedAt", ["userId", "updatedAt"]),
  forumCategorySubscriptions: defineTable({
    userId: v.id("users"),
    categoryId: v.id("forumCategories"),
    status: v.union(v.literal("active"), v.literal("muted")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_categoryId", ["userId", "categoryId"])
    .index("by_userId_and_updatedAt", ["userId", "updatedAt"])
    .index("by_userId_and_status_and_updatedAt", [
      "userId",
      "status",
      "updatedAt",
    ])
    .index("by_categoryId_and_status", ["categoryId", "status"]),
  forumNotificationPreferences: defineTable({
    userId: v.id("users"),
    inAppReplies: v.boolean(),
    inAppNewThreads: v.boolean(),
    inAppMentions: v.optional(v.boolean()),
    emailReplies: v.boolean(),
    emailNewThreads: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),
  forumNotifications: defineTable({
    recipientUserId: v.id("users"),
    actorUserId: v.id("users"),
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    postId: v.optional(v.id("forumPosts")),
    type: v.union(
      v.literal("reply"),
      v.literal("newThread"),
      v.literal("mention"),
    ),
    status: v.union(v.literal("unread"), v.literal("read")),
    createdAt: v.number(),
    updatedAt: v.number(),
    readAt: v.optional(v.number()),
  })
    .index("by_recipientUserId_and_status_and_createdAt", [
      "recipientUserId",
      "status",
      "createdAt",
    ])
    .index("by_recipientUserId_and_createdAt", ["recipientUserId", "createdAt"])
    .index("by_postId_and_recipientUserId", ["postId", "recipientUserId"])
    .index("by_postId_and_createdAt", ["postId", "createdAt"])
    .index("by_threadId_and_recipientUserId_and_type", [
      "threadId",
      "recipientUserId",
      "type",
    ])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"]),
  forumNotificationEmailDeliveries: defineTable({
    notificationId: v.optional(v.id("forumNotifications")),
    recipientUserId: v.id("users"),
    actorUserId: v.id("users"),
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    postId: v.optional(v.id("forumPosts")),
    type: v.union(v.literal("reply"), v.literal("newThread")),
    status: v.union(
      v.literal("queued"),
      v.literal("skipped"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    toEmail: v.string(),
    reason: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_notificationId", ["notificationId"])
    .index("by_recipientUserId_and_status_and_createdAt", [
      "recipientUserId",
      "status",
      "createdAt",
    ])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_postId_and_recipientUserId_and_type", [
      "postId",
      "recipientUserId",
      "type",
    ])
    .index("by_threadId_and_recipientUserId_and_type", [
      "threadId",
      "recipientUserId",
      "type",
    ]),
  forumPrivateConversationRequests: defineTable({
    actorId: v.id("users"),
    requestId: v.string(),
    fingerprint: v.string(),
    conversationId: v.id("forumPrivateConversations"),
    createdAt: v.number(),
  }).index("by_actorId_and_requestId", ["actorId", "requestId"]),
  forumPrivateConversations: defineTable({
    kind: v.union(v.literal("direct"), v.literal("group")),
    title: v.optional(v.string()),
    creatorId: v.id("users"),
    managerId: v.id("users"),
    directKey: v.optional(v.string()),
    requestId: v.string(),
    requestFingerprint: v.string(),
    lastSequence: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_directKey", ["directKey"])
    .index("by_creatorId_and_requestId", ["creatorId", "requestId"]),
  forumPrivateConversationMembers: defineTable({
    conversationId: v.id("forumPrivateConversations"),
    userId: v.id("users"),
    active: v.boolean(),
    joinedSequence: v.number(),
    lastReadSequence: v.number(),
    archived: v.boolean(),
    muted: v.boolean(),
    lastActivityAt: v.number(),
  })
    .index("by_conversationId_and_userId", ["conversationId", "userId"])
    .index("by_userId_and_active_and_archived_and_lastActivityAt", [
      "userId",
      "active",
      "archived",
      "lastActivityAt",
    ]),
  forumPrivateConversationMessages: defineTable({
    conversationId: v.id("forumPrivateConversations"),
    authorId: v.id("users"),
    sequence: v.number(),
    body: v.string(),
    attachments: v.array(
      v.object({
        storageId: v.id("_storage"),
        filename: v.string(),
        contentType: v.string(),
        size: v.number(),
      }),
    ),
    requestId: v.string(),
    requestFingerprint: v.string(),
    agentAssisted: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_conversationId_and_sequence", ["conversationId", "sequence"])
    .index("by_authorId_and_conversationId_and_requestId", [
      "authorId",
      "conversationId",
      "requestId",
    ]),
  forumPrivateMessages: defineTable({
    senderUserId: v.id("users"),
    recipientUserId: v.id("users"),
    subject: v.string(),
    body: v.string(),
    readAt: v.optional(v.number()),
    senderDeletedAt: v.optional(v.number()),
    recipientDeletedAt: v.optional(v.number()),
    senderPurgedAt: v.optional(v.number()),
    recipientPurgedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_recipientUserId_and_createdAt", ["recipientUserId", "createdAt"])
    .index("by_senderUserId_and_createdAt", ["senderUserId", "createdAt"])
    .index("by_senderUserId_and_recipientUserId_and_createdAt", [
      "senderUserId",
      "recipientUserId",
      "createdAt",
    ])
    .index("by_recipientUserId_and_readAt", ["recipientUserId", "readAt"])
    .index("by_recipientUserId_and_recipientDeletedAt_and_createdAt", [
      "recipientUserId",
      "recipientDeletedAt",
      "createdAt",
    ])
    .index("by_recipient_and_purged_and_deleted_and_created", [
      "recipientUserId",
      "recipientPurgedAt",
      "recipientDeletedAt",
      "createdAt",
    ])
    .index("by_senderUserId_and_senderDeletedAt_and_createdAt", [
      "senderUserId",
      "senderDeletedAt",
      "createdAt",
    ])
    .index("by_sender_and_purged_and_deleted_and_created", [
      "senderUserId",
      "senderPurgedAt",
      "senderDeletedAt",
      "createdAt",
    ])
    .index("by_recipientUserId_and_recipientDeletedAt_and_readAt", [
      "recipientUserId",
      "recipientDeletedAt",
      "readAt",
    ]),
  forumUserRelationships: defineTable({
    userId: v.id("users"),
    targetUserId: v.id("users"),
    kind: v.union(v.literal("buddy"), v.literal("ignore")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_kind_and_createdAt", ["userId", "kind", "createdAt"])
    .index("by_userId_and_targetUserId_and_kind", [
      "userId",
      "targetUserId",
      "kind",
    ])
    .index("by_targetUserId_and_kind_and_createdAt", [
      "targetUserId",
      "kind",
      "createdAt",
    ]),
  forumReports: defineTable({
    reporterId: v.id("users"),
    entityType: v.union(
      v.literal("thread"),
      v.literal("post"),
      v.literal("privateMessage"),
    ),
    threadId: v.optional(v.id("forumThreads")),
    postId: v.optional(v.id("forumPosts")),
    messageId: v.optional(v.id("forumPrivateMessages")),
    conversationMessageId: v.optional(v.id("forumPrivateConversationMessages")),
    categoryId: v.optional(v.id("forumCategories")),
    snapshotTitle: v.optional(v.string()),
    snapshotPrefixSlug: v.optional(v.string()),
    snapshotPrefixLabel: v.optional(v.string()),
    snapshotPrefixColor: v.optional(v.string()),
    snapshotBody: v.optional(v.string()),
    snapshotAuthorId: v.optional(v.id("users")),
    snapshotAuthorName: v.optional(v.string()),
    snapshotPostNumber: v.optional(v.number()),
    snapshotCreatedAt: v.optional(v.number()),
    reason: v.string(),
    details: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("reviewed"),
      v.literal("dismissed"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("users")),
    moderationNote: v.optional(v.string()),
  })
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_categoryId_and_createdAt", ["categoryId", "createdAt"])
    .index("by_categoryId_and_status_and_createdAt", [
      "categoryId",
      "status",
      "createdAt",
    ])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_postId_and_createdAt", ["postId", "createdAt"])
    .index("by_reporterId_and_createdAt", ["reporterId", "createdAt"])
    .index("by_reporterId_and_status_and_createdAt", [
      "reporterId",
      "status",
      "createdAt",
    ])
    .index("by_reporterId_and_entityType_and_threadId_and_status", [
      "reporterId",
      "entityType",
      "threadId",
      "status",
    ])
    .index("by_reporterId_and_entityType_and_messageId_and_status", [
      "reporterId",
      "entityType",
      "messageId",
      "status",
    ]),
  forumWarnings: defineTable({
    targetUserId: v.id("users"),
    actorUserId: v.id("users"),
    status: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    points: v.number(),
    reason: v.string(),
    moderationNote: v.optional(v.string()),
    categoryId: v.optional(v.id("forumCategories")),
    threadId: v.optional(v.id("forumThreads")),
    postId: v.optional(v.id("forumPosts")),
    reportId: v.optional(v.id("forumReports")),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_categoryId_and_createdAt", ["categoryId", "createdAt"])
    .index("by_categoryId_and_status_and_createdAt", [
      "categoryId",
      "status",
      "createdAt",
    ])
    .index("by_targetUserId_and_createdAt", ["targetUserId", "createdAt"])
    .index("by_targetUserId_and_status_and_createdAt", [
      "targetUserId",
      "status",
      "createdAt",
    ])
    .index("by_reportId_and_createdAt", ["reportId", "createdAt"])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_postId_and_createdAt", ["postId", "createdAt"]),
  forumModerationEvents: defineTable({
    actorUserId: v.id("users"),
    entityType: v.union(
      v.literal("forumThread"),
      v.literal("forumPost"),
      v.literal("forumReport"),
      v.literal("forumPoll"),
      v.literal("forumWarning"),
      v.literal("forumCategory"),
      v.literal("forumCategoryOrder"),
      v.literal("forumThreadPrefix"),
      v.literal("forumAnnouncement"),
      v.literal("forumHelpDocument"),
      v.literal("forumCalendarEvent"),
      v.literal("forumBoardRules"),
      v.literal("forumCategoryModerator"),
    ),
    entityId: v.string(),
    eventType: v.union(
      v.literal("forum_report_created"),
      v.literal("forum_report_updated"),
      v.literal("forum_poll_status_updated"),
      v.literal("forum_category_created"),
      v.literal("forum_category_updated"),
      v.literal("forum_categories_reordered"),
      v.literal("forum_default_categories_created"),
      v.literal("forum_thread_prefix_created"),
      v.literal("forum_thread_prefix_updated"),
      v.literal("forum_announcement_created"),
      v.literal("forum_announcement_updated"),
      v.literal("forum_help_document_created"),
      v.literal("forum_help_document_updated"),
      v.literal("forum_calendar_event_created"),
      v.literal("forum_calendar_event_updated"),
      v.literal("forum_board_rules_created"),
      v.literal("forum_board_rules_updated"),
      v.literal("forum_category_moderator_assigned"),
      v.literal("forum_category_moderator_removed"),
      v.literal("forum_thread_submitted"),
      v.literal("forum_answer_selected"),
      v.literal("forum_post_submitted"),
      v.literal("forum_thread_moderated"),
      v.literal("forum_thread_moved"),
      v.literal("forum_post_moderated"),
      v.literal("forum_posts_moved"),
      v.literal("forum_thread_deleted"),
      v.literal("forum_post_deleted"),
      v.literal("forum_warning_issued"),
      v.literal("forum_warning_updated"),
    ),
    message: v.string(),
    categoryId: v.optional(v.id("forumCategories")),
    threadId: v.optional(v.id("forumThreads")),
    postId: v.optional(v.id("forumPosts")),
    reportId: v.optional(v.id("forumReports")),
    warningId: v.optional(v.id("forumWarnings")),
    pollId: v.optional(v.id("forumPolls")),
    metadataJson: v.string(),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_entityType_and_entityId_and_createdAt", [
      "entityType",
      "entityId",
      "createdAt",
    ])
    .index("by_categoryId_and_createdAt", ["categoryId", "createdAt"])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_postId_and_createdAt", ["postId", "createdAt"])
    .index("by_actorUserId_and_createdAt", ["actorUserId", "createdAt"])
    .index("by_eventType_and_createdAt", ["eventType", "createdAt"]),
  // A small, reviewable quality record for research/forum drafts. Content
  // remains in forumThreads; this table holds only bounded deterministic
  // signals and the human decision that permits publication.
  researchQualityAssessments: defineTable({
    // A rejected automated candidate has no public thread. It stays in the
    // private review queue with only a bounded excerpt and its run key.
    threadId: v.optional(v.id("forumThreads")),
    categoryId: v.id("forumCategories"),
    authorUserId: v.id("users"),
    runKey: v.optional(v.string()),
    candidateTitle: v.string(),
    candidateExcerpt: v.string(),
    status: v.union(
      v.literal("passed"),
      v.literal("needs_review"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("overridden"),
    ),
    sourceCount: v.number(),
    uniqueSourceDomainCount: v.number(),
    claimEstimate: v.number(),
    citationCoverageScore: v.number(),
    originalityScore: v.number(),
    qualitySchemaVersion: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    model: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    contentFormat: v.optional(v.string()),
    wordCount: v.optional(v.number()),
    sentenceCount: v.optional(v.number()),
    paragraphCount: v.optional(v.number()),
    lexicalDiversityScore: v.optional(v.number()),
    structureScore: v.optional(v.number()),
    naturalnessScore: v.optional(v.number()),
    sourceDiversityScore: v.optional(v.number()),
    contentQualityScore: v.optional(v.number()),
    sourceDomains: v.optional(v.array(v.string())),
    aiAuthorshipDisclosed: v.boolean(),
    contentFingerprint: v.string(),
    normalizedTerms: v.array(v.string()),
    duplicateOfThreadId: v.optional(v.id("forumThreads")),
    flags: v.array(v.string()),
    evaluatedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_runKey", ["runKey"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_categoryId_and_status_and_updatedAt", [
      "categoryId",
      "status",
      "updatedAt",
    ]),
  // Export visibility needs only these fields; keep the private, larger
  // review record off the repeated public-export validation path.
  researchQualityAssessmentVisibilityDigests: defineTable({
    assessmentId: v.id("researchQualityAssessments"),
    threadId: v.id("forumThreads"),
    authorUserId: v.id("users"),
    status: v.union(
      v.literal("passed"),
      v.literal("needs_review"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("overridden"),
    ),
  })
    .index("by_assessmentId", ["assessmentId"])
    .index("by_threadId", ["threadId"]),
  researchQualityReviews: defineTable({
    assessmentId: v.id("researchQualityAssessments"),
    threadId: v.optional(v.id("forumThreads")),
    reviewerUserId: v.id("users"),
    decision: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("overridden"),
    ),
    reason: v.string(),
    createdAt: v.number(),
  })
    .index("by_assessmentId_and_createdAt", ["assessmentId", "createdAt"])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_reviewerUserId_and_createdAt", ["reviewerUserId", "createdAt"]),
  // Moderators can feed corrections back into quality review without changing
  // the original forum moderation event or allowing agents to self-approve.
  researchQualityModerationFeedback: defineTable({
    threadId: v.id("forumThreads"),
    assessmentId: v.optional(v.id("researchQualityAssessments")),
    moderatorUserId: v.id("users"),
    runKey: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    contentFormat: v.optional(v.string()),
    cohortKey: v.optional(v.string()),
    citationIds: v.optional(v.array(v.id("forumAgentClaimCitations"))),
    eligibleForAggregate: v.optional(v.boolean()),
    outcome: v.union(
      v.literal("source_issue"),
      v.literal("duplicate_confirmed"),
      v.literal("disclosure_issue"),
      v.literal("helpful"),
    ),
    note: v.string(),
    createdAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_assessmentId_and_createdAt", ["assessmentId", "createdAt"])
    .index("by_moderatorUserId_and_createdAt", ["moderatorUserId", "createdAt"])
    .index("by_cohortKey_and_createdAt", ["cohortKey", "createdAt"]),
  systemLogs: defineTable({
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSeenAt: v.number(),
    occurrences: v.number(),
    level: v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
    status: v.union(
      v.literal("open"),
      v.literal("reviewed"),
      v.literal("resolved"),
    ),
    source: v.union(
      v.literal("client"),
      v.literal("server"),
      v.literal("api"),
      v.literal("convex"),
    ),
    scope: v.string(),
    eventType: v.string(),
    message: v.string(),
    name: v.optional(v.string()),
    stack: v.optional(v.string()),
    fingerprint: v.string(),
    path: v.optional(v.string()),
    url: v.optional(v.string()),
    method: v.optional(v.string()),
    statusCode: v.optional(v.number()),
    requestId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    component: v.optional(v.string()),
    action: v.optional(v.string()),
    actorUserId: v.optional(v.id("users")),
    apiKeyId: v.optional(v.id("apiKeys")),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_level_and_createdAt", ["level", "createdAt"])
    .index("by_source_and_createdAt", ["source", "createdAt"])
    .index("by_actorUserId_and_createdAt", ["actorUserId", "createdAt"])
    .index("by_apiKeyId_and_createdAt", ["apiKeyId", "createdAt"])
    .index("by_fingerprint_and_createdAt", ["fingerprint", "createdAt"]),
  // One current, aggregate-only heartbeat per critical cron. Run history is
  // separately capped per job so this operational data cannot grow without
  // bound or retain job payloads/errors.
  cronJobHeartbeats: defineTable({
    jobKey: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("healthy"),
      v.literal("failed"),
    ),
    currentRunId: v.optional(v.id("cronJobRunSummaries")),
    lastStartedAt: v.number(),
    lastSucceededAt: v.optional(v.number()),
    lastFailedAt: v.optional(v.number()),
    lastDurationMs: v.optional(v.number()),
    consecutiveFailures: v.number(),
    // Materialized by the evaluator so reactive admin reads never derive a
    // different status just because wall-clock time moved without a write.
    evaluatedStatus: v.optional(
      v.union(
        v.literal("healthy"),
        v.literal("failed"),
        v.literal("stale"),
        v.literal("missing"),
      ),
    ),
    lastEvaluatedAt: v.optional(v.number()),
    updatedAt: v.number(),
    openLogId: v.optional(v.id("systemLogs")),
    nextRunSequence: v.optional(v.number()),
    historyMigratedAt: v.optional(v.number()),
  }).index("by_jobKey", ["jobKey"]),
  cronJobRunSummaries: defineTable({
    jobKey: v.string(),
    runSequence: v.optional(v.number()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    outcome: v.union(
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
    ),
    durationMs: v.optional(v.number()),
    failureClass: v.optional(v.string()),
  })
    .index("by_jobKey_and_startedAt", ["jobKey", "startedAt"])
    .index("by_jobKey_and_runSequence", ["jobKey", "runSequence"]),
  analyticsEvents: defineTable({
    name: v.string(),
    source: v.union(
      v.literal("client"),
      v.literal("server"),
      v.literal("api"),
      v.literal("convex"),
    ),
    path: v.optional(v.string()),
    route: v.optional(v.string()),
    title: v.optional(v.string()),
    referrer: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    visitorId: v.optional(v.string()),
    actorUserId: v.optional(v.id("users")),
    userAgent: v.optional(v.string()),
    device: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_name_and_createdAt", ["name", "createdAt"])
    .index("by_source_and_createdAt", ["source", "createdAt"])
    .index("by_path_and_createdAt", ["path", "createdAt"])
    .index("by_actorUserId_and_createdAt", ["actorUserId", "createdAt"])
    .index("by_sessionId_and_createdAt", ["sessionId", "createdAt"])
    .index("by_visitorId_and_createdAt", ["visitorId", "createdAt"]),
  // Date-bucketed operational counters deliberately exclude visitor/session
  // identifiers, URLs, user agents, referrers, and arbitrary metadata.
  analyticsDailyMetrics: defineTable({
    date: v.string(),
    captured: v.number(),
    droppedRateLimited: v.number(),
    updatedAt: v.number(),
  }).index("by_date", ["date"]),
  // Privacy-scoped field performance samples. These intentionally exclude
  // URLs, query strings, client identifiers, user agents, and account IDs.
  webVitalEvents: defineTable({
    route: v.string(),
    name: v.union(
      v.literal("LCP"),
      v.literal("INP"),
      v.literal("CLS"),
      v.literal("FCP"),
      v.literal("TTFB"),
    ),
    value: v.number(),
    rating: v.union(
      v.literal("good"),
      v.literal("needs-improvement"),
      v.literal("poor"),
    ),
    navigationType: v.union(
      v.literal("navigate"),
      v.literal("reload"),
      v.literal("back-forward"),
      v.literal("prerender"),
      v.literal("back-forward-cache"),
      v.literal("restore"),
      v.literal("soft-navigation"),
    ),
    timestamp: v.number(),
    dedupeKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_route_and_name_and_createdAt", ["route", "name", "createdAt"])
    .index("by_dedupeKey", ["dedupeKey"]),
  webVitalMinuteBuckets: defineTable({
    minute: v.number(),
    sampleCount: v.number(),
    updatedAt: v.number(),
  }).index("by_minute", ["minute"]),
  // Durable, aggregate-only operational state. This deliberately stores no
  // client identifiers, URLs, queries, account IDs, or raw event payloads.
  webVitalSloStates: defineTable({
    policyVersion: v.string(),
    route: v.string(),
    name: v.union(
      v.literal("LCP"),
      v.literal("INP"),
      v.literal("CLS"),
      v.literal("FCP"),
      v.literal("TTFB"),
    ),
    threshold: v.number(),
    minimumSamples: v.number(),
    status: v.union(
      v.literal("unknown"),
      v.literal("healthy"),
      v.literal("breached"),
    ),
    // Remains true through an unknown evaluation so a temporary lack of
    // samples cannot create duplicate breach logs or falsely resolve one.
    breachActive: v.boolean(),
    sampleCount: v.number(),
    p75: v.optional(v.number()),
    lastSampleAt: v.optional(v.number()),
    lastEvaluatedAt: v.number(),
    breachedAt: v.optional(v.number()),
    recoveredAt: v.optional(v.number()),
    openLogId: v.optional(v.id("systemLogs")),
  })
    .index("by_policyVersion_and_route_and_name", [
      "policyVersion",
      "route",
      "name",
    ])
    .index("by_policyVersion_and_status", ["policyVersion", "status"]),
  universalSearchProjections: defineTable({
    recordKey: v.string(),
    newsSnapshotDate: v.optional(v.string()),
    newsStoryId: v.optional(v.id("hnStories")),
    type: v.union(
      v.literal("evidence_document"),
      v.literal("evidence_claim"),
      v.literal("evidence_entity"),
      v.literal("blog_post"),
      v.literal("newsletter_issue"),
      v.literal("news_story"),
      v.literal("forum_thread"),
    ),
    canonicalUrl: v.string(),
    title: v.string(),
    excerpt: v.string(),
    searchText: v.string(),
    updatedAt: v.number(),
    publishedAt: v.optional(v.number()),
    citationCount: v.number(),
    sourceId: v.optional(v.string()),
    documentId: v.optional(v.string()),
    documentVersionId: v.optional(v.string()),
    claimId: v.optional(v.string()),
    entityId: v.optional(v.string()),
    citationIds: v.array(v.string()),
  })
    .index("by_recordKey", ["recordKey"])
    .searchIndex("search_by_searchText", {
      searchField: "searchText",
      filterFields: ["type"],
    }),
  evidenceSources: defineTable({
    sourceKey: v.string(),
    name: v.string(),
    sourceType: v.union(
      v.literal("rss"),
      v.literal("api"),
      v.literal("dataset"),
      v.literal("manual"),
      v.literal("derived"),
    ),
    ingestionEnabled: v.boolean(),
    baseUrl: v.string(),
    homepageUrl: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("retired"),
    ),
    licenseClass: v.union(
      v.literal("public-domain"),
      v.literal("open"),
      v.literal("attributed"),
      v.literal("restricted"),
      v.literal("unknown"),
    ),
    provenanceClass: v.union(
      v.literal("primary"),
      v.literal("official"),
      v.literal("dataset"),
      v.literal("research"),
      v.literal("derived"),
    ),
    visibility: v.union(v.literal("public"), v.literal("private")),
    termsUrl: v.string(),
    etag: v.string(),
    lastModified: v.string(),
    cursor: v.string(),
    lastFetchedAt: v.number(),
    lastSucceededAt: v.number(),
    lastErrorAt: v.number(),
    lastErrorMessage: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sourceKey", ["sourceKey"])
    .index("by_status_and_visibility", ["status", "visibility"]),
  evidenceOperationalHealth: defineTable({
    healthKey: v.string(),
    status: v.union(v.literal("healthy"), v.literal("degraded")),
    sourceCount: v.number(),
    staleSourceKeys: v.array(v.string()),
    failedSourceKeys: v.array(v.string()),
    stuckResearchJobs: v.number(),
    stuckExportJobs: v.number(),
    truncated: v.boolean(),
    summary: v.string(),
    lastCheckedAt: v.number(),
    lastChangedAt: v.number(),
  }).index("by_healthKey", ["healthKey"]),
  evidenceDocuments: defineTable({
    sourceId: v.id("evidenceSources"),
    externalKey: v.string(),
    canonicalUrl: v.string(),
    canonicalUrlHash: v.string(),
    kind: v.union(
      v.literal("document"),
      v.literal("advisory"),
      v.literal("release"),
      v.literal("paper"),
      v.literal("dataset"),
      v.literal("benchmark"),
    ),
    visibility: v.union(v.literal("public"), v.literal("private")),
    title: v.string(),
    excerpt: v.string(),
    searchText: v.string(),
    tags: v.array(v.string()),
    authors: v.array(v.string()),
    licenseClass: v.union(
      v.literal("public-domain"),
      v.literal("open"),
      v.literal("attributed"),
      v.literal("restricted"),
      v.literal("unknown"),
    ),
    currentVersionId: v.union(v.id("evidenceDocumentVersions"), v.null()),
    publishedAt: v.union(v.number(), v.null()),
    firstSeenAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sourceId_and_externalKey", ["sourceId", "externalKey"])
    .index("by_sourceId_and_visibility_and_updatedAt", {
      fields: ["sourceId", "visibility", "updatedAt"],
      staged: false,
    })
    .index("by_visibility_and_updatedAt", ["visibility", "updatedAt"])
    .searchIndex("search_by_searchText", {
      searchField: "searchText",
      filterFields: ["visibility", "sourceId"],
    }),
  // Committed atomically with first-party enrichment. Small replay checks avoid
  // re-reading large versions and re-writing their entire provenance graph.
  evidenceFirstPartyCheckpoints: defineTable({
    externalKey: v.string(),
    contentHash: v.string(),
    exposure: v.optional(v.union(v.literal("public"), v.literal("private"))),
    completedAt: v.number(),
  }).index("by_externalKey", ["externalKey"]),
  // Semantic forum changes enqueue one compact row. The generation prevents a
  // worker from acknowledging a newer edit that arrived while it was running.
  evidenceFirstPartySyncQueue: defineTable({
    threadId: v.id("forumThreads"),
    generation: v.number(),
    reason: v.union(
      v.literal("published"),
      v.literal("content_changed"),
      v.literal("visibility_changed"),
      v.literal("category_changed"),
      v.literal("quality_changed"),
      v.literal("reconciliation"),
    ),
    enqueuedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_updatedAt", ["updatedAt"]),
  // A cursor-backed safety pass covers records created before dirty tracking
  // and catches orphaned evidence whose assessment was later removed.
  evidenceFirstPartyReconciliationState: defineTable({
    key: v.string(),
    phase: v.union(
      v.literal("assessments"),
      v.literal("documents"),
      v.literal("complete"),
    ),
    cursor: v.optional(v.string()),
    completedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  evidenceDocumentVersions: defineTable({
    documentId: v.id("evidenceDocuments"),
    version: v.number(),
    contentHash: v.string(),
    title: v.string(),
    excerpt: v.string(),
    searchText: v.string(),
    fetchedAt: v.number(),
    publishedAt: v.union(v.number(), v.null()),
    sourceRevision: v.string(),
    sourceUpdatedAt: v.number(),
    rawStorageId: v.union(v.id("_storage"), v.null()),
    retrievalUrl: v.string(),
    licenseClass: v.union(
      v.literal("public-domain"),
      v.literal("open"),
      v.literal("attributed"),
      v.literal("restricted"),
      v.literal("unknown"),
    ),
    metadataJson: v.string(),
    createdAt: v.number(),
  })
    .index("by_documentId_and_version", ["documentId", "version"])
    .index("by_documentId_and_contentHash", ["documentId", "contentHash"]),
  // Compact export metadata avoids reading the duplicated title, excerpt, and
  // searchText fields from version rows on large dataset exports. Canonical
  // version rows remain the fallback until the migration backfills each ID.
  evidenceDocumentVersionExportDigests: defineTable({
    versionId: v.id("evidenceDocumentVersions"),
    documentId: v.id("evidenceDocuments"),
    version: v.number(),
    contentHash: v.string(),
    fetchedAt: v.number(),
    sourceRevision: v.string(),
    sourceUpdatedAt: v.number(),
    retrievalUrl: v.string(),
    metadataJson: v.string(),
  }).index("by_versionId", ["versionId"]),
  // Export selection reads only this compact public-facing document metadata;
  // canonical rows keep searchText and URL hashes for sibling APIs.
  evidenceDocumentExportDigests: defineTable({
    documentId: v.id("evidenceDocuments"),
    sourceId: v.id("evidenceSources"),
    externalKey: v.string(),
    canonicalUrl: v.string(),
    kind: v.union(
      v.literal("document"),
      v.literal("advisory"),
      v.literal("release"),
      v.literal("paper"),
      v.literal("dataset"),
      v.literal("benchmark"),
    ),
    visibility: v.union(v.literal("public"), v.literal("private")),
    title: v.string(),
    excerpt: v.string(),
    tags: v.array(v.string()),
    authors: v.array(v.string()),
    licenseClass: v.union(
      v.literal("public-domain"),
      v.literal("open"),
      v.literal("attributed"),
      v.literal("restricted"),
      v.literal("unknown"),
    ),
    currentVersionId: v.union(v.id("evidenceDocumentVersions"), v.null()),
    publishedAt: v.union(v.number(), v.null()),
    firstSeenAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_documentId", ["documentId"])
    .index("by_sourceId_and_visibility_and_updatedAt", [
      "sourceId",
      "visibility",
      "updatedAt",
    ])
    .index("by_visibility_and_updatedAt", ["visibility", "updatedAt"]),
  evidenceEntities: defineTable({
    entityKey: v.string(),
    kind: v.union(
      v.literal("organization"),
      v.literal("product"),
      v.literal("model"),
      v.literal("project"),
      v.literal("person"),
      v.literal("concept"),
    ),
    name: v.string(),
    aliases: v.array(v.string()),
    visibility: v.union(v.literal("public"), v.literal("private")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entityKey", ["entityKey"])
    .index("by_visibility_and_updatedAt", ["visibility", "updatedAt"]),
  evidenceDocumentEntities: defineTable({
    documentVersionId: v.id("evidenceDocumentVersions"),
    entityId: v.id("evidenceEntities"),
    role: v.union(
      v.literal("subject"),
      v.literal("publisher"),
      v.literal("mentioned"),
    ),
    createdAt: v.number(),
  })
    .index("by_documentVersionId", ["documentVersionId"])
    .index("by_entityId", ["entityId"])
    .index("by_documentVersionId_and_entityId", [
      "documentVersionId",
      "entityId",
    ]),
  evidenceClaims: defineTable({
    claimKey: v.string(),
    statement: v.string(),
    subjectEntityId: v.union(v.id("evidenceEntities"), v.null()),
    predicate: v.string(),
    objectText: v.string(),
    status: v.union(
      v.literal("supported"),
      v.literal("contradicted"),
      v.literal("unresolved"),
      v.literal("outdated"),
    ),
    confidence: v.number(),
    visibility: v.union(v.literal("public"), v.literal("private")),
    observedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_claimKey", ["claimKey"])
    .index("by_visibility_and_status_and_observedAt", [
      "visibility",
      "status",
      "observedAt",
    ]),
  // Claim rows are the current read model. Every material state is retained in
  // evidenceClaimRevisions so citations and prior conclusions remain auditable.
  evidenceClaimRevisions: defineTable({
    claimId: v.id("evidenceClaims"),
    revisionKey: v.string(),
    changeKind: v.union(
      v.literal("created"),
      v.literal("legacy-baseline"),
      v.literal("semantic"),
      v.literal("status"),
      v.literal("evidence"),
    ),
    statement: v.string(),
    subjectEntityId: v.union(v.id("evidenceEntities"), v.null()),
    predicate: v.string(),
    objectText: v.string(),
    status: v.union(
      v.literal("supported"),
      v.literal("contradicted"),
      v.literal("unresolved"),
      v.literal("outdated"),
    ),
    confidence: v.number(),
    visibility: v.union(v.literal("public"), v.literal("private")),
    observedAt: v.number(),
    actorType: v.union(
      v.literal("system"),
      v.literal("agent"),
      v.literal("human"),
    ),
    actorId: v.string(),
    source: v.string(),
    citationId: v.union(v.id("evidenceClaimCitations"), v.null()),
    createdAt: v.number(),
    retentionExpiresAt: v.number(),
  })
    .index("by_revisionKey", ["revisionKey"])
    .index("by_claimId_and_observedAt", ["claimId", "observedAt"])
    .index("by_retentionExpiresAt", ["retentionExpiresAt"]),
  evidenceClaimCitations: defineTable({
    claimId: v.id("evidenceClaims"),
    documentVersionId: v.id("evidenceDocumentVersions"),
    citationKey: v.string(),
    relation: v.union(
      v.literal("supports"),
      v.literal("contradicts"),
      v.literal("context"),
    ),
    locator: v.string(),
    excerpt: v.string(),
    confidence: v.number(),
    createdAt: v.number(),
  })
    .index("by_claimId", ["claimId"])
    .index("by_documentVersionId", ["documentVersionId"])
    .index("by_citationKey", ["citationKey"])
    .index("by_claimId_and_documentVersionId_and_citationKey", [
      "claimId",
      "documentVersionId",
      "citationKey",
    ]),
  evidenceChangeEvents: defineTable({
    eventKey: v.string(),
    entityType: v.union(
      v.literal("document"),
      v.literal("claim"),
      v.literal("dataset"),
      v.literal("benchmark"),
    ),
    entityId: v.string(),
    kind: v.union(
      v.literal("created"),
      v.literal("updated"),
      v.literal("status-changed"),
    ),
    visibility: v.union(v.literal("public"), v.literal("private")),
    summary: v.string(),
    // Added optional for existing immutable event rows. New document events
    // persist this bounded, deterministic allowlist of changed fields.
    changedFields: v.optional(v.array(v.string())),
    occurredAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_eventKey", ["eventKey"])
    .index("by_visibility_and_occurredAt", ["visibility", "occurredAt"]),
  evidenceWatchlists: defineTable({
    ownerUserId: v.id("users"),
    // Null denotes an owner-managed list. An agent may only read or mutate its
    // own agentId rows, while the human owner remains the tenant authority.
    agentId: v.union(v.string(), v.null()),
    watchlistKey: v.string(),
    targetType: v.union(
      v.literal("source"),
      v.literal("entity"),
      v.literal("claim"),
      v.literal("document"),
      v.literal("topic"),
      v.literal("repository"),
    ),
    targetKey: v.string(),
    status: v.union(v.literal("active"), v.literal("paused")),
    deliveryPreference: v.union(
      v.literal("in_app"),
      v.literal("webhook"),
      v.literal("none"),
    ),
    eventCursor: v.optional(v.string()),
    // Every drain attempt writes this monotonic conflict anchor before checking
    // idempotency, so concurrent requests serialize even with no event rows.
    drainNonce: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerUserId_and_watchlistKey", ["ownerUserId", "watchlistKey"])
    .index("by_ownerUserId_and_agentId_and_updatedAt", [
      "ownerUserId",
      "agentId",
      "updatedAt",
    ])
    .index("by_ownerUserId_and_updatedAt", ["ownerUserId", "updatedAt"]),
  // This is deliberately an outbox only. A later delivery bridge may claim
  // rows, but watchlist matching never performs network delivery itself.
  evidenceWatchlistOutbox: defineTable({
    watchlistId: v.id("evidenceWatchlists"),
    eventId: v.id("evidenceChangeEvents"),
    ownerUserId: v.id("users"),
    agentId: v.union(v.string(), v.null()),
    deliveryPreference: v.union(
      v.literal("in_app"),
      v.literal("webhook"),
      v.literal("none"),
    ),
    eventKey: v.string(),
    // A bridge claims only pending rows. Terminal rows remain for a bounded
    // audit window so a scheduler retry cannot create a second delivery.
    status: v.union(
      v.literal("pending"),
      v.literal("dispatched"),
      v.literal("discarded"),
    ),
    createdAt: v.number(),
    dispatchedAt: v.optional(v.number()),
    discardedAt: v.optional(v.number()),
  })
    .index("by_watchlistId_and_eventId", ["watchlistId", "eventId"])
    .index("by_status_and_createdAt", ["status", "createdAt"]),
  evidenceWatchlistDrainRequests: defineTable({
    watchlistId: v.id("evidenceWatchlists"),
    idempotencyKey: v.string(),
    requestFingerprint: v.string(),
    scanned: v.number(),
    matched: v.number(),
    enqueued: v.number(),
    eventCursor: v.union(v.string(), v.null()),
    createdAt: v.number(),
  })
    .index("by_watchlistId_and_idempotencyKey", [
      "watchlistId",
      "idempotencyKey",
    ])
    .index("by_watchlistId_and_createdAt", ["watchlistId", "createdAt"]),
  evidenceDatasets: defineTable({
    datasetKey: v.string(),
    name: v.string(),
    description: v.string(),
    visibility: v.union(v.literal("public"), v.literal("private")),
    licenseClass: v.union(
      v.literal("public-domain"),
      v.literal("open"),
      v.literal("attributed"),
      v.literal("restricted"),
      v.literal("unknown"),
    ),
    // A bounded, code-owned selection contract makes each commercial dataset
    // materially distinct. Empty arrays mean every eligible public value.
    includedKinds: v.optional(v.array(v.string())),
    includedLicenseClasses: v.optional(v.array(v.string())),
    sourceKeys: v.optional(v.array(v.string())),
    exportSchemaVersion: v.optional(v.string()),
    snapshotRetentionDays: v.optional(v.number()),
    minimumRetainedVersions: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_datasetKey", ["datasetKey"])
    .index("by_visibility_and_status_and_updatedAt", [
      "visibility",
      "status",
      "updatedAt",
    ]),
  evidencePublicationState: defineTable({
    key: v.string(),
    epoch: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  evidenceDatasetVersions: defineTable({
    publicationEpoch: v.optional(v.number()),
    datasetId: v.id("evidenceDatasets"),
    version: v.string(),
    checksum: v.string(),
    recordCount: v.number(),
    schemaVersion: v.optional(v.string()),
    artifactByteLength: v.optional(v.number()),
    sourceCount: v.optional(v.number()),
    configuredSourceCount: v.optional(v.number()),
    sourceCoverageScore: v.optional(v.number()),
    missingSourceKeys: v.optional(v.array(v.string())),
    citationCount: v.optional(v.number()),
    citationCoverageScore: v.optional(v.number()),
    entityCount: v.optional(v.number()),
    entityCoverageScore: v.optional(v.number()),
    claimCount: v.optional(v.number()),
    claimCoverageScore: v.optional(v.number()),
    completenessScore: v.optional(v.number()),
    freshnessScore: v.optional(v.number()),
    earliestObservedAt: v.optional(v.number()),
    latestObservedAt: v.optional(v.number()),
    qualityMetricsJson: v.optional(v.string()),
    manifestStorageId: v.optional(v.id("_storage")),
    artifactStorageId: v.optional(v.id("_storage")),
    format: v.optional(v.union(v.literal("jsonl"), v.literal("parquet"))),
    parentVersionId: v.optional(v.id("evidenceDatasetVersions")),
    selectionStrategy: v.optional(
      v.union(v.literal("balanced"), v.literal("recent")),
    ),
    scannedRecordCount: v.optional(v.number()),
    selectionScanTruncated: v.optional(v.boolean()),
    continueCursor: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_datasetId_and_version", ["datasetId", "version"])
    .index("by_datasetId_and_checksum", ["datasetId", "checksum"])
    .index("by_manifestStorageId", ["manifestStorageId"])
    .index("by_artifactStorageId", ["artifactStorageId"]),
  evidenceBenchmarks: defineTable({
    benchmarkKey: v.string(),
    name: v.string(),
    description: v.string(),
    visibility: v.union(v.literal("public"), v.literal("private")),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_benchmarkKey", ["benchmarkKey"])
    .index("by_visibility_and_status_and_updatedAt", [
      "visibility",
      "status",
      "updatedAt",
    ]),
  evidenceBenchmarkRuns: defineTable({
    benchmarkId: v.id("evidenceBenchmarks"),
    runKey: v.string(),
    model: v.string(),
    score: v.number(),
    metricsJson: v.string(),
    executedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_benchmarkId_and_executedAt", ["benchmarkId", "executedAt"])
    .index("by_runKey", ["runKey"]),
  evidenceResearchJobs: defineTable({
    publicationEpoch: v.optional(v.number()),
    ownerUserId: v.id("users"),
    agentId: v.string(),
    requestKey: v.string(),
    requestFingerprint: v.string(),
    idempotencyKey: v.string(),
    quotaUnits: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    query: v.string(),
    resultJson: v.string(),
    resultStorageId: v.optional(v.id("_storage")),
    // Optional for rolling compatibility with jobs created before execution
    // ownership was introduced. New workflows atomically claim this token.
    executionToken: v.optional(v.string()),
    executionClaimedAt: v.optional(v.number()),
    externalWorkStartedAt: v.optional(v.number()),
    artifactPurgedAt: v.optional(v.number()),
    errorMessage: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerUserId_and_idempotencyKey", [
      "ownerUserId",
      "idempotencyKey",
    ])
    .index("by_ownerUserId_and_requestFingerprint", [
      "ownerUserId",
      "requestFingerprint",
    ])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_status_and_artifactPurgedAt_and_expiresAt", [
      "status",
      "artifactPurgedAt",
      "expiresAt",
    ]),
  evidenceExportJobs: defineTable({
    publicationEpoch: v.optional(v.number()),
    ownerUserId: v.id("users"),
    agentId: v.string(),
    datasetId: v.id("evidenceDatasets"),
    requestKey: v.string(),
    requestFingerprint: v.string(),
    idempotencyKey: v.string(),
    quotaUnits: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    format: v.union(v.literal("jsonl"), v.literal("parquet")),
    recordLimit: v.optional(v.number()),
    selectionStrategy: v.optional(
      v.union(v.literal("balanced"), v.literal("recent")),
    ),
    cursor: v.optional(v.string()),
    continueCursor: v.optional(v.string()),
    scannedRecordCount: v.optional(v.number()),
    artifactByteLength: v.optional(v.number()),
    checksum: v.string(),
    recordCount: v.number(),
    resultJson: v.string(),
    resultStorageId: v.optional(v.id("_storage")),
    executionToken: v.optional(v.string()),
    executionClaimedAt: v.optional(v.number()),
    externalWorkStartedAt: v.optional(v.number()),
    artifactPurgedAt: v.optional(v.number()),
    errorMessage: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerUserId_and_idempotencyKey", [
      "ownerUserId",
      "idempotencyKey",
    ])
    .index("by_ownerUserId_and_requestFingerprint", [
      "ownerUserId",
      "requestFingerprint",
    ])
    .index("by_datasetId_and_createdAt", ["datasetId", "createdAt"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_status_and_artifactPurgedAt_and_expiresAt", [
      "status",
      "artifactPurgedAt",
      "expiresAt",
    ]),
  /**
   * Immutable metadata for a stored result. The storage object can be purged
   * after retention without erasing the audit record or usage ledger.
   */
  evidenceArtifacts: defineTable({
    ownerUserId: v.id("users"),
    agentId: v.string(),
    kind: v.union(v.literal("research"), v.literal("export")),
    researchJobId: v.optional(v.id("evidenceResearchJobs")),
    exportJobId: v.optional(v.id("evidenceExportJobs")),
    storageId: v.id("_storage"),
    contentType: v.string(),
    byteLength: v.number(),
    sha256: v.string(),
    generatedAt: v.number(),
    expiresAt: v.number(),
    status: v.union(v.literal("available"), v.literal("purged")),
    purgedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_researchJobId", ["researchJobId"])
    .index("by_exportJobId", ["exportJobId"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),
  apiProducts: defineTable({
    productKey: v.string(),
    name: v.string(),
    description: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    visibility: v.union(v.literal("public"), v.literal("private")),
    unitPriceMicroUsd: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_productKey", ["productKey"])
    .index("by_visibility_and_status_and_updatedAt", [
      "visibility",
      "status",
      "updatedAt",
    ]),
  apiEntitlements: defineTable({
    ownerUserId: v.id("users"),
    productId: v.id("apiProducts"),
    status: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    startsAt: v.number(),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerUserId_and_productId", ["ownerUserId", "productId"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),
  apiBillingAccounts: defineTable({
    ownerUserId: v.id("users"),
    status: v.union(
      v.literal("active"),
      v.literal("delinquent"),
      v.literal("closed"),
    ),
    providerCustomerRef: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerUserId", ["ownerUserId"])
    .index("by_providerCustomerRef", ["providerCustomerRef"]),
  apiUsageLedger: defineTable({
    entryKey: v.string(),
    ownerUserId: v.id("users"),
    agentId: v.string(),
    productId: v.optional(v.id("apiProducts")),
    commandId: v.optional(v.id("apiCommands")),
    idempotencyKey: v.string(),
    operation: v.string(),
    entryType: v.union(
      v.literal("debit"),
      v.literal("credit"),
      v.literal("reversal"),
    ),
    units: v.number(),
    entitlementSnapshotJson: v.string(),
    costBasisJson: v.string(),
    metadataJson: v.string(),
    createdAt: v.number(),
  })
    .index("by_entryKey", ["entryKey"])
    .index("by_ownerUserId_and_idempotencyKey", [
      "ownerUserId",
      "idempotencyKey",
    ])
    .index("by_ownerUserId_and_createdAt", ["ownerUserId", "createdAt"]),
  apiBillingOutbox: defineTable({
    eventKey: v.string(),
    kind: v.union(
      v.literal("usage"),
      v.literal("entitlement"),
      v.literal("invoice"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    providerEventId: v.string(),
    attempts: v.number(),
    payloadJson: v.string(),
    availableAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_eventKey", ["eventKey"])
    .index("by_status_and_availableAt", ["status", "availableAt"]),
  apiWebhookEvents: defineTable({
    provider: v.string(),
    eventKey: v.string(),
    payloadJson: v.string(),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("by_provider_and_eventKey", ["provider", "eventKey"])
    .index("by_provider_and_receivedAt", ["provider", "receivedAt"])
    .index("by_receivedAt", ["receivedAt"]),
  apiCommands: defineTable({
    ownerUserId: v.id("users"),
    commandKey: v.string(),
    requestFingerprint: v.string(),
    kind: v.string(),
    status: v.union(
      v.literal("accepted"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    payloadJson: v.string(),
    resultJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerUserId_and_commandKey", ["ownerUserId", "commandKey"])
    .index("by_ownerUserId_and_requestFingerprint", [
      "ownerUserId",
      "requestFingerprint",
    ])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),
  apiWebhookSubscriptions: defineTable({
    ownerUserId: v.id("users"),
    subscriptionKey: v.string(),
    url: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("revoked"),
    ),
    eventTypes: v.array(v.string()),
    signingSecretCiphertext: v.optional(v.string()),
    signingSecretNonce: v.optional(v.string()),
    signingSecretVersion: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerUserId_and_subscriptionKey", [
      "ownerUserId",
      "subscriptionKey",
    ])
    .index("by_ownerUserId_and_updatedAt", ["ownerUserId", "updatedAt"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),
  apiWebhookTargets: defineTable({
    subscriptionId: v.id("apiWebhookSubscriptions"),
    ownerUserId: v.id("users"),
    eventType: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("revoked"),
    ),
    updatedAt: v.number(),
  })
    .index("by_subscriptionId_and_eventType", ["subscriptionId", "eventType"])
    .index("by_subscriptionId", ["subscriptionId"])
    .index("by_eventType_and_status_and_updatedAt", [
      "eventType",
      "status",
      "updatedAt",
    ])
    .index("by_ownerUserId_and_eventType_and_status_and_updatedAt", [
      "ownerUserId",
      "eventType",
      "status",
      "updatedAt",
    ]),
  apiWebhookDeliveries: defineTable({
    subscriptionId: v.id("apiWebhookSubscriptions"),
    eventKey: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("in_flight"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("dead_letter"),
    ),
    attempt: v.number(),
    deliveryGeneration: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    responseCode: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    replayCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_subscriptionId_and_eventKey", ["subscriptionId", "eventKey"])
    .index("by_subscriptionId_and_updatedAt", ["subscriptionId", "updatedAt"])
    .index("by_eventKey", ["eventKey"])
    .index("by_status_and_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_status_and_leaseExpiresAt", ["status", "leaseExpiresAt"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),
});
