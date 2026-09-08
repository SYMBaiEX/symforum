import { v } from "convex/values";
import { query } from "./_generated/server";

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
  handler: async (ctx) => {
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_status_and_publishedAt", (q) =>
        q.eq("status", "published"),
      )
      .order("desc")
      .take(50);
    return posts.map(({ body: _body, ...post }) => post);
  },
});

export const featured = query({
  args: {},
  handler: async (ctx) => {
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_status_and_publishedAt", (q) =>
        q.eq("status", "published"),
      )
      .order("desc")
      .take(50);
    return posts.find((post) => post.featured) ?? null;
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
