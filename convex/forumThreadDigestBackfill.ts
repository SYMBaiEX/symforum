import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { FORUM_THREAD_EDITORIAL_DIGEST_BACKFILL_KEY } from "./forumSearchProjectionConstants";

function digestValues(thread: Doc<"forumThreads">) {
  return {
    threadId: thread._id,
    threadCreatedAt: thread._creationTime,
    categoryId: thread.categoryId,
    categorySlug: thread.categorySlug,
    prefixId: thread.prefixId,
    prefixSlug: thread.prefixSlug,
    prefixLabel: thread.prefixLabel,
    prefixColor: thread.prefixColor,
    slug: thread.slug,
    title: thread.title,
    authorId: thread.authorId,
    status: thread.status,
    pinned: thread.pinned,
    replyCount: thread.replyCount,
    ratingCount: thread.ratingCount,
    ratingTotal: thread.ratingTotal,
    lastAssignedPostNumber: thread.lastAssignedPostNumber,
    viewCount: thread.viewCount,
    lastPostId: thread.lastPostId,
    lastPostAt: thread.lastPostAt,
    lastPostUserId: thread.lastPostUserId,
    moderationActivityAt: thread.moderationActivityAt,
    moderationRootActivityAt: thread.moderationRootActivityAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

async function upsertDigest(ctx: MutationCtx, thread: Doc<"forumThreads">) {
  const values = digestValues(thread);
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
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ processed: number; done: boolean }> => {
    let completionState: Doc<"forumAgentMaintenanceState"> | null | undefined;
    if (args.cursor === undefined) {
      completionState = await ctx.db
        .query("forumAgentMaintenanceState")
        .withIndex("by_key", (q) =>
          q.eq("key", FORUM_THREAD_EDITORIAL_DIGEST_BACKFILL_KEY),
        )
        .unique();
      if (completionState !== null && completionState.completedAt > 0)
        return { processed: 0, done: true };
    }

    const page = await ctx.db
      .query("forumThreads")
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: 80 });
    for (const thread of page.page) await upsertDigest(ctx, thread);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.forumThreadDigestBackfill.run, {
        cursor: page.continueCursor,
      });
      return { processed: page.page.length, done: false };
    }
    const existing =
      completionState !== undefined
        ? completionState
        : await ctx.db
            .query("forumAgentMaintenanceState")
            .withIndex("by_key", (q) =>
              q.eq("key", FORUM_THREAD_EDITORIAL_DIGEST_BACKFILL_KEY),
            )
            .unique();
    const now = Date.now();
    if (existing === null) {
      await ctx.db.insert("forumAgentMaintenanceState", {
        key: FORUM_THREAD_EDITORIAL_DIGEST_BACKFILL_KEY,
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
  args: {},
  returns: v.object({
    complete: v.boolean(),
    completedAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx) => {
    const state = await ctx.db
      .query("forumAgentMaintenanceState")
      .withIndex("by_key", (q) =>
        q.eq("key", FORUM_THREAD_EDITORIAL_DIGEST_BACKFILL_KEY),
      )
      .unique();
    const completedAt = state?.completedAt ?? null;
    return {
      complete: completedAt !== null && completedAt > 0,
      completedAt,
    };
  },
});
