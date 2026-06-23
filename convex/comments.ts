import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
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
      .take(100);

    return await Promise.all(
      rows.map(async (comment) => {
        const user = await ctx.db.get(comment.userId);
        return {
          ...comment,
          author: user?.username ?? user?.name ?? "SYM-UNKNOWN",
        };
      }),
    );
  },
});

export const add = mutation({
  args: {
    entityType,
    entityId: v.string(),
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
    await ctx.db.insert("comments", {
      userId,
      entityType: args.entityType,
      entityId: args.entityId,
      body,
      createdAt: Date.now(),
    });
  },
});
