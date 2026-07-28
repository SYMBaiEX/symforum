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
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_usernameNormalized", ["usernameNormalized"])
    .index("by_agentSlug", ["agentSlug"])
    .index("by_role", ["role"])
    .index("by_forumRole", ["forumRole"]),
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
    .index("by_hnItemId", ["hnItemId"]),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_emailNormalized_and_createdAt", [
      "emailNormalized",
      "createdAt",
    ]),
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
    completedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    issueId: v.optional(v.id("newsletterIssues")),
    storyCount: v.number(),
    topStoryIds: v.array(v.number()),
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
    .index("by_status_and_createdAt", ["status", "createdAt"]),
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
    prefixId: v.optional(v.id("forumThreadPrefixes")),
    prefixSlug: v.optional(v.string()),
    prefixLabel: v.optional(v.string()),
    prefixColor: v.optional(v.string()),
    slug: v.string(),
    title: v.string(),
    body: v.string(),
    authorId: v.id("users"),
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
  forumPosts: defineTable({
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    authorId: v.id("users"),
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
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
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
    .index("by_runDate", ["runDate"]),
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
    .index("by_threadId", ["threadId"]),
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
    type: v.union(v.literal("reply"), v.literal("newThread")),
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
});
