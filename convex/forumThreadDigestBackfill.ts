import {
  forumThreadEditorialDigestValues,
  FORUM_FEED_DIGEST_BACKFILL_KEY,
} from "./forumThreadDigest";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { FORUM_THREAD_EDITORIAL_DIGEST_BACKFILL_KEY } from "./forumSearchProjectionConstants";

async function upsertDigest(ctx: MutationCtx, thread: Doc<"forumThreads">) {
  const values = forumThreadEditorialDigestValues(thread);
  const existing = await ctx.db
    .query("forumThreadEditorialDigests")
    .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
    .unique();
  if (existing === null) {
    await ctx.db.insert("forumThreadEditorialDigests", values);
  } else {
    await ctx.db.patch("forumThreadEditorialDigests", existing._id, values);
  }
}

export const run = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    feed: v.optional(v.boolean()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ processed: number; done: boolean }> => {
    const key = args.feed
      ? FORUM_FEED_DIGEST_BACKFILL_KEY
      : FORUM_THREAD_EDITORIAL_DIGEST_BACKFILL_KEY;
    let completionState: Doc<"forumAgentMaintenanceState"> | null | undefined;
    if (args.cursor === undefined) {
      completionState = await ctx.db
        .query("forumAgentMaintenanceState")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (completionState !== null && completionState.completedAt > 0)
        return { processed: 0, done: true };
    }

    const page = await ctx.db
      .query("forumThreads")
      .order("desc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: 80,
        maximumBytesRead: 256_000,
      });
    if (args.dryRun) return { processed: page.page.length, done: page.isDone };
    for (const thread of page.page) await upsertDigest(ctx, thread);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.forumThreadDigestBackfill.run, {
        cursor: page.continueCursor,
        feed: args.feed,
      });
      return { processed: page.page.length, done: false };
    }
    const existing =
      completionState !== undefined
        ? completionState
        : await ctx.db
            .query("forumAgentMaintenanceState")
            .withIndex("by_key", (q) => q.eq("key", key))
            .unique();
    const now = Date.now();
    if (existing === null) {
      await ctx.db.insert("forumAgentMaintenanceState", {
        key,
        completedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch("forumAgentMaintenanceState", existing._id, {
        completedAt: now,
        updatedAt: now,
      });
    }
    return { processed: page.page.length, done: true };
  },
});

/** Read-only operator check for the background digest backfill. */
export const status = internalQuery({
  args: { feed: v.optional(v.boolean()) },
  returns: v.object({
    complete: v.boolean(),
    completedAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const key = args.feed
      ? FORUM_FEED_DIGEST_BACKFILL_KEY
      : FORUM_THREAD_EDITORIAL_DIGEST_BACKFILL_KEY;
    const state = await ctx.db
      .query("forumAgentMaintenanceState")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const completedAt = state?.completedAt ?? null;
    return {
      complete: completedAt !== null && completedAt > 0,
      completedAt,
    };
  },
});
