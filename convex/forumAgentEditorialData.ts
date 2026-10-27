import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import {
  estimatedModelCostMicroUsd,
  forumDayKey,
  openRouterBillingModel,
  spendBucketForKey,
} from "../lib/ai-model-costs";
import {
  recordSpendBucket,
  settleModelCallReservation,
} from "./aiRoutingControlData";

const AGENT_SLUG = v.string();
const PUBLIC_FORUM_ACCESS = "public";
const MAX_CATEGORY_ANCESTORS = 16;
const MAX_MEMORY_THREAD_LOOKUPS = 32;
const USAGE_STAGE = v.union(
  v.literal("topic"),
  v.literal("draft"),
  v.literal("revision"),
  v.literal("reply"),
  v.literal("embedding"),
  v.literal("research"),
  v.literal("canary"),
  v.literal("owner-console"),
);

function reportedTokenCount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

type MemoryReadCache = {
  categories: Map<
    Id<"forumCategories">,
    Promise<Doc<"forumCategories"> | null>
  >;
  authors: Map<Id<"users">, Promise<Doc<"users"> | null>>;
};

async function publicCategoryForMemory(
  ctx: QueryCtx,
  categoryId: Id<"forumCategories">,
  categoryCache?: MemoryReadCache["categories"],
) {
  const readCategory = (id: Id<"forumCategories">) => {
    const cached = categoryCache?.get(id);
    if (cached !== undefined) return cached;
    const result = ctx.db.get("forumCategories", id);
    categoryCache?.set(id, result);
    return result;
  };
  let category = await readCategory(categoryId);
  let publicCategory = category;
  for (let depth = 0; depth < MAX_CATEGORY_ANCESTORS; depth += 1) {
    if (
      category === null ||
      category.status !== "active" ||
      category.viewAccess !== PUBLIC_FORUM_ACCESS
    )
      return null;
    if (category.parentCategoryId === undefined) return publicCategory;
    category = await readCategory(category.parentCategoryId);
  }
  // Cyclic or excessively nested category trees fail closed.
  return null;
}

