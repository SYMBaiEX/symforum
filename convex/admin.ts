import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { normalizePostInput, postInputValidator } from "./postModel";
import {
  normalizePortfolioProjectInput,
  normalizeSitePageInput,
  portfolioProjectInputValidator,
  sitePageInputValidator,
} from "./siteContentModel";

const commentEntityTypeValidator = v.union(
  v.literal("post"),
  v.literal("hnStory"),
  v.literal("portfolioProject"),
);
const interactionEntityTypeValidator = v.union(
  v.literal("post"),
  v.literal("hnStory"),
);
const contactRequestStatusValidator = v.union(
  v.literal("new"),
  v.literal("read"),
  v.literal("archived"),
);

async function currentUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get(userId);
}

async function requireOwner(ctx: QueryCtx | MutationCtx) {
  const user = await currentUser(ctx);
  if (user === null) {
    throw new Error("Not authenticated");
  }
  if (user.role !== "owner") {
    throw new Error("Unauthorized");
  }
  return user;
}

async function firstOwner(ctx: QueryCtx | MutationCtx) {
  const owners = await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "owner"))
    .take(1);
  return owners[0] ?? null;
}

async function authorName(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return user?.username ?? user?.name ?? "SYM-UNKNOWN";
}

function commentStatus(comment: Pick<Doc<"comments">, "status">) {
  return comment.status ?? "active";
}

async function softDeleteComment(
  ctx: MutationCtx,
  commentId: Id<"comments">,
  actorUserId: Id<"users">,
) {
  const comment = await ctx.db.get(commentId);
  if (comment === null) {
    return { deleted: false };
  }
  if (commentStatus(comment) === "deleted") {
    return { deleted: true };
  }
  const now = Date.now();
  await ctx.db.patch(comment._id, {
    body: "",
    status: "deleted",
    updatedAt: now,
    deletedAt: now,
    deletedBy: actorUserId,
    moderationReason: "admin_delete",
  });
  await ctx.db.insert("systemLogs", {
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    occurrences: 1,
    level: "info",
    status: "open",
    source: "convex",
    scope: "comments",
    eventType: "comment_admin_deleted",
    message: "Comment soft-deleted from admin dashboard",
    fingerprint: `comment_admin_deleted:${comment._id}`,
    actorUserId,
    entityType: comment.entityType,
    entityId: comment.entityId,
    metadataJson: JSON.stringify({
      commentId: comment._id,
      parentId: comment.parentId ?? null,
      commentAuthorUserId: comment.userId,
    }),
  });
  return { deleted: true };
}

function publicApiKey(key: Doc<"apiKeys">) {
  const publicKey: {
    _id: Id<"apiKeys">;
    _creationTime: number;
    name: string;
    tokenPreview: string;
    createdBy: Id<"users">;
    createdAt: number;
    lastUsedAt?: number;
    revokedAt?: number;
  } = {
    _id: key._id,
    _creationTime: key._creationTime,
    name: key.name,
    tokenPreview: key.tokenPreview,
    createdBy: key.createdBy,
    createdAt: key.createdAt,
  };
  if (key.lastUsedAt !== undefined) {
    publicKey.lastUsedAt = key.lastUsedAt;
  }
  if (key.revokedAt !== undefined) {
    publicKey.revokedAt = key.revokedAt;
  }
  return publicKey;
}

function adminUserRecord(user: Doc<"users">) {
  return {
    _id: user._id,
    _creationTime: user._creationTime,
    name: user.name,
    email: user.email,
    username: user.username,
    usernameNormalized: user.usernameNormalized,
    usernameSource: user.usernameSource,
    role: user.role ?? "reader",
    roleAssignedAt: user.roleAssignedAt,
    roleAssignedBy: user.roleAssignedBy,
    contactEmail: user.contactEmail,
    bio: user.bio,
    onboardedAt: user.onboardedAt,
  };
}

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    const owner = await firstOwner(ctx);
    return {
      user,
      isOwner: user?.role === "owner",
      ownerExists: owner !== null,
    };
  },
});

