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

export const featured = query({
  args: {},
  handler: async (ctx) => {
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_featured_and_publishedAt", (q) => q.eq("featured", true))
      .order("desc")
      .take(1);
    return posts[0] ?? null;
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
