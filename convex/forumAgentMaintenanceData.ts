import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

const BATCH_SIZE = 40;
const OPERATIONAL_RETENTION_MS = 35 * 24 * 60 * 60 * 1_000;
const PUBLISHED_RUN_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
const SOURCE_USE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const RESERVATION_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;
const LEGACY_RESOURCE_DELAY_MS = 24 * 60 * 60 * 1_000;

type OperationalCleanupResult = {
  deleted: number;
  deletedAgentRuns: number;
  deletedReplyRuns: number;
  deletedTelemetry: number;
  deletedReservations: number;
  deletedSourceUses: number;
  deletedSpendBuckets: number;
  continuing: boolean;
};

type LegacyResource = {
  runId: Id<"forumAgentRuns">;
  agentThreadId?: string;
  workflowId?: string;
};

export const cleanupExpiredOperationalData = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<OperationalCleanupResult> => {
    const now = args.now ?? Date.now();
    const operationalCutoff = now - OPERATIONAL_RETENTION_MS;
    const publishedCutoff = now - PUBLISHED_RUN_RETENTION_MS;
    const reservationCutoff = now - RESERVATION_GRACE_MS;
    const sourceUseCutoff = now - SOURCE_USE_RETENTION_MS;

    const [failedRuns, skippedRuns, publishedRuns] = await Promise.all([
      ctx.db
        .query("forumAgentRuns")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "failed").lt("updatedAt", operationalCutoff),
        )
        .take(BATCH_SIZE),
      ctx.db
        .query("forumAgentRuns")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "skipped").lt("updatedAt", operationalCutoff),
        )
        .take(BATCH_SIZE),
      ctx.db
        .query("forumAgentRuns")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "published").lt("updatedAt", publishedCutoff),
        )
        .take(BATCH_SIZE),
    ]);
    const [repliedRuns, ignoredRuns, failedReplyRuns] = await Promise.all([
      ctx.db
        .query("forumAgentReplyRuns")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "replied").lt("updatedAt", operationalCutoff),
        )
        .take(BATCH_SIZE),
      ctx.db
        .query("forumAgentReplyRuns")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "ignored").lt("updatedAt", operationalCutoff),
        )
        .take(BATCH_SIZE),
      ctx.db
        .query("forumAgentReplyRuns")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "failed").lt("updatedAt", operationalCutoff),
        )
        .take(BATCH_SIZE),
    ]);
    const [usageEvents, routeEvents, sourceUses, spendBuckets] =
      await Promise.all([
        ctx.db
          .query("forumAgentUsageEvents")
          .withIndex("by_createdAt", (q) =>
            q.lt("createdAt", operationalCutoff),
          )
          .take(BATCH_SIZE),
        ctx.db
          .query("aiRouteEvents")
          .withIndex("by_createdAt", (q) =>
            q.lt("createdAt", operationalCutoff),
          )
          .take(BATCH_SIZE),
        ctx.db
          .query("forumAgentSourceUses")
          .withIndex("by_usedAt", (q) => q.lt("usedAt", sourceUseCutoff))
          .take(BATCH_SIZE),
        ctx.db
          .query("aiSpendBuckets")
          .withIndex("by_updatedAt", (q) =>
            q.lt("updatedAt", operationalCutoff),
          )
          .take(BATCH_SIZE),
      ]);
    const reservationGroups = await Promise.all(
      (["reserved", "published", "released"] as const).flatMap((status) => [
        ctx.db
          .query("forumAgentSourceReservations")
          .withIndex("by_status_and_expiresAt", (q) =>
            q.eq("status", status).lt("expiresAt", reservationCutoff),
          )
          .take(BATCH_SIZE),
        ctx.db
          .query("forumAgentTopicReservations")
          .withIndex("by_status_and_expiresAt", (q) =>
            q.eq("status", status).lt("expiresAt", reservationCutoff),
          )
          .take(BATCH_SIZE),
      ]),
    );

    const agentRuns = [...failedRuns, ...skippedRuns, ...publishedRuns].filter(
      (run) => run.agentThreadId === undefined && run.workflowId === undefined,
    );
    const replyRuns = [...repliedRuns, ...ignoredRuns, ...failedReplyRuns];
    const [
      reservedSources,
      reservedTopics,
      publishedSources,
      publishedTopics,
      releasedSources,
      releasedTopics,
    ] = reservationGroups;
    const reservations = reservationGroups.flat();
    const rows = [
      ...agentRuns,
      ...replyRuns,
      ...usageEvents,
      ...routeEvents,
      ...sourceUses,
      ...spendBuckets,
      ...reservations,
    ];
    for (const row of agentRuns) await ctx.db.delete("forumAgentRuns", row._id);
    for (const row of replyRuns)
      await ctx.db.delete("forumAgentReplyRuns", row._id);
    for (const row of usageEvents)
      await ctx.db.delete("forumAgentUsageEvents", row._id);
    for (const row of routeEvents) await ctx.db.delete("aiRouteEvents", row._id);
    for (const row of sourceUses)
      await ctx.db.delete("forumAgentSourceUses", row._id);
    for (const row of spendBuckets) await ctx.db.delete("aiSpendBuckets", row._id);
    for (const row of [
      ...reservedSources,
      ...publishedSources,
      ...releasedSources,
    ]) {
      await ctx.db.delete(
        "forumAgentSourceReservations",
        row._id as Id<"forumAgentSourceReservations">,
      );
    }
    for (const row of [...reservedTopics, ...publishedTopics, ...releasedTopics]) {
      await ctx.db.delete(
        "forumAgentTopicReservations",
        row._id as Id<"forumAgentTopicReservations">,
      );
    }

    // A full agent-run page can be made entirely of rows whose component
    // resources have not been cleaned yet. Only continue immediately when
    // this pass actually removed something, otherwise the daily resource
    // cleanup will clear those references without creating a scheduler loop.
    const needsContinuation =
      rows.length > 0 &&
      [
        failedRuns,
        skippedRuns,
        publishedRuns,
        repliedRuns,
        ignoredRuns,
        failedReplyRuns,
        usageEvents,
        routeEvents,
        sourceUses,
        spendBuckets,
        ...reservationGroups,
      ].some((batch) => batch.length >= BATCH_SIZE);
    if (needsContinuation) {
      await ctx.scheduler.runAfter(
        1_000,
        internal.forumAgentMaintenanceData.cleanupExpiredOperationalData,
        { now },
      );
    }
    return {
      deleted: rows.length,
      deletedAgentRuns: agentRuns.length,
      deletedReplyRuns: replyRuns.length,
      deletedTelemetry: usageEvents.length + routeEvents.length,
      deletedReservations: reservations.length,
      deletedSourceUses: sourceUses.length,
      deletedSpendBuckets: spendBuckets.length,
      continuing: needsContinuation,
    };
  },
});

