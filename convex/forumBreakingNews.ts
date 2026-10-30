import { v } from "convex/values";
import {
  NEWS_MAX_DAILY_ATTEMPTS,
  newsInterval,
  newsPriority,
  newsRank,
} from "../lib/forum-breaking-news";
import {
  ALPHA_DESKS,
  alphaCandidateBoards,
} from "../lib/forum-alpha-editorial";
import { internal } from "./_generated/api";
import { env, internalMutation, internalQuery } from "./_generated/server";
import {
  forumDateForTimestamp,
  publicationPreflight,
  publicationSharedPreflight,
  startBreakingPublication,
} from "./forumAgentWorkflow";

const candidate = v.object({
  sourceKey: v.string(),
  title: v.string(),
  summary: v.string(),
  url: v.string(),
  publishedAt: v.number(),
});

/** One shared admission point. Discovery is free; admitted work uses the existing
 * serialized, budgeted, independently reviewed Forum publication workflow. */
export const admit = internalMutation({
  args: { candidates: v.array(candidate) },
  returns: v.object({ queued: v.boolean(), reason: v.string() }),
  handler: async (ctx, { candidates }) => {
    if (
      env.FORUM_BREAKING_NEWS_ENABLED !== "true" ||
      env.FORUM_ALPHA_EDITORIAL_ENABLED !== "true"
    )
      return { queued: false, reason: "disabled" };
    const now = Date.now();
    const runDate = forumDateForTimestamp(now);
    const today = await ctx.db
      .query("forumAlphaDeskRuns")
      .withIndex("by_runDate", (q) => q.eq("runDate", runDate))
      .take(NEWS_MAX_DAILY_ATTEMPTS);
    if (today.length >= NEWS_MAX_DAILY_ATTEMPTS)
      return { queued: false, reason: "daily-desk-limit" };
    const last = await ctx.db
      .query("forumAlphaDeskRuns")
      .withIndex("by_createdAt")
      .order("desc")
      .first();
    const projects = await ctx.db
      .query("forumAlphaProjects")
      .withIndex("by_updatedAt", (q) =>
        q.gte("updatedAt", now - 30 * 86_400_000),
      )
      .order("desc")
      .take(80);
    const primaryHosts = new Set(projects.map((p) => p.host));
    const ranked = candidates
      .slice(0, 60)
      .flatMap((c) => {
        if (
          !/^\w{16}$/.test(c.sourceKey) ||
          c.title.length > 220 ||
          c.summary.length > 1100 ||
          c.url.length > 2048
        )
          return [];
        let verifiedPrimary = false;
        try {
          verifiedPrimary = primaryHosts.has(
            new URL(c.url).hostname.toLowerCase(),
          );
        } catch {
          /* policy rejects malformed URLs */
        }
        const priority = newsPriority({ ...c, verifiedPrimary }, now);
        return priority ? [{ ...c, priority }] : [];
      })
      .sort(
        (a, b) =>
          newsRank(b.priority) - newsRank(a.priority) ||
          b.publishedAt - a.publishedAt,
      );
    if (!ranked.length) return { queued: false, reason: "no-fresh-news" };
    const shared = await publicationSharedPreflight(ctx, runDate);
    if (!shared.ok) return { queued: false, reason: shared.reason };
    const eligibility = new Map<string, boolean>();
    const available = new Set(
      await ctx.runQuery(internal.forum.selectAvailableForumAgentSourceKeys, {
        sourceKeys: ranked.map((c) => c.sourceKey),
        maxAvailable: 60,
        now,
      }),
    );
    // Daily rotation varies the opener while preserving specialist board fits.
    const slugs = Object.keys(ALPHA_DESKS);
    const rotation = Math.floor(now / 86_400_000) % slugs.length;
    const rotated = [...slugs.slice(rotation), ...slugs.slice(0, rotation)];
    for (const c of ranked) {
      if (
        !available.has(c.sourceKey) ||
        (last && now - last.createdAt < newsInterval(c.priority))
      )
        continue;
      if (
        await ctx.db
          .query("forumAlphaDeskRuns")
          .withIndex("by_sourceKey", (q) => q.eq("sourceKey", c.sourceKey))
          .unique()
      )
        continue;
      const boards = alphaCandidateBoards(c, now);
      const fit = (slug: string) =>
        ALPHA_DESKS[slug].board === boards.at(-1)
          ? 2
          : Number(boards.includes(ALPHA_DESKS[slug].board));
      const preferred = [...rotated].sort((a, b) => fit(b) - fit(a));
      for (const agentSlug of preferred) {
        if (today.some((r) => r.agentSlug === agentSlug)) continue;
        const alphaBoard = boards.includes(ALPHA_DESKS[agentSlug].board)
          ? ALPHA_DESKS[agentSlug].board
          : "crypto";
        const args = {
          agentSlug,
          slot: 1,
          runDate,
          alphaSourceKey: c.sourceKey,
          alphaBoard,
        };
        if (!eligibility.has(agentSlug))
          eligibility.set(
            agentSlug,
            (await publicationPreflight(ctx, args, true)).ok,
          );
        if (!eligibility.get(agentSlug)) continue;
        const workflowId = await startBreakingPublication(ctx, args);
        await ctx.db.insert("forumAlphaDeskRuns", {
          sourceKey: c.sourceKey,
          sourcePublishedAt: c.publishedAt,
          agentSlug,
          runDate,
          workflowId,
          priority: c.priority,
          createdAt: now,
        });
        return { queued: true, reason: "fresh-source-admitted" };
      }
    }
    return { queued: false, reason: "no-eligible-source-or-capacity" };
  },
});

/** Operator diagnostics without credentials or private member content. */
export const inspect = internalQuery({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    recent: v.array(
      v.object({
        agentSlug: v.string(),
        sourcePublishedAt: v.number(),
        createdAt: v.number(),
        priority: v.string(),
        runKey: v.string(),
      }),
    ),
  }),
  handler: async (ctx) => ({
    enabled: env.FORUM_BREAKING_NEWS_ENABLED === "true",
    recent: (
      await ctx.db
        .query("forumAlphaDeskRuns")
        .withIndex("by_createdAt")
        .order("desc")
        .take(12)
    ).map((r) => ({
      agentSlug: r.agentSlug,
      sourcePublishedAt: r.sourcePublishedAt,
      createdAt: r.createdAt,
      priority: r.priority,
      runKey: `${r.agentSlug}:${r.runDate}:1`,
    })),
  }),
});
