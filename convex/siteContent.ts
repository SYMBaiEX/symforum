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

export const listHiddenPortfolioSlugs = query({
  args: {},
  handler: async (ctx) => {
    const draft = await ctx.db
      .query("portfolioProjects")
      .withIndex("by_status_and_order", (q) => q.eq("status", "draft"))
      .take(50);
    const archived = await ctx.db
      .query("portfolioProjects")
      .withIndex("by_status_and_order", (q) => q.eq("status", "archived"))
      .take(50);
    return [...draft, ...archived].map((project) => project.slug);
  },
});
