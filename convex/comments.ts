import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
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
    parentId: v.optional(v.string()),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    const body = args.body.trim();
    if (body.length < 2 || body.length > 1200) {
      throw new Error("Comment must be between 2 and 1200 characters");
    }
    let parentId: Id<"comments"> | undefined;
    if (args.parentId !== undefined) {
      const normalizedParentId = ctx.db.normalizeId("comments", args.parentId);
      if (normalizedParentId === null) {
        throw new Error("Reply target does not belong to this thread");
      }
      const parent = await ctx.db.get(normalizedParentId);
      if (
        parent === null ||
        parent.entityType !== args.entityType ||
        parent.entityId !== args.entityId
      ) {
        throw new Error("Reply target does not belong to this thread");
      }
      parentId = normalizedParentId;
    }
    const recent = await ctx.db
      .query("comments")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(1);
    if (recent[0] !== undefined && Date.now() - recent[0].createdAt < 10_000) {
      throw new Error("Please wait a few seconds before commenting again");
    }
    await ctx.db.insert("comments", {
      userId,
      entityType: args.entityType,
      entityId: args.entityId,
      ...(parentId !== undefined ? { parentId } : {}),
      body,
      createdAt: Date.now(),
    });
  },
});
