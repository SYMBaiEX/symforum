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
  })
    .index("by_slug", ["slug"])
    .index("by_status_and_publishedAt", ["status", "publishedAt"])
    .index("by_featured_and_publishedAt", ["featured", "publishedAt"]),
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
    body: v.string(),
    createdAt: v.number(),
  })
    .index("by_entityType_and_entityId_and_createdAt", [
      "entityType",
      "entityId",
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
    .index("by_entityType_and_entityId", ["entityType", "entityId"]),
});
