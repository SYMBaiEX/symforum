import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const SUKI_AGENT_SLUG = "suki";
const SUKI_RUN_STALE_MS = 30 * 60 * 1_000;
const SUKI_CACHE_CLEANUP_BATCH_SIZE = 100;
const FORUM_AGENT_RESERVATION_TTL_MS = 20 * 60 * 1_000;
const FORUM_AGENT_SOURCE_REUSE_COOLDOWN_MS = 72 * 60 * 60 * 1_000;

export const reserveResearchTopic = internalMutation({
  args: {
    agentSlug: v.string(),
    runKey: v.string(),
    sourceKeys: v.array(v.string()),
    topicFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (
      run === null ||
      run.status !== "running" ||
      run.agentSlug !== args.agentSlug
    ) {
      throw new Error("Forum agent run is not active");
    }
    const now = Date.now();
    const sourceKeys = [...new Set(args.sourceKeys)].slice(0, 3);
    if (sourceKeys.length === 0 || !args.topicFingerprint.trim()) {
      throw new Error("A research reservation needs sources and a topic");
    }

    for (const sourceKey of sourceKeys) {
      const used = await ctx.db
        .query("forumAgentSourceUses")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
        .unique();
      if (
        used !== null &&
        used.usedAt >= now - FORUM_AGENT_SOURCE_REUSE_COOLDOWN_MS
      ) {
        return {
          reserved: false as const,
          reason: "source-covered" as const,
          existingAgentSlug: used.agentSlug,
          existingThreadId: used.threadId,
        };
      }
      const existing = await ctx.db
        .query("forumAgentSourceReservations")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
        .unique();
      if (
        existing !== null &&
        existing.runKey !== args.runKey &&
        (existing.status === "published" || existing.status === "reserved") &&
        existing.expiresAt > now
      ) {
        return {
          reserved: false as const,
          reason: "source-reserved" as const,
          existingAgentSlug: existing.agentSlug,
          existingThreadId: existing.threadId,
        };
      }
    }

    const topic = await ctx.db
      .query("forumAgentTopicReservations")
      .withIndex("by_topicFingerprint", (q) =>
        q.eq("topicFingerprint", args.topicFingerprint),
      )
      .unique();
    const followUpTopic =
      topic !== null &&
      topic.runKey !== args.runKey &&
      topic.status === "published" &&
      topic.expiresAt > now &&
      topic.agentSlug === args.agentSlug &&
      topic.threadId !== undefined;
    if (
      topic !== null &&
      topic.runKey !== args.runKey &&
      (topic.status === "published" || topic.status === "reserved") &&
      topic.expiresAt > now &&
      !followUpTopic
    ) {
      return {
        reserved: false as const,
        reason:
          topic.status === "published"
            ? ("topic-covered" as const)
            : ("topic-reserved" as const),
        existingAgentSlug: topic.agentSlug,
        existingThreadId: topic.threadId,
      };
    }

    const expiresAt = now + FORUM_AGENT_RESERVATION_TTL_MS;
    for (const sourceKey of sourceKeys) {
      const existing = await ctx.db
        .query("forumAgentSourceReservations")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
        .unique();
      const value = {
        sourceKey,
        runKey: args.runKey,
        agentSlug: args.agentSlug,
        status: "reserved" as const,
        threadId: undefined,
        reservedAt: now,
        expiresAt,
        updatedAt: now,
      };
      if (existing === null) {
        await ctx.db.insert("forumAgentSourceReservations", value);
      } else {
        await ctx.db.patch("forumAgentSourceReservations", existing._id, value);
      }
    }
    const topicValue = {
      topicFingerprint: args.topicFingerprint,
      runKey: args.runKey,
      agentSlug: args.agentSlug,
      status: "reserved" as const,
      threadId: followUpTopic ? topic?.threadId : undefined,
      reservedAt: now,
      expiresAt,
      updatedAt: now,
    };
    if (topic === null) {
      await ctx.db.insert("forumAgentTopicReservations", topicValue);
    } else {
      await ctx.db.patch("forumAgentTopicReservations", topic._id, topicValue);
    }
    await ctx.db.patch("forumAgentRuns", run._id, {
      topicFingerprint: args.topicFingerprint,
      updatedAt: now,
    });
    return followUpTopic
      ? {
          reserved: false as const,
          reason: "topic-covered" as const,
          existingAgentSlug: args.agentSlug,
          existingThreadId: topic?.threadId,
        }
      : { reserved: true as const };
  },
});

export const releaseResearchReservations = internalMutation({
  args: { runKey: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [sources, topics] = await Promise.all([
      ctx.db
        .query("forumAgentSourceReservations")
        .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
        .take(3),
      ctx.db
        .query("forumAgentTopicReservations")
        .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
        .take(1),
    ]);
    for (const row of [...sources, ...topics]) {
      if (row.status === "reserved") {
        const table = "sourceKey" in row
          ? "forumAgentSourceReservations"
          : "forumAgentTopicReservations";
        await ctx.db.patch(table, row._id, {
          status: "released",
          expiresAt: now,
          updatedAt: now,
        });
      }
    }
    return { released: sources.length + topics.length };
  },
});

export const claimRun = internalMutation({
  args: {
    agentSlug: v.optional(v.string()),
    runDate: v.string(),
    slot: v.number(),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const agentSlug = args.agentSlug ?? SUKI_AGENT_SLUG;
    const maximumSlot =
      agentSlug === "suki" ? 23 : agentSlug === "belle" ? 6 : 1;
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
      await ctx.db.patch("forumAgentRuns", existing._id, {
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

export const readRun = internalQuery({
  args: { runKey: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (run === null) {
      return null;
    }
    const thread =
      run.threadId === undefined ? null : await ctx.db.get("forumThreads", run.threadId);
    return {
      run,
      thread:
        thread === null
          ? null
          : {
              categorySlug: thread.categorySlug,
              threadSlug: thread.slug,
              title: thread.title,
            },
    };
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
    await ctx.db.patch("forumAgentRuns", run._id, {
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
    await ctx.db.patch("forumAgentRuns", run._id, {
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
    await ctx.db.patch("forumAgentResearchCache", existing._id, args);
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
    await ctx.db.patch("forumAgentMediaCache", existing._id, args);
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
    for (const row of expiredResearch) {
      await ctx.db.delete("forumAgentResearchCache", row._id);
    }
    for (const row of expiredMedia) {
      await ctx.db.delete("forumAgentMediaCache", row._id);
    }
    return {
      deletedMedia: expiredMedia.length,
      deletedResearch: expiredResearch.length,
    };
  },
});
