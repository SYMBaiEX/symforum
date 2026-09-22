import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  deleteUniversalSearchProjection,
  syncPostUniversalSearchProjection,
} from "./universalSearchProjection";

const MIGRATION_KEY = "post-digests-v1";
const backfillPostDigestsRef = makeFunctionReference<
  "mutation",
  { cursor?: string; limit?: number },
  { processed: number; cursor: string | null; done: boolean }
>("postDigests:backfillPostDigests");

function digestValues(post: Doc<"posts">) {
  return {
    postId: post._id,
    postCreatedAt: post._creationTime,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    tags: post.tags,
    status: post.status,
    publishedAt: post.publishedAt,
    readingMinutes: post.readingMinutes,
    featured: post.featured,
    imageUrl: post.imageUrl,
    imageAlt: post.imageAlt,
    imageCredit: post.imageCredit,
  };
}

function publicDigest(digest: Doc<"postDigests">) {
  return {
    _id: digest.postId,
    _creationTime: digest.postCreatedAt,
    slug: digest.slug,
    title: digest.title,
    excerpt: digest.excerpt,
    tags: digest.tags,
    status: digest.status,
    publishedAt: digest.publishedAt,
    readingMinutes: digest.readingMinutes,
    featured: digest.featured,
    imageUrl: digest.imageUrl,
    imageAlt: digest.imageAlt,
    imageCredit: digest.imageCredit,
  };
}

export async function upsertPostDigest(ctx: MutationCtx, post: Doc<"posts">) {
  const values = digestValues(post);
  const existing = await ctx.db
    .query("postDigests")
    .withIndex("by_postId", (q) => q.eq("postId", post._id))
    .unique();
  if (existing === null) {
    await ctx.db.insert("postDigests", values);
    await syncPostUniversalSearchProjection(ctx, post);
    return;
  }
  if (
    existing.postId === values.postId &&
    existing.postCreatedAt === values.postCreatedAt &&
    existing.slug === values.slug &&
    existing.title === values.title &&
    existing.excerpt === values.excerpt &&
    existing.status === values.status &&
    existing.publishedAt === values.publishedAt &&
    existing.readingMinutes === values.readingMinutes &&
    existing.featured === values.featured &&
    existing.imageUrl === values.imageUrl &&
    existing.imageAlt === values.imageAlt &&
    existing.imageCredit === values.imageCredit &&
    existing.tags.length === values.tags.length &&
    existing.tags.every((tag, index) => tag === values.tags[index])
  ) {
    // Also repairs a missing universal row after an interrupted backfill.
    await syncPostUniversalSearchProjection(ctx, post);
    return;
  }
  await ctx.db.patch("postDigests", existing._id, values);
  await syncPostUniversalSearchProjection(ctx, post);
}

export async function deletePostDigest(ctx: MutationCtx, postId: Id<"posts">) {
  const existing = await ctx.db
    .query("postDigests")
    .withIndex("by_postId", (q) => q.eq("postId", postId))
    .unique();
  if (existing !== null) await ctx.db.delete("postDigests", existing._id);
  await deleteUniversalSearchProjection(ctx, "blog_post", postId);
}

async function migrationComplete(ctx: QueryCtx) {
  const state = await ctx.db
    .query("optimizationMigrations")
    .withIndex("by_key", (q) => q.eq("key", MIGRATION_KEY))
    .unique();
  return state?.status === "completed";
}

export async function listPublishedPostDigests(ctx: QueryCtx, limit: number) {
  if (await migrationComplete(ctx)) {
    const digests = await ctx.db
      .query("postDigests")
      .withIndex("by_status_and_publishedAt", (q) =>
        q.eq("status", "published"),
      )
      .order("desc")
      .take(limit);
    return digests.map(publicDigest);
  }

  // Rolling-deploy fallback. This is removed from the hot path as soon as the
  // resumable projection migration marks itself complete.
  const posts = await ctx.db
    .query("posts")
    .withIndex("by_status_and_publishedAt", (q) => q.eq("status", "published"))
    .order("desc")
    .take(limit);
  return posts.map(({ body: _body, ...post }) => post);
}

export async function featuredPublishedPostId(ctx: QueryCtx) {
  if (await migrationComplete(ctx)) {
    const digests = await ctx.db
      .query("postDigests")
      .withIndex("by_status_and_publishedAt", (q) =>
        q.eq("status", "published"),
      )
      .order("desc")
      .take(50);
    return digests.find((digest) => digest.featured)?.postId ?? null;
  }
  const posts = await ctx.db
    .query("posts")
    .withIndex("by_status_and_publishedAt", (q) => q.eq("status", "published"))
    .order("desc")
    .take(50);
  return posts.find((post) => post.featured)?._id ?? null;
}

export const backfillPostDigests = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("optimizationMigrations")
      .withIndex("by_key", (q) => q.eq("key", MIGRATION_KEY))
      .unique();
    if (state?.status === "completed") {
      return { processed: 0, cursor: null, done: true };
    }

    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 200));
    // Persisted progress wins over a stale scheduled/operator cursor so a
    // duplicate continuation cannot rewind and reread completed pages.
    const cursor = state?.cursor ?? args.cursor ?? null;
    const page = await ctx.db.query("posts").paginate({
      cursor,
      numItems: limit,
      maximumRowsRead: limit + 1,
      // A single crossing row is included, so a legal near-1 MiB article still
      // advances the cursor. Leave ample transaction headroom for digest writes.
      maximumBytesRead: 512 * 1024,
    });
    for (const post of page.page) await upsertPostDigest(ctx, post);

    const now = Date.now();
    const processed = (state?.processed ?? 0) + page.page.length;
    const nextCursor = page.isDone ? undefined : page.continueCursor;
    const fields = {
      key: MIGRATION_KEY,
      status: page.isDone ? ("completed" as const) : ("running" as const),
      processed,
      cursor: nextCursor,
      updatedAt: now,
      ...(page.isDone ? { completedAt: now } : {}),
    };
    if (state === null) {
      await ctx.db.insert("optimizationMigrations", fields);
    } else {
      await ctx.db.patch("optimizationMigrations", state._id, fields);
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, backfillPostDigestsRef, {
        cursor: page.continueCursor,
        limit,
      });
    }
    return {
      processed: page.page.length,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});
