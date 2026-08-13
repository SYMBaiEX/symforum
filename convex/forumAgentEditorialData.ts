import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  estimatedModelCostMicroUsd,
  forumDayKey,
  spendBucketForKey,
} from "../lib/ai-model-costs";
import { recordSpendBucket } from "./aiRoutingControlData";

const AGENT_SLUG = v.string();
const USAGE_STAGE = v.union(
  v.literal("topic"),
  v.literal("draft"),
  v.literal("revision"),
  v.literal("reply"),
  v.literal("embedding"),
);

export const attachRunInfrastructure = internalMutation({
  args: {
    runKey: v.string(),
    agentThreadId: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (run === null) return { updated: false as const };
    await ctx.db.patch("forumAgentRuns", run._id, {
      agentThreadId: args.agentThreadId ?? run.agentThreadId,
      workflowId: args.workflowId ?? run.workflowId,
      promptVersion: args.promptVersion ?? run.promptVersion,
      updatedAt: Date.now(),
    });
    return { updated: true as const };
  },
});

export const recordUsage = internalMutation({
  args: {
    runKey: v.string(),
    agentSlug: AGENT_SLUG,
    stage: USAGE_STAGE,
    model: v.string(),
    categorySlug: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    qualityBefore: v.optional(v.number()),
    qualityAfter: v.optional(v.number()),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const estimatedCostMicroUsd = estimatedModelCostMicroUsd(
      args.model,
      args.inputTokens,
      args.outputTokens,
    );
    await ctx.db.insert("forumAgentUsageEvents", {
      ...args,
      estimatedCostMicroUsd,
      durationMs: Math.max(0, Math.round(args.durationMs)),
      createdAt: now,
    });
    await recordSpendBucket(ctx, {
      dayKey: forumDayKey(now),
      provider: "openrouter",
      bucket: spendBucketForKey(args.runKey),
      spentMicroUsd: estimatedCostMicroUsd,
      inputTokens: args.inputTokens ?? 0,
      outputTokens: args.outputTokens ?? 0,
      now,
    });
    return null;
  },
});

export const readThreadForMemory = internalQuery({
  args: { threadId: v.id("forumThreads") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get("forumThreads", args.threadId);
    if (thread === null || thread.status !== "active") return null;
    const [category, author] = await Promise.all([
      ctx.db.get("forumCategories", thread.categoryId),
      ctx.db.get("users", thread.authorId),
    ]);
    if (category === null || author === null) return null;
    return {
      threadId: thread._id,
      categorySlug: category.slug,
      title: thread.title,
      body: thread.body,
      authorName: author.name ?? author.username ?? "Forum member",
      agentSlug:
        author.isAgent === true && author.agentSlug !== undefined
          ? author.agentSlug
          : "human",
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    };
  },
});

export const readForumThreadsForBackfill = internalQuery({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("forumThreads")
      .withIndex("by_status_and_lastPostAt", (q) => q.eq("status", "active"))
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: 40 });
    return {
      threadIds: page.page.map((thread) => thread._id),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

const EMBEDDING_BACKFILL_KEY = "forum-agent-memory-backfill";

export const readEmbeddingBackfillState = internalQuery({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("forumAgentMaintenanceState")
      .withIndex("by_key", (q) => q.eq("key", EMBEDDING_BACKFILL_KEY))
      .unique(),
});

export const writeEmbeddingBackfillState = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    completed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("forumAgentMaintenanceState")
      .withIndex("by_key", (q) => q.eq("key", EMBEDDING_BACKFILL_KEY))
      .unique();
    const value = {
      key: EMBEDDING_BACKFILL_KEY,
      cursor: args.cursor,
      completedAt: args.completed ? now : (existing?.completedAt ?? 0),
      updatedAt: now,
    };
    if (existing === null)
      await ctx.db.insert("forumAgentMaintenanceState", value);
    else await ctx.db.patch("forumAgentMaintenanceState", existing._id, value);
    return value;
  },
});

export const readEditorialOutcomeSnapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runDate")
      .order("desc")
      .take(180);
    const published = runs.filter(
      (run) => run.status === "published" && run.threadId !== undefined,
    );
    return await Promise.all(
      published.map(async (run) => {
        const [thread, poll] = await Promise.all([
          ctx.db.get("forumThreads", run.threadId!),
          ctx.db
            .query("forumPolls")
            .withIndex("by_threadId", (q) => q.eq("threadId", run.threadId!))
            .unique(),
        ]);
        if (thread === null) return null;
        return {
          agentSlug: run.agentSlug,
          categorySlug: run.categorySlug ?? thread.categorySlug,
          contentFormat: run.contentFormat ?? "brief",
          promptVersion: run.promptVersion ?? "legacy",
          views: thread.viewCount,
          replies: thread.replyCount,
          pollVotes: poll?.totalVotes ?? 0,
          quality: run.qualityScore ?? 70,
        };
      }),
    );
  },
});

export const replaceEditorialCohorts = internalMutation({
  args: {
    cohorts: v.array(
      v.object({
        cohortKey: v.string(),
        agentSlug: AGENT_SLUG,
        categorySlug: v.string(),
        contentFormat: v.string(),
        promptVersion: v.string(),
        sampleCount: v.number(),
        totalViews: v.number(),
        totalReplies: v.number(),
        totalPollVotes: v.number(),
        totalQuality: v.number(),
        score: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const cohort of args.cohorts.slice(0, 160)) {
      const existing = await ctx.db
        .query("forumAgentEditorialCohorts")
        .withIndex("by_cohortKey", (q) => q.eq("cohortKey", cohort.cohortKey))
        .unique();
      if (existing === null) {
        await ctx.db.insert("forumAgentEditorialCohorts", {
          ...cohort,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch("forumAgentEditorialCohorts", existing._id, { ...cohort, updatedAt: now });
      }
    }
    return { updated: Math.min(args.cohorts.length, 160) };
  },
});

export const readEditorialStrategies = internalQuery({
  args: { agentSlug: AGENT_SLUG },
  handler: async (ctx, args) => {
    const cohorts = await ctx.db
      .query("forumAgentEditorialCohorts")
      .withIndex("by_agentSlug_and_score", (q) =>
        q.eq("agentSlug", args.agentSlug),
      )
      .order("desc")
      .take(24);
    return cohorts.map((cohort) => ({
      categorySlug: cohort.categorySlug,
      contentFormat: cohort.contentFormat,
      sampleCount: cohort.sampleCount,
      score: cohort.score,
    }));
  },
});
