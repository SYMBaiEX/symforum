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

const entityTypeValidator = v.union(v.literal("post"), v.literal("hnStory"));

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

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwner(ctx);
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_publishedAt")
      .order("desc")
      .take(100);
    const recentComments = await ctx.db
      .query("comments")
      .withIndex("by_createdAt")
      .order("desc")
      .take(20);
    const recentInteractions = await ctx.db
      .query("interactions")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(20);

    return {
      user,
      totals: {
        posts: posts.length,
        publishedPosts: posts.filter((post) => post.status === "published")
          .length,
        commentsSample: recentComments.length,
        interactionsSample: recentInteractions.length,
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

    await ctx.db.patch(existing._id, page);
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
    entityType: v.optional(entityTypeValidator),
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
        author: await authorName(ctx, comment.userId),
      })),
    );
  },
});

export const deleteComment = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    await ctx.db.delete(args.commentId);
    return { deleted: true };
  },
});

export const listInteractions = query({
  args: {
    entityType: v.optional(entityTypeValidator),
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
