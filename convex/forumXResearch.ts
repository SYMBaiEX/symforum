import { v } from "convex/values";
import { RateLimiter, DAY, HOUR } from "@convex-dev/rate-limiter";
import { X_RESEARCH_DESKS, X_RESEARCH_QUERIES } from "../lib/forum-x-research";
import { components } from "./_generated/api";
import { env, internalMutation, internalQuery } from "./_generated/server";
import { active } from "./xAgentActivityData";
import { installationMatches } from "./installation";

// Six requests of <=10 posts and <=10 expanded public authors: <=$0.90/day
// at the documented 2026-10-31 rates. Also consume the existing X read quota.
const limits = new RateLimiter(components.rateLimiter, {
  forumResearchSearches: { kind: "fixed window", rate: 6, period: DAY },
  forumResearchSpacing: {
    kind: "token bucket",
    rate: 1,
    period: 4 * HOUR,
    capacity: 1,
  },
  xReads: { kind: "fixed window", rate: 360, period: DAY },
});
const lease = { activityId: v.id("xAgentActivity"), lease: v.string() };
const post = v.object({
  id: v.string(),
  authorId: v.string(),
  username: v.string(),
  text: v.string(),
  publishedAt: v.number(),
});

export const claim = internalMutation({
  args: lease,
  returns: v.union(v.null(), v.object({ desk: v.string(), query: v.string() })),
  handler: async (ctx, args) => {
    if (
      env.FORUM_X_RESEARCH_ENABLED !== "true" ||
      env.FORUM_ALPHA_EDITORIAL_ENABLED !== "true"
    )
      return null;
    const c = await active(ctx, args.activityId, args.lease);
    if (!c || c.account.agentSlug !== "nyx" || !installationMatches(c.activity))
      return null;
    const state = await ctx.db
      .query("forumXResearch")
      .withIndex("by_key", (q) => q.eq("key", "state"))
      .unique();
    if (state && state.nextAt > Date.now()) return null;
    for (const name of [
      "forumResearchSearches",
      "forumResearchSpacing",
      "xReads",
    ] as const) {
      const key = name === "xReads" ? args.activityId : "shared";
      if (!(await limits.check(ctx, name, { key })).ok) return null;
    }
    for (const name of [
      "forumResearchSearches",
      "forumResearchSpacing",
      "xReads",
    ] as const)
      await limits.limit(ctx, name, {
        key: name === "xReads" ? args.activityId : "shared",
        throws: true,
      });
    const ordinal = state?.ordinal ?? 0;
    const desk = X_RESEARCH_DESKS[ordinal % X_RESEARCH_DESKS.length];
    const row = {
      key: "state",
      ordinal: ordinal + 1,
      lease: args.lease,
      status: "reading" as const,
      nextAt: Date.now() + 4 * HOUR,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + 4 * HOUR,
      posts: [],
    };
    if (state) await ctx.db.patch("forumXResearch", state._id, row);
    else await ctx.db.insert("forumXResearch", row);
    return { desk, query: X_RESEARCH_QUERIES[desk] };
  },
});

export const finish = internalMutation({
  args: {
    ...lease,
    desk: v.string(),
    posts: v.array(post),
    ok: v.boolean(),
    retryAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const c = await active(ctx, args.activityId, args.lease);
    const state = await ctx.db
      .query("forumXResearch")
      .withIndex("by_key", (q) => q.eq("key", "state"))
      .unique();
    if (
      !c ||
      c.account.agentSlug !== "nyx" ||
      state?.lease !== args.lease ||
      !X_RESEARCH_DESKS.some((d) => d === args.desk) ||
      args.posts.length > 10
    )
      return null;
    if (
      args.posts.some(
        (p) =>
          p.text.length > 4000 ||
          !/^\d{8,20}$/.test(p.id) ||
          !/^[A-Za-z0-9_]{1,15}$/.test(p.username) ||
          p.publishedAt > Date.now() + 5 * 60_000 ||
          !Number.isFinite(p.publishedAt) ||
          Date.now() - p.publishedAt > DAY,
      )
    )
      throw Error("Invalid public X research evidence");
    await ctx.db.patch("forumXResearch", state._id, {
      lease: undefined,
      status: args.ok ? "ready" : "unavailable",
      nextAt: Math.max(
        state.nextAt,
        Number.isFinite(args.retryAt) ? args.retryAt! : 0,
      ),
    });
    if (!args.ok) return null;
    const old = await ctx.db
      .query("forumXResearch")
      .withIndex("by_key", (q) => q.eq("key", args.desk))
      .unique();
    const row = {
      key: args.desk,
      nextAt: state.nextAt,
      status: "ready" as const,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + 6 * HOUR,
      posts: args.posts,
    };
    if (old) await ctx.db.patch("forumXResearch", old._id, row);
    else await ctx.db.insert("forumXResearch", row);
    return null;
  },
});

export const read = internalQuery({
  args: {},
  returns: v.array(post),
  handler: async (ctx) => {
    if (env.FORUM_X_RESEARCH_ENABLED !== "true") return [];
    const rows = await Promise.all(
      X_RESEARCH_DESKS.map((key) =>
        ctx.db
          .query("forumXResearch")
          .withIndex("by_key", (q) => q.eq("key", key))
          .unique(),
      ),
    );
    return rows.flatMap((r) => (r && r.expiresAt > Date.now() ? r.posts : []));
  },
});
