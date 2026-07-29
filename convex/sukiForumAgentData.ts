import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const SUKI_AGENT_SLUG = "suki";
const SUKI_RUN_STALE_MS = 30 * 60 * 1_000;
const SUKI_CACHE_CLEANUP_BATCH_SIZE = 100;

export const claimRun = internalMutation({
  args: {
    agentSlug: v.optional(v.union(v.literal("suki"), v.literal("belle"))),
    runDate: v.string(),
    slot: v.number(),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const agentSlug = args.agentSlug ?? SUKI_AGENT_SLUG;
    const maximumSlot = agentSlug === "suki" ? 29 : 15;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(args.runDate) ||
      !Number.isInteger(args.slot) ||
      args.slot < 0 ||
      args.slot > maximumSlot ||
      !Number.isInteger(args.attempt) ||
      args.attempt < 0 ||
      args.attempt > 2
    ) {
      throw new Error(`Invalid ${agentSlug} run coordinates`);
    }
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", agentSlug))
      .unique();
    if (agent === null || !agent.enabled) {
      return {
        claimed: false as const,
        reason: "disabled" as const,
        runKey: `${agentSlug}:${args.runDate}:${args.slot}`,
      };
    }
    const runKey = `${agentSlug}:${args.runDate}:${args.slot}`;
    const existing = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
      .unique();
    if (existing?.status === "published") {
      return { claimed: false as const, reason: "published" as const, runKey };
    }
    const now = Date.now();
    if (
      existing?.status === "running" &&
      now - existing.updatedAt < SUKI_RUN_STALE_MS
    ) {
      return { claimed: false as const, reason: "running" as const, runKey };
    }
    const todayRuns = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_agentSlug_and_runDate_and_slot", (q) =>
        q.eq("agentSlug", agentSlug).eq("runDate", args.runDate),
      )
      .take(40);
    const publishedCount = todayRuns.filter(
      (run) => run.status === "published",
    ).length;
    if (publishedCount >= agent.dailyPostTarget) {
      if (existing === null) {
        await ctx.db.insert("forumAgentRuns", {
          runKey,
          agentSlug,
          runDate: args.runDate,
          slot: args.slot,
          attempt: args.attempt,
          status: "skipped",
          model: agent.model,
          sourceUrls: [],
          errorMessage: "Daily post target already reached.",
          startedAt: now,
          completedAt: now,
          updatedAt: now,
        });
      }
      return {
        claimed: false as const,
        reason: "daily-target" as const,
        runKey,
      };
    }

    if (existing === null) {
      await ctx.db.insert("forumAgentRuns", {
        runKey,
        agentSlug,
        runDate: args.runDate,
        slot: args.slot,
        attempt: args.attempt,
        status: "running",
        model: agent.model,
        sourceUrls: [],
        startedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(existing._id, {
        attempt: args.attempt,
        status: "running",
        model: agent.model,
        sourceUrls: [],
        errorMessage: undefined,
        completedAt: undefined,
        startedAt: now,
        updatedAt: now,
      });
    }
    return { claimed: true as const, runKey, publishedCount };
  },
});

export const markRunFailed = internalMutation({
  args: {
    runKey: v.string(),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (run === null || run.status === "published") {
      return { updated: false };
    }
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "failed",
      errorMessage: args.errorMessage.trim().slice(0, 500),
      completedAt: now,
      updatedAt: now,
    });
    return { updated: true };
  },
});

export const markRunSkipped = internalMutation({
  args: {
    runKey: v.string(),
    reason: v.string(),
    candidateCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (run === null || run.status === "published") {
      return { updated: false };
    }
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "skipped",
      candidateCount: args.candidateCount,
      errorMessage: args.reason.trim().slice(0, 500),
      completedAt: now,
      updatedAt: now,
    });
    return { updated: true };
  },
});

export const readResearchCache = internalQuery({
  args: {
    cacheKey: v.string(),
  },
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("forumAgentResearchCache")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", args.cacheKey))
      .unique();
    if (cached === null || cached.expiresAt <= Date.now()) {
      return null;
    }
    return cached;
  },
});

export const writeResearchCache = internalMutation({
  args: {
    cacheKey: v.string(),
    sourceName: v.string(),
    feedUrl: v.string(),
    payloadJson: v.string(),
    fetchedAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("forumAgentResearchCache")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", args.cacheKey))
      .unique();
    if (existing === null) {
      return await ctx.db.insert("forumAgentResearchCache", args);
    }
    await ctx.db.patch(existing._id, args);
    return existing._id;
  },
});

export const readMediaCache = internalQuery({
  args: {
    sourceKey: v.string(),
  },
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("forumAgentMediaCache")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
      .unique();
    if (cached === null || cached.expiresAt <= Date.now()) {
      return null;
    }
    return cached;
  },
});

export const writeMediaCache = internalMutation({
  args: {
    sourceKey: v.string(),
    sourceUrl: v.string(),
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
    altText: v.optional(v.string()),
    credit: v.optional(v.string()),
    fetchedAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("forumAgentMediaCache")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
      .unique();
    if (existing === null) {
      return await ctx.db.insert("forumAgentMediaCache", args);
    }
    await ctx.db.patch(existing._id, args);
    return existing._id;
  },
});

export const cleanupExpiredResearchCache = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expiredResearch = await ctx.db
      .query("forumAgentResearchCache")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(SUKI_CACHE_CLEANUP_BATCH_SIZE);
    const expiredMedia = await ctx.db
      .query("forumAgentMediaCache")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(SUKI_CACHE_CLEANUP_BATCH_SIZE);
    for (const row of [...expiredResearch, ...expiredMedia]) {
      await ctx.db.delete(row._id);
    }
    return {
      deletedMedia: expiredMedia.length,
      deletedResearch: expiredResearch.length,
    };
  },
});
