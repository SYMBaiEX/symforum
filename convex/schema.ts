import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The schema is normally optional, but Convex Auth
// requires indexes defined on `authTables`.
export default defineSchema({
  ...authTables,
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
    role: v.optional(v.union(v.literal("owner"), v.literal("reader"))),
    contactEmail: v.optional(v.string()),
    bio: v.optional(v.string()),
    onboardedAt: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_usernameNormalized", ["usernameNormalized"])
    .index("by_role", ["role"]),
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
  sitePages: defineTable({
    slug: v.string(),
    title: v.string(),
    subtitle: v.string(),
    heroHeading: v.string(),
    heroBody: v.string(),
    body: v.string(),
    status: v.union(v.literal("draft"), v.literal("published")),
    updatedAt: v.number(),
    imageUrl: v.optional(v.string()),
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
    .index("by_hnItemId", ["hnItemId"]),
  comments: defineTable({
    userId: v.id("users"),
    entityType: v.union(v.literal("post"), v.literal("hnStory")),
    entityId: v.string(),
    parentId: v.optional(v.id("comments")),
    body: v.string(),
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
    tokenHash: v.string(),
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
  newsletterIssues: defineTable({
    slug: v.string(),
    subject: v.string(),
    previewText: v.string(),
    body: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("sent"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    linkedPostSlug: v.optional(v.string()),
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
    .index("by_subscriberId_and_receivedAt", ["subscriberId", "receivedAt"]),
  newsletterSettings: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
