import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** Repair only the pre-fix Forum review double charge, from three matching
 * durable receipts. This never releases an inference or delivery hold. */
export const recordedForumReview = internalMutation({
  args: {
    reservationId: v.id("aiModelCallReservations"),
    usageId: v.id("forumAgentUsageEvents"),
    jobId: v.string(),
    dryRun: v.boolean(),
  },
  returns: v.object({ changed: v.boolean(), releasedMicroUsd: v.number() }),
  handler: async (ctx, args) => {
    const r = await ctx.db.get("aiModelCallReservations", args.reservationId);
    const u = await ctx.db.get("forumAgentUsageEvents", args.usageId);
    const c = await ctx.db
      .query("elizaRuntimeCalls")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .unique();
    if (
      r?.status === "settled" &&
      r.usageEventId === args.usageId &&
      u?.reservationKey === r.reservationKey
    )
      return { changed: false, releasedMicroUsd: 0 };
    const cost = u?.providerReportedCostMicroUsd;
    if (
      !r ||
      !u ||
      !c ||
      r.status !== "reserved" ||
      r.usageEventId ||
      u.reservationKey ||
      u.stage !== "research" ||
      !/^[a-z-]+:\d{4}-\d{2}-\d{2}:\d+$/.test(u.runKey) ||
      r.model !== u.model ||
      c.model !== u.requestedModel ||
      !r.reservationKey.startsWith(`${u.runKey}:${r.model}:`) ||
      c.operationKey !== u.runKey ||
      c.agentSlug !== u.agentSlug ||
      c.stage !== `${u.agentSlug}:forum-evidence-review` ||
      c.status !== "completed" ||
      c.outcomeUnknown === true ||
      c.inputTokens !== u.inputTokens ||
      c.outputTokens !== u.outputTokens ||
      c.createdAt < r.createdAt ||
      c.createdAt - r.createdAt > 2_000 ||
      u.createdAt < c.updatedAt ||
      u.createdAt - c.updatedAt > 30_000 ||
      // The fixed production writer was deployed on October 28 at 18:42 UTC.
      r.createdAt >= Date.parse("2026-10-28T18:42:00Z") ||
      !Number.isSafeInteger(cost) ||
      cost === undefined ||
      cost < 0 ||
      cost > r.estimatedMicroUsd ||
      u.inputTokens === undefined ||
      u.outputTokens === undefined
    )
      throw new ConvexError("recorded_review_receipts_do_not_match");
    const bucket = await ctx.db
      .query("aiSpendBuckets")
      .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
        q
          .eq("dayKey", r.dayKey)
          .eq("provider", "openrouter")
          .eq("bucket", r.bucket),
      )
      .unique();
    if (
      !bucket ||
      bucket.spentMicroUsd < r.estimatedMicroUsd ||
      bucket.inputTokens < r.estimatedInputTokens ||
      bucket.outputTokens < r.estimatedOutputTokens ||
      bucket.requests < 1
    )
      throw new ConvexError("recorded_review_budget_mismatch");
    if (!args.dryRun) {
      // Actual usage was already charged to its run-key shard. Remove only
      // the extra estimate from the reservation shard, not the actual charge.
      await ctx.db.patch("aiSpendBuckets", bucket._id, {
        spentMicroUsd: bucket.spentMicroUsd - r.estimatedMicroUsd,
        inputTokens: bucket.inputTokens - r.estimatedInputTokens,
        outputTokens: bucket.outputTokens - r.estimatedOutputTokens,
        requests: bucket.requests - 1,
        updatedAt: Date.now(),
      });
      await ctx.db.patch("aiModelCallReservations", r._id, {
        status: "settled",
        usageEventId: u._id,
        settledMicroUsd: cost,
        settledInputTokens: u.inputTokens,
        settledOutputTokens: u.outputTokens,
        updatedAt: Date.now(),
      });
      await ctx.db.patch("forumAgentUsageEvents", u._id, {
        reservationKey: r.reservationKey,
      });
    }
    return { changed: !args.dryRun, releasedMicroUsd: r.estimatedMicroUsd };
  },
});
