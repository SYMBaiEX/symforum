import { v } from "convex/values";
import { query } from "./_generated/server";
import {
  featuredPublishedPostId,
  listPublishedPostDigests,
} from "./postDigests";

export const listPublished = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("posts")
      .withIndex("by_status_and_publishedAt", (q) =>
        q.eq("status", "published"),
      )
      .order("desc")
      .take(50);
  },
});

/**
 * The archive, homepage, and sitemap only render publication metadata. Keep
 * article bodies on the detail/readable paths so those hot list reads don't
 * transfer the same Markdown over and over.
 */
export const listPublishedSummaries = query({
  args: {},
  handler: async (ctx) => await listPublishedPostDigests(ctx, 50),
});

export const featured = query({
  args: {},
  handler: async (ctx) => {
    const postId = await featuredPublishedPostId(ctx);
    return postId === null ? null : await ctx.db.get("posts", postId);
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const post = await ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (post === null || post.status !== "published") {
      return null;
    }
    return post;
  },
});
