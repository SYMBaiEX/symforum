import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { normalizePostInput, postInputValidator } from "./postModel";

const entityTypeValidator = v.union(v.literal("post"), v.literal("hnStory"));

async function authorize(ctx: MutationCtx, tokenHash: string) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) {
    throwUnauthorized();
  }

  const key = await ctx.db
    .query("apiKeys")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();

  if (key === null || key.revokedAt !== undefined) {
    throwUnauthorized();
  }

  await ctx.db.patch(key._id, { lastUsedAt: Date.now() });
  return key;
}

function throwUnauthorized(): never {
  throw new ConvexError({ code: "UNAUTHORIZED" });
}

async function authorName(ctx: MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return user?.username ?? user?.name ?? "SYM-UNKNOWN";
}

export const listPosts = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    return await ctx.db
      .query("posts")
      .withIndex("by_publishedAt")
      .order("desc")
      .take(100);
  },
});

export const getPost = mutation({
  args: { tokenHash: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    return await ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
  },
});

export const upsertPost = mutation({
  args: { tokenHash: v.string(), post: postInputValidator },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
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
  args: { tokenHash: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
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

export const listComments = mutation({
  args: {
    tokenHash: v.string(),
    entityType: v.optional(entityTypeValidator),
    entityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
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
  args: { tokenHash: v.string(), commentId: v.id("comments") },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    await ctx.db.delete(args.commentId);
    return { deleted: true };
  },
});

export const listInteractions = mutation({
  args: {
    tokenHash: v.string(),
    entityType: v.optional(entityTypeValidator),
    entityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
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
  args: { tokenHash: v.string(), interactionId: v.id("interactions") },
  handler: async (ctx, args) => {
    await authorize(ctx, args.tokenHash);
    await ctx.db.delete(args.interactionId);
    return { deleted: true };
  },
});