export const claimInitialOwner = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (user === null) {
      throw new Error("Not authenticated");
    }
    const owner = await firstOwner(ctx);
    if (owner !== null) {
      throw new Error("Owner already exists");
    }

    const now = Date.now();
    await ctx.db.patch(user._id, {
      role: "owner",
      roleAssignedAt: now,
      roleAssignedBy: user._id,
    });
    await ctx.db.insert("systemLogs", {
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      occurrences: 1,
      level: "info",
      status: "open",
      source: "convex",
      scope: "admin",
      eventType: "initial_owner_claimed",
      message: "Initial owner claimed admin access",
      fingerprint: `initial_owner_claimed:${user._id}`,
      actorUserId: user._id,
      entityType: "user",
      entityId: user._id,
    });

    const updated = await ctx.db.get(user._id);
    if (updated === null) {
      throw new Error("User could not be reloaded");
    }
    return adminUserRecord(updated);
  },
});

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwner(ctx);
    const [
      posts,
      recentComments,
      recentInteractions,
      owners,
      admins,
      readers,
      subscribers,
      newsletterIssues,
      portfolioProjects,
      sitePages,
      newsSnapshots,
      contactRequests,
      openContactRequests,
      openLogs,
      analyticsEvents,
    ] = await Promise.all([
      ctx.db.query("posts").withIndex("by_publishedAt").order("desc").take(100),
      ctx.db
        .query("comments")
        .withIndex("by_createdAt")
        .order("desc")
        .take(20),
      ctx.db
        .query("interactions")
        .withIndex("by_updatedAt")
        .order("desc")
        .take(20),
      ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "owner"))
        .take(100),
      ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "admin"))
        .take(100),
      ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "reader"))
        .take(500),
      ctx.db
        .query("newsletterSubscribers")
        .withIndex("by_createdAt")
        .order("desc")
        .take(500),
      ctx.db
        .query("newsletterIssues")
        .withIndex("by_updatedAt")
        .order("desc")
        .take(100),
      ctx.db.query("portfolioProjects").withIndex("by_order").take(100),
      ctx.db.query("sitePages").withIndex("by_slug").take(50),
      ctx.db
        .query("newsSnapshots")
        .withIndex("by_snapshotDate")
        .order("desc")
        .take(30),
      ctx.db
        .query("contactRequests")
        .withIndex("by_createdAt")
        .order("desc")
        .take(100),
      ctx.db
        .query("contactRequests")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", "new"))
        .order("desc")
        .take(100),
      ctx.db
        .query("systemLogs")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", "open"))
        .order("desc")
        .take(100),
      ctx.db
        .query("analyticsEvents")
        .withIndex("by_createdAt")
        .order("desc")
        .take(500),
    ]);

    return {
      user,
      totals: {
        posts: posts.length,
        publishedPosts: posts.filter((post) => post.status === "published")
          .length,
        commentsSample: recentComments.length,
        interactionsSample: recentInteractions.length,
        users: owners.length + admins.length + readers.length,
        owners: owners.length,
        admins: admins.length,
        readers: readers.length,
        newsletterSubscribers: subscribers.length,
        confirmedSubscribers: subscribers.filter(
          (subscriber) => subscriber.status === "confirmed",
        ).length,
        newsletterIssues: newsletterIssues.length,
        portfolioProjects: portfolioProjects.length,
        sitePages: sitePages.length,
        newsSnapshots: newsSnapshots.length,
        contactRequestsSample: contactRequests.length,
        openContactRequests: openContactRequests.length,
        openSystemLogs: openLogs.length,
        analyticsEventsSample: analyticsEvents.length,
      },
      recentComments: await Promise.all(
        recentComments.map(async (comment) => ({
          ...comment,
          author: await authorName(ctx, comment.userId),
        })),
      ),
      recentInteractions: await Promise.all(
        recentInteractions.map(async (interaction) => ({
          ...interaction,
          author: await authorName(ctx, interaction.userId),
        })),
      ),
    };
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const users = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized")
      .order("asc")
      .take(200);
    return users.map(adminUserRecord);
  },
});

