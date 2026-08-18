import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";

/**
 * A deliberately small search representation.  These limits are in characters
 * after whitespace normalization, not bytes.  They bound both Convex index
 * storage and the documents returned while a search scans candidates.
 */
export const FORUM_SEARCH_TEXT_MAX_LENGTH = 4_096;
export const FORUM_SEARCH_EXCERPT_MAX_LENGTH = 220;
const BACKFILL_KEY = "forum-search-projections-v1";
const BACKFILL_POST_PAGE_SIZE = 100;

type BackfillCursor = {
  threadCursor: string | null;
  threadId: string | null;
  postCursor: string | null;
};

function parseBackfillCursor(value: string | undefined): BackfillCursor {
  if (value === undefined) {
    return { threadCursor: null, threadId: null, postCursor: null };
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "threadCursor" in parsed &&
      "threadId" in parsed &&
      "postCursor" in parsed &&
      (parsed.threadCursor === null || typeof parsed.threadCursor === "string") &&
      (parsed.threadId === null || typeof parsed.threadId === "string") &&
      (parsed.postCursor === null || typeof parsed.postCursor === "string")
    ) {
      return parsed as BackfillCursor;
    }
  } catch {
    // The first released version stored a raw thread cursor. Preserve it as a
    // resumable starting point rather than restarting the migration.
  }
  return { threadCursor: value, threadId: null, postCursor: null };
}

function serializeBackfillCursor(cursor: BackfillCursor) {
  return JSON.stringify(cursor);
}

function normalized(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function preview(value: string) {
  const clean = normalized(value, FORUM_SEARCH_EXCERPT_MAX_LENGTH + 1);
  return clean.length <= FORUM_SEARCH_EXCERPT_MAX_LENGTH
    ? clean
    : `${clean.slice(0, FORUM_SEARCH_EXCERPT_MAX_LENGTH - 1)}…`;
}

function threadValues(thread: Doc<"forumThreads">) {
  return {
    threadId: thread._id,
    categoryId: thread.categoryId,
    categorySlug: thread.categorySlug,
    prefixId: thread.prefixId,
    prefixSlug: thread.prefixSlug,
    prefixLabel: thread.prefixLabel,
    prefixColor: thread.prefixColor,
    slug: thread.slug,
    title: normalized(thread.title, 500),
    authorId: thread.authorId,
    lastPostUserId: thread.lastPostUserId,
    status: thread.status,
    pinned: thread.pinned,
    replyCount: thread.replyCount,
    viewCount: thread.viewCount,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastPostAt: thread.lastPostAt,
    searchText: normalized(thread.searchText, FORUM_SEARCH_TEXT_MAX_LENGTH),
    excerpt: preview(thread.body),
  };
}

function postValues(post: Doc<"forumPosts">) {
  return {
    postId: post._id,
    threadId: post.threadId,
    categoryId: post.categoryId,
    authorId: post.authorId,
    postNumber: post.postNumber,
    status: post.status,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    searchText: normalized(post.body, FORUM_SEARCH_TEXT_MAX_LENGTH),
    excerpt: preview(post.body),
  };
}

export async function syncForumThreadSearchProjection(
  ctx: MutationCtx,
  threadId: Id<"forumThreads">,
) {
  const thread = await ctx.db.get("forumThreads", threadId);
  if (thread === null) return;
  const values = threadValues(thread);
  const existing = await ctx.db
    .query("forumThreadSearchProjections")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
  if (existing === null) {
    await ctx.db.insert("forumThreadSearchProjections", values);
    return;
  }
  await ctx.db.patch("forumThreadSearchProjections", existing._id, values);
}

export async function syncForumPostSearchProjection(
  ctx: MutationCtx,
  postId: Id<"forumPosts">,
) {
  const post = await ctx.db.get("forumPosts", postId);
  if (post === null) return;
  const values = postValues(post);
  const existing = await ctx.db
    .query("forumPostSearchProjections")
    .withIndex("by_postId", (q) => q.eq("postId", postId))
    .unique();
  if (existing === null) {
    await ctx.db.insert("forumPostSearchProjections", values);
    return;
  }
  await ctx.db.patch("forumPostSearchProjections", existing._id, values);
}

/** Resumable idempotent dual-table migration. Calling this after completion is a no-op. */
export const backfill = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("forumAgentMaintenanceState")
      .withIndex("by_key", (q) => q.eq("key", BACKFILL_KEY))
      .unique();
    if ((state?.completedAt ?? 0) > 0) {
      return { processed: 0, done: true, alreadyCompleted: true };
    }
    const now = Date.now();
    const cursor = parseBackfillCursor(args.cursor ?? state?.cursor);
    const saveProgress = async (nextCursor: BackfillCursor) => {
      const values = {
        cursor: serializeBackfillCursor(nextCursor),
        completedAt: 0,
        updatedAt: now,
      };
      if (state === null) {
        await ctx.db.insert("forumAgentMaintenanceState", {
          key: BACKFILL_KEY,
          ...values,
        });
      } else {
        await ctx.db.patch("forumAgentMaintenanceState", state._id, values);
      }
    };

    if (cursor.threadId !== null) {
      const thread = await ctx.db.get(
        "forumThreads",
        cursor.threadId as Id<"forumThreads">,
      );
      if (thread !== null) await syncForumThreadSearchProjection(ctx, thread._id);
      const posts =
        thread === null
          ? { page: [], isDone: true, continueCursor: null }
          : await ctx.db
              .query("forumPosts")
              .withIndex("by_threadId_and_createdAt", (q) =>
                q.eq("threadId", thread._id),
              )
              .paginate({
                cursor: cursor.postCursor,
                numItems: BACKFILL_POST_PAGE_SIZE,
              });
      for (const post of posts.page) await syncForumPostSearchProjection(ctx, post._id);
      await saveProgress(
        posts.isDone
          ? { threadCursor: cursor.threadCursor, threadId: null, postCursor: null }
          : {
              threadCursor: cursor.threadCursor,
              threadId: cursor.threadId,
              postCursor: posts.continueCursor,
            },
      );
      return { processed: posts.page.length, done: false, alreadyCompleted: false };
    }

    const threads = await ctx.db
      .query("forumThreads")
      .order("asc")
      .paginate({ cursor: cursor.threadCursor, numItems: 1 });
    const thread = threads.page[0];
    if (thread === undefined) {
      if (state === null) {
        await ctx.db.insert("forumAgentMaintenanceState", { key: BACKFILL_KEY, completedAt: now, updatedAt: now });
      } else {
        await ctx.db.patch("forumAgentMaintenanceState", state._id, { completedAt: now, updatedAt: now });
      }
      return { processed: 0, done: true, alreadyCompleted: false };
    }
    await syncForumThreadSearchProjection(ctx, thread._id);
    await saveProgress(
      {
        threadCursor: threads.continueCursor,
        threadId: thread._id,
        postCursor: null,
      },
    );
    return { processed: 1, done: false, alreadyCompleted: false };
  },
});
