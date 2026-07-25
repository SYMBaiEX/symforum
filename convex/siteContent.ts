import { v } from "convex/values";
import { query } from "./_generated/server";

export const getPage = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("sitePages")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (page === null || page.status !== "published") {
      return null;
    }
    return page;
  },
});

export const listPortfolioProjects = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("portfolioProjects")
      .withIndex("by_status_and_order", (q) => q.eq("status", "published"))
      .order("asc")
      .take(50);
  },
});
