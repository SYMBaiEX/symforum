import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

const entityType = v.union(v.literal("post"), v.literal("hnStory"));

export const list = query({
  args: {
    entityType,
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("comments")
      .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
        q.eq("entityType", args.entityType).eq("entityId", args.entityId),
      )
      .order("asc")
      .take(200);
    const usersById = new Map(
      await Promise.all(
        [...new Set(rows.map((comment) => comment.userId))].map(
          async (userId) => [userId, await ctx.db.get(userId)] as const,
        ),
      ),
    );

    return rows.map((comment) => {
      const user = usersById.get(comment.userId);
      return {
        ...comment,
        author: user?.username ?? user?.name ?? "SYM-UNKNOWN",
      };
    });
  },
});

export const add = mutation({
  args: {
    entityType,
    entityId: v.string(),
    parentId: v.optional(v.id("comments")),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError({
        code: "AUTH_REQUIRED",
        message: "Sign in with a SYM handle to join the thread.",
      });
    }
    const body = args.body.trim();
    if (body.length < 2 || body.length > 1200) {
      throw new ConvexError({
        code: "INVALID_COMMENT",
        message: "Comment must be between 2 and 1200 characters.",
      });
    }
    let parentId: Id<"comments"> | undefined;
    if (args.parentId !== undefined) {
      const parent = await ctx.db.get(args.parentId);
      if (
        parent === null ||
        parent.entityType !== args.entityType ||
        parent.entityId !== args.entityId
      ) {
        throw new ConvexError({
          code: "INVALID_REPLY_TARGET",
          message: "That reply target is no longer part of this thread.",
        });
      }
      parentId = args.parentId;
    }
    const recent = await ctx.db
      .query("comments")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(5);
    const now = Date.now();
    const lastComment = recent[0];
    if (lastComment !== undefined && now - lastComment.createdAt < 2_500) {
      throw new ConvexError({
        code: "COMMENT_RATE_LIMITED",
        message: "Give the thread a breath, then try again.",
      });
    }
    const duplicate = recent.find(
      (comment) =>
        comment.entityType === args.entityType &&
        comment.entityId === args.entityId &&
        comment.body.trim() === body &&
        now - comment.createdAt < 15_000,
    );
    if (duplicate !== undefined) {
      throw new ConvexError({
        code: "DUPLICATE_COMMENT",
        message: "That comment already landed.",
      });
    }
    await ctx.db.insert("comments", {
      userId,
      entityType: args.entityType,
      entityId: args.entityId,
      ...(parentId !== undefined ? { parentId } : {}),
      body,
      createdAt: now,
    });
  },
});