export const updateUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("reader")),
  },
  handler: async (ctx, args) => {
    const actor = await requireOwner(ctx);
    const user = await ctx.db.get(args.userId);
    if (user === null) {
      throw new Error("User not found");
    }

    if (user.role === "owner" && args.role !== "owner") {
      const owners = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "owner"))
        .take(2);
      if (owners.length <= 1) {
        throw new Error("Cannot demote the last owner");
      }
    }

    const now = Date.now();
    await ctx.db.patch(args.userId, {
      role: args.role,
      roleAssignedAt: now,
      roleAssignedBy: actor._id,
    });
    await ctx.db.insert("systemLogs", {
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      occurrences: 1,
      level: "info",
      status: "open",
      source: "convex",
      scope: "admin",
      eventType: "user_role_updated",
      message: "User role updated from admin dashboard",
      fingerprint: `user_role_updated:${args.userId}:${now}`,
      actorUserId: actor._id,
      entityType: "user",
      entityId: args.userId,
      metadataJson: JSON.stringify({
        userId: args.userId,
        previousRole: user.role ?? null,
        nextRole: args.role,
      }),
    });

    const updated = await ctx.db.get(args.userId);
    if (updated === null) {
      throw new Error("User could not be reloaded");
    }
    return adminUserRecord(updated);
  },
});

export const listPosts = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return await ctx.db
      .query("posts")
      .withIndex("by_publishedAt")
      .order("desc")
      .take(100);
  },
});

export const getPost = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return await ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
  },
});

export const upsertPost = mutation({
  args: { post: postInputValidator },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const post = normalizePostInput(args.post);
    const existing = await ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", post.slug))
      .unique();

    if (existing === null) {
      const id = await ctx.db.insert("posts", post);
      return await ctx.db.get(id);
    }

    await ctx.db.patch(existing._id, post);
    return await ctx.db.get(existing._id);
  },
});

export const deletePost = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const existing = await ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing === null) {
      return { deleted: false };
    }
    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const resolveStorageUrl = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return await ctx.storage.getUrl(args.storageId);
  },
});

export const listSitePages = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return await ctx.db
      .query("sitePages")
      .withIndex("by_slug")
      .order("asc")
      .take(50);
  },
});

export const upsertSitePage = mutation({
  args: { page: sitePageInputValidator },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const page = normalizeSitePageInput(args.page);
    const existing = await ctx.db
      .query("sitePages")
      .withIndex("by_slug", (q) => q.eq("slug", page.slug))
      .unique();

    if (existing === null) {
      const id = await ctx.db.insert("sitePages", page);
      return await ctx.db.get(id);
    }

    await ctx.db.patch(existing._id, {
      ...page,
      showImage: page.showImage === true ? true : undefined,
      imageUrl: page.imageUrl,
      imageLightUrl: page.imageLightUrl,
      imageAlt: page.imageAlt,
      imageCredit: page.imageCredit,
    });
    return await ctx.db.get(existing._id);
  },
});

export const deleteSitePage = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const existing = await ctx.db
      .query("sitePages")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing === null) {
      return { deleted: false };
    }
    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});

export const listPortfolioProjects = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return await ctx.db
      .query("portfolioProjects")
      .withIndex("by_order")
      .order("asc")
      .take(100);
  },
});

