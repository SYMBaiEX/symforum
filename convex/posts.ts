import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("posts").take(1);
    if (existing.length > 0) {
      return { inserted: 0 };
    }

    const now = Date.now();
    const posts = [
      {
        slug: "grid-systems-for-agentic-interfaces",
        title: "Grid systems for agentic interfaces",
        excerpt:
          "A short note on making AI products feel precise, authored, and less like a pile of floating panels.",
        body: "The grid is not decoration. It is a promise that a product has made choices before asking the user to make theirs.\n\nFor agentic interfaces, that matters. Tool output, memory, source trails, and user intent all compete for attention. A disciplined grid turns that competition into hierarchy.",
        tags: ["design", "ai", "systems"],
        status: "published" as const,
        publishedAt: now - 1000 * 60 * 60 * 24 * 8,
        readingMinutes: 4,
        featured: true,
      },
      {
        slug: "why-terminal-aesthetics-still-work",
        title: "Why terminal aesthetics still work",
        excerpt:
          "Text-mode interfaces keep showing up because they compress status, mood, and control into one honest surface.",
        body: "ASCII art works when it behaves like an instrument panel, not wallpaper. It should mark the system's pulse and then get out of the way.",
        tags: ["frontend", "ascii", "craft"],
        status: "published" as const,
        publishedAt: now - 1000 * 60 * 60 * 24 * 21,
        readingMinutes: 3,
        featured: false,
      },
      {
        slug: "personal-sites-as-operating-systems",
        title: "Personal sites as operating systems",
        excerpt:
          "A personal blog can be more than an archive. It can be a small control room for taste, links, research, and public memory.",
        body: "The best personal sites feel alive without becoming social feeds. They are quiet systems: curated, indexed, and unmistakably owned.",
        tags: ["personal", "web", "ops"],
        status: "published" as const,
        publishedAt: now - 1000 * 60 * 60 * 24 * 37,
        readingMinutes: 5,
        featured: false,
      },
    ];

    for (const post of posts) {
      await ctx.db.insert("posts", post);
    }
    return { inserted: posts.length };
  },
});