export async function currentPublicMemoryThread(
  ctx: QueryCtx,
  threadId: Id<"forumThreads">,
  cache?: MemoryReadCache,
) {
  const thread = await ctx.db.get("forumThreads", threadId);
  if (thread === null || thread.status !== "active") return null;
  const authorLookup = cache?.authors.get(thread.authorId);
  const author = authorLookup ?? ctx.db.get("users", thread.authorId);
  if (cache !== undefined && authorLookup === undefined)
    cache.authors.set(thread.authorId, author);
  const [category, currentAuthor] = await Promise.all([
    publicCategoryForMemory(ctx, thread.categoryId, cache?.categories),
    author,
  ]);
  // This namespace is shared with public editorial retrieval. Never send a
  // thread to it unless its category is explicitly public; legacy/missing
  // access values fail closed as well.
  if (
    category === null ||
    currentAuthor === null ||
    category.status !== "active"
  )
    return null;
  return {
    threadId: thread._id,
    categorySlug: category.slug,
    title: thread.title,
    body: thread.body,
    authorName: currentAuthor.name ?? currentAuthor.username ?? "Forum member",
    agentSlug:
      currentAuthor.isAgent === true && currentAuthor.agentSlug !== undefined
        ? currentAuthor.agentSlug
        : "human",
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

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
    reservationKey: v.optional(v.string()),
    reservationModel: v.optional(v.string()),
    agentSlug: AGENT_SLUG,
    stage: USAGE_STAGE,
    model: v.string(),
    servedModel: v.optional(v.string()),
    categorySlug: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    providerReportedCostMicroUsd: v.optional(v.number()),
    qualityBefore: v.optional(v.number()),
    qualityAfter: v.optional(v.number()),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const inputTokens = reportedTokenCount(args.inputTokens);
    const outputTokens = reportedTokenCount(args.outputTokens);
    const providerReportedCostMicroUsd = args.providerReportedCostMicroUsd;
    if (
      providerReportedCostMicroUsd !== undefined &&
      (!Number.isSafeInteger(providerReportedCostMicroUsd) ||
        providerReportedCostMicroUsd < 0)
    ) {
      throw new ConvexError({
        code: "AI_USAGE_PROVIDER_COST_INVALID",
        message:
          "Provider-reported AI cost must be a non-negative microdollar integer.",
      });
    }
    // Embeddings report input tokens only. Generation stages need both
    // counters before their measured cost can replace the conservative reserve.
    const usageComplete =
      inputTokens !== undefined &&
      (args.stage === "embedding" || outputTokens !== undefined);
    const billingModel =
      args.stage === "embedding"
        ? args.model
        : openRouterBillingModel(args.servedModel, args.model);
    const estimatedCostMicroUsd = usageComplete
      ? estimatedModelCostMicroUsd(billingModel, inputTokens, outputTokens ?? 0)
      : undefined;
    let priorUsageEventId: Id<"forumAgentUsageEvents"> | undefined;
    let reservationId: Id<"aiModelCallReservations"> | undefined;

    if (args.reservationKey !== undefined) {
      if (usageComplete) {
        const settlement = await settleModelCallReservation(ctx, {
          reservationKey: args.reservationKey,
          model: args.reservationModel ?? args.model,
          settlementModel: billingModel,
          inputTokens: inputTokens ?? 0,
          outputTokens: outputTokens ?? 0,
          providerReportedCostMicroUsd,
          now,
        });
        if (!settlement.settled) return null;
        priorUsageEventId = settlement.usageEventId;
      } else {
        const reservation = await ctx.db
          .query("aiModelCallReservations")
          .withIndex("by_reservationKey", (q) =>
            q.eq("reservationKey", args.reservationKey!),
          )
          .unique();
        if (reservation === null) {
          throw new ConvexError({
            code: "AI_USAGE_RESERVATION_MISSING",
            message: "The AI usage reservation no longer exists.",
          });
        }
        if (reservation.model !== (args.reservationModel ?? args.model)) {
          throw new ConvexError({
            code: "AI_USAGE_RESERVATION_MODEL_MISMATCH",
            message: "AI usage must settle against the reserved model.",
          });
        }
        if (reservation.status === "settled") return null;
        reservationId = reservation._id;
        priorUsageEventId = reservation.usageEventId;
        // A prior unknown receipt is later upgraded in place if a retry obtains
        // complete usage. Keep the estimate held until that reconciliation.
        if (priorUsageEventId !== undefined) return null;
      }
    } else if (usageComplete) {
      await recordSpendBucket(ctx, {
        dayKey: forumDayKey(now),
        provider: "openrouter",
        bucket: spendBucketForKey(args.runKey),
        spentMicroUsd: providerReportedCostMicroUsd ?? estimatedCostMicroUsd!,
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        now,
      });
    }

    const usageEvent = {
      runKey: args.runKey,
      agentSlug: args.agentSlug,
      stage: args.stage,
      model: billingModel,
      requestedModel: args.model,
      ...(args.servedModel === undefined
        ? {}
        : { servedModel: args.servedModel.slice(0, 200) }),
      categorySlug: args.categorySlug,
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      qualityBefore: args.qualityBefore,
      qualityAfter: args.qualityAfter,
      ...(estimatedCostMicroUsd === undefined ? {} : { estimatedCostMicroUsd }),
      ...(providerReportedCostMicroUsd === undefined
        ? {}
        : { providerReportedCostMicroUsd }),
      durationMs: Math.max(0, Math.round(args.durationMs)),
      createdAt: now,
    };
    let usageEventId = priorUsageEventId;
    if (usageEventId === undefined)
      usageEventId = await ctx.db.insert("forumAgentUsageEvents", usageEvent);
    else await ctx.db.patch("forumAgentUsageEvents", usageEventId, usageEvent);
    if (reservationId !== undefined)
      await ctx.db.patch("aiModelCallReservations", reservationId, {
        usageEventId,
      });
    return null;
  },
});