export const upsertPortfolioProject = mutation({
  args: { project: portfolioProjectInputValidator },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const project = normalizePortfolioProjectInput(args.project);
    const existing = await ctx.db
      .query("portfolioProjects")
      .withIndex("by_slug", (q) => q.eq("slug", project.slug))
      .unique();

    if (existing === null) {
      const id = await ctx.db.insert("portfolioProjects", project);
      return await ctx.db.get(id);
    }

    await ctx.db.patch(existing._id, project);
    return await ctx.db.get(existing._id);
  },
});

export const deletePortfolioProject = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const existing = await ctx.db
      .query("portfolioProjects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing === null) {
      return { deleted: false };
    }
    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});

export const listComments = query({
  args: {
    entityType: v.optional(commentEntityTypeValidator),
    entityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const comments =
      args.entityType && args.entityId
        ? await ctx.db
            .query("comments")
            .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
              q
                .eq("entityType", args.entityType!)
                .eq("entityId", args.entityId!),
            )
            .order("desc")
            .take(100)
        : await ctx.db
            .query("comments")
            .withIndex("by_createdAt")
            .order("desc")
            .take(100);

    return await Promise.all(
      comments.map(async (comment) => ({
        ...comment,
        status: commentStatus(comment),
        body:
          commentStatus(comment) === "active" ? comment.body : "Comment deleted",
        author: await authorName(ctx, comment.userId),
      })),
    );
  },
});

export const deleteComment = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    const user = await requireOwner(ctx);
    return await softDeleteComment(ctx, args.commentId, user._id);
  },
});

export const listInteractions = query({
  args: {
    entityType: v.optional(interactionEntityTypeValidator),
    entityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const interactions =
      args.entityType && args.entityId
        ? await ctx.db
            .query("interactions")
            .withIndex("by_entityType_and_entityId", (q) =>
              q
                .eq("entityType", args.entityType!)
                .eq("entityId", args.entityId!),
            )
            .take(100)
        : await ctx.db
            .query("interactions")
            .withIndex("by_updatedAt")
            .order("desc")
            .take(100);

    return await Promise.all(
      interactions.map(async (interaction) => ({
        ...interaction,
        author: await authorName(ctx, interaction.userId),
      })),
    );
  },
});

export const deleteInteraction = mutation({
  args: { interactionId: v.id("interactions") },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    await ctx.db.delete(args.interactionId);
    return { deleted: true };
  },
});

export const listApiKeys = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_createdAt")
      .order("desc")
      .take(50);
    return keys.map(publicApiKey);
  },
});

export const createApiKey = mutation({
  args: {
    name: v.string(),
    tokenHash: v.string(),
    tokenPreview: v.string(),
  },
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80) {
      throw new Error("API key name must be between 2 and 80 characters");
    }
    if (!/^[a-f0-9]{64}$/.test(args.tokenHash)) {
      throw new Error("Invalid API key hash");
    }
    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (existing !== null) {
      throw new Error("API key already exists");
    }
    const id = await ctx.db.insert("apiKeys", {
      name,
      tokenHash: args.tokenHash,
      tokenPreview: args.tokenPreview,
      createdBy: owner._id,
      createdAt: Date.now(),
    });
    const key = await ctx.db.get(id);
    if (key === null) {
      throw new Error("API key could not be created");
    }
    return publicApiKey(key);
  },
});

export const revokeApiKey = mutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    await ctx.db.patch(args.keyId, { revokedAt: Date.now() });
    return { revoked: true };
  },
});

export const listContactRequests = query({
  args: { status: v.optional(contactRequestStatusValidator) },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (args.status !== undefined) {
      return await ctx.db
        .query("contactRequests")
        .withIndex("by_status_and_createdAt", (q) =>
          q.eq("status", args.status!),
        )
        .order("desc")
        .take(100);
    }
    return await ctx.db
      .query("contactRequests")
      .withIndex("by_createdAt")
      .order("desc")
      .take(100);
  },
});

export const updateContactRequestStatus = mutation({
  args: {
    requestId: v.id("contactRequests"),
    status: contactRequestStatusValidator,
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    await ctx.db.patch(args.requestId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});
