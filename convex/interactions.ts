import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const entityType = v.union(v.literal("post"), v.literal("hnStory"));

export const summary = query({
  args: {
    entityType,
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("interactions")
      .withIndex("by_entityType_and_entityId", (q) =>
        q.eq("entityType", args.entityType).eq("entityId", args.entityId),
      )
      .take(1000);
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
        q.eq("entityType", args.entityType).eq("entityId", args.entityId),
      )
      .take(1000);
    const viewerId = await getAuthUserId(ctx);
    const viewer = rows.find((row) => row.userId === viewerId) ?? null;
    return {
      comments: comments.length,
      score: rows.reduce((total, row) => total + row.vote, 0),
      saves: rows.filter((row) => row.saved).length,
      viewer,
    };
  },
});

export const summaries = query({
  args: {
    entityType,
    entityIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await getAuthUserId(ctx);
    const entityIds = [...new Set(args.entityIds)].slice(0, 50);
    const summariesByEntityId: Record<
      string,
      {
        comments: number;
        score: number;
        saves: number;
        viewer: { vote: number; saved: boolean } | null;
      }
    > = {};

    for (const entityId of entityIds) {
      const rows = await ctx.db
        .query("interactions")
        .withIndex("by_entityType_and_entityId", (q) =>
          q.eq("entityType", args.entityType).eq("entityId", entityId),
        )
        .take(1000);
      const comments = await ctx.db
        .query("comments")
        .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
          q.eq("entityType", args.entityType).eq("entityId", entityId),
        )
        .take(1000);
      const viewer = rows.find((row) => row.userId === viewerId) ?? null;
      summariesByEntityId[entityId] = {
        comments: comments.length,
        score: rows.reduce((total, row) => total + row.vote, 0),
        saves: rows.filter((row) => row.saved).length,
        viewer,
      };
    }

    return summariesByEntityId;
  },
});

export const set = mutation({
  args: {
    entityType,
    entityId: v.string(),
    vote: v.union(v.literal(-1), v.literal(0), v.literal(1)),
    saved: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    const existing = await ctx.db
      .query("interactions")
      .withIndex("by_userId_and_entityType_and_entityId", (q) =>
        q
          .eq("userId", userId)
          .eq("entityType", args.entityType)
          .eq("entityId", args.entityId),
      )
      .unique();

    const fields = {
      userId,
      entityType: args.entityType,
      entityId: args.entityId,
      vote: args.vote,
      saved: args.saved,
      updatedAt: Date.now(),
    };

    if (existing === null) {
      await ctx.db.insert("interactions", fields);
    } else {
      await ctx.db.patch(existing._id, fields);
    }
  },
});