export const readThreadForMemory = internalQuery({
  args: { threadId: v.id("forumThreads") },
  handler: async (ctx, args) => {
    return await currentPublicMemoryThread(ctx, args.threadId);
  },
});

export const readThreadsForMemory = internalQuery({
  args: { threadIds: v.array(v.id("forumThreads")) },
  handler: async (ctx, args) => {
    const cache: MemoryReadCache = {
      categories: new Map(),
      authors: new Map(),
    };
    return await Promise.all(
      args.threadIds
        .slice(0, MAX_MEMORY_THREAD_LOOKUPS)
        .map(
          async (threadId) =>
            await currentPublicMemoryThread(ctx, threadId, cache),
        ),
    );
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
    const publicThreadIds = await Promise.all(
      page.page.map(async (thread) => {
        const category = await publicCategoryForMemory(ctx, thread.categoryId);
        return category === null ? null : thread._id;
      }),
    );
    return {
      // Filter before scheduling indexing so private rows never reach the
      // shared public editorial namespace, including during backfills.
      threadIds: publicThreadIds.filter(
        (threadId): threadId is NonNullable<typeof threadId> =>
          threadId !== null,
      ),
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
    const aggregates = await ctx.db
      .query("forumAgentModerationOutcomeAggregates")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(160);
    return aggregates.filter(
      (aggregate) =>
        aggregate.sampleCount >= aggregate.minimumSampleSize &&
        aggregate.score !== undefined,
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
        feedbackSampleCount: v.number(),
        helpfulCount: v.number(),
        sourceIssueCount: v.number(),
        duplicateConfirmedCount: v.number(),
        disclosureIssueCount: v.number(),
        minimumSampleSize: v.number(),
        score: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let created = 0;
    let updated = 0;
    let unchanged = 0;
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
        created += 1;
      } else if (
        existing.agentSlug === cohort.agentSlug &&
        existing.categorySlug === cohort.categorySlug &&
        existing.contentFormat === cohort.contentFormat &&
        existing.promptVersion === cohort.promptVersion &&
        existing.sampleCount === cohort.sampleCount &&
        existing.totalViews === cohort.totalViews &&
        existing.totalReplies === cohort.totalReplies &&
        existing.totalPollVotes === cohort.totalPollVotes &&
        existing.totalQuality === cohort.totalQuality &&
        existing.feedbackSampleCount === cohort.feedbackSampleCount &&
        existing.helpfulCount === cohort.helpfulCount &&
        existing.sourceIssueCount === cohort.sourceIssueCount &&
        existing.duplicateConfirmedCount === cohort.duplicateConfirmedCount &&
        existing.disclosureIssueCount === cohort.disclosureIssueCount &&
        existing.minimumSampleSize === cohort.minimumSampleSize &&
        existing.score === cohort.score
      ) {
        unchanged += 1;
      } else {
        await ctx.db.patch("forumAgentEditorialCohorts", existing._id, {
          ...cohort,
          updatedAt: now,
        });
        updated += 1;
      }
    }
    return { created, updated, unchanged };
  },
});

export const readEditorialStrategies = internalQuery({
  args: { agentSlug: AGENT_SLUG },
  handler: async (ctx, args) => {
    const cohorts = await ctx.db
      .query("forumAgentModerationOutcomeAggregates")
      .withIndex("by_agentSlug_and_updatedAt", (q) =>
        q.eq("agentSlug", args.agentSlug),
      )
      .order("desc")
      .take(80);
    return cohorts
      .filter(
        (cohort) =>
          cohort.sampleCount >= cohort.minimumSampleSize &&
          cohort.score !== undefined,
      )
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, 24)
      .map((cohort) => ({
        categorySlug: cohort.categorySlug,
        contentFormat: cohort.contentFormat,
        sampleCount: cohort.sampleCount,
        score: cohort.score!,
      }));
  },
});
