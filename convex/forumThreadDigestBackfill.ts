import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";

const BACKFILL_KEY = "forum-thread-digests-v1";

function digestValues(thread: Doc<"forumThreads">) {
  return {
    threadId: thread._id,
    categoryId: thread.categoryId,
    categorySlug: thread.categorySlug,
    slug: thread.slug,
    title: thread.title,
    authorId: thread.authorId,
    status: thread.status,
    replyCount: thread.replyCount,
    viewCount: thread.viewCount,
    lastPostAt: thread.lastPostAt,
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
    await ctx.db.patch(existing._id, values);
  }
}

export const run = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ processed: number; done: boolean }> => {
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
    const existing = await ctx.db
      .query("forumAgentMaintenanceState")
      .withIndex("by_key", (q) => q.eq("key", BACKFILL_KEY))
      .unique();
    const now = Date.now();
    if (existing === null) {
      await ctx.db.insert("forumAgentMaintenanceState", {
        key: BACKFILL_KEY,
        completedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(existing._id, { completedAt: now, updatedAt: now });
    }
    return { processed: page.page.length, done: true };
  },
});