export const readLegacyResourcesForCleanup = internalQuery({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<LegacyResource[]> => {
    const cutoff = (args.now ?? Date.now()) - LEGACY_RESOURCE_DELAY_MS;
    const groups = await Promise.all(
      (["published", "skipped", "failed"] as const).map((status) =>
        ctx.db
          .query("forumAgentRuns")
          .withIndex("by_status_and_updatedAt", (q) =>
            q.eq("status", status).lt("updatedAt", cutoff),
          )
          .order("asc")
          .take(25),
      ),
    );
    return groups
      .flat()
      .filter(
        (run) =>
          run.agentThreadId !== undefined || run.workflowId !== undefined,
      )
      .slice(0, 25)
      .map((run) => ({
        runId: run._id,
        agentThreadId: run.agentThreadId,
        workflowId: run.workflowId,
      }));
  },
});

export const clearLegacyResourceReferences = internalMutation({
  args: {
    runId: v.id("forumAgentRuns"),
    clearAgentThread: v.boolean(),
    clearWorkflow: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ updated: boolean }> => {
    const run = await ctx.db.get("forumAgentRuns", args.runId);
    if (run === null) return { updated: false as const };
    await ctx.db.patch("forumAgentRuns", run._id, {
      ...(args.clearAgentThread ? { agentThreadId: undefined } : {}),
      ...(args.clearWorkflow ? { workflowId: undefined } : {}),
      updatedAt: run.updatedAt,
    });
    return { updated: true as const };
  },
});
