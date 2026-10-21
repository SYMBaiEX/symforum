import { v } from "convex/values";
import { internal } from "./_generated/api";
import { env, internalMutation, type MutationCtx } from "./_generated/server";

/**
 * Only the owner's explicitly approved retry of a definitely rejected Bags
 * draft qualifies. A missing or ambiguous receipt is never authorization.
 * The source records remain immutable and can still be inspected afterwards.
 */
export async function validateBagsRetry(
  ctx: MutationCtx,
  failedRunKey: string,
  jobId: string,
): Promise<boolean> {
  if (
    !/^[a-zA-Z0-9:_-]{1,200}$/.test(failedRunKey) ||
    !/^[a-zA-Z0-9:_-]{1,200}$/.test(jobId)
  )
    return false;

  const source = await ctx.db
    .query("tokenAlphaRuns")
    .withIndex("by_runKey", (q) => q.eq("runKey", failedRunKey))
    .unique();
  if (
    source === null ||
    source.platform !== "bags" ||
    source.status !== "failed" ||
    source.analysis !== undefined ||
    source.title !== undefined ||
    source.body !== undefined ||
    source.postId !== undefined ||
    source.operatorRetryOf !== undefined
  )
    return false;

  const forumRun = await ctx.db
    .query("forumAgentRuns")
    .withIndex("by_runKey", (q) => q.eq("runKey", failedRunKey))
    .unique();
  if (
    forumRun === null ||
    forumRun.agentSlug !== "bags-scout" ||
    forumRun.status !== "failed" ||
    forumRun.followUpPostId !== undefined
  )
    return false;

  const call = await ctx.db
    .query("elizaRuntimeCalls")
    .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
    .unique();
  if (
    call === null ||
    call.operationKey !== failedRunKey ||
    call.agentSlug !== "bags-scout" ||
    call.stage !== "bags-scout:forum-draft" ||
    call.model !== "openrouter/free" ||
    call.status !== "failed" ||
    call.providerStatus !== 404 ||
    call.outcomeUnknown !== false ||
    !/^[a-f0-9]{64}$/.test(call.inputHash)
  )
    return false;

  const operation = await ctx.db
    .query("elizaRuntimeOperations")
    .withIndex("by_operationKey", (q) => q.eq("operationKey", failedRunKey))
    .unique();
  if (
    operation === null ||
    operation.status !== "ready" ||
    operation.jobId !== jobId ||
    operation.inputHash !== call.inputHash
  )
    return false;

  const publications = await ctx.db
    .query("forumAgentRuns")
    .withIndex("by_agentSlug_and_status_and_startedAt", (q) =>
      q.eq("agentSlug", "bags-scout").eq("status", "published"),
    )
    .take(1);
  return publications.length === 0;
}

/** One internal operator authorization, not an automated retry policy. */
export const queueBagsRetry = internalMutation({
  args: { failedRunKey: v.string(), jobId: v.string() },
  returns: v.object({ queued: v.boolean(), runKey: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ queued: boolean; runKey?: string }> => {
    const control = await ctx.db
      .query("tokenAlphaControl")
      .withIndex("by_key", (q) => q.eq("key", "pilot"))
      .unique();
    if (
      control?.enabled !== true ||
      env.ELIZA_RUNTIME_MODE !== "live" ||
      control.operatorBagsRetry !== undefined ||
      !(await validateBagsRetry(ctx, args.failedRunKey, args.jobId))
    )
      return { queued: false };

    const runKey = `${args.failedRunKey}:operator-retry-1`;
    const [existingRun, existingForumRun] = await Promise.all([
      ctx.db
        .query("tokenAlphaRuns")
        .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
        .unique(),
      ctx.db
        .query("forumAgentRuns")
        .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
        .unique(),
    ]);
    if (existingRun !== null || existingForumRun !== null)
      return { queued: false };

    const now = Date.now();
    await ctx.db.patch("tokenAlphaControl", control._id, {
      operatorBagsRetry: {
        sourceRunKey: args.failedRunKey,
        sourceJobId: args.jobId,
        runKey,
        authorizedAt: now,
      },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.tokenAlphaAgent.run, {
      platform: "bags",
      operatorRetryOf: args.failedRunKey,
    });
    return { queued: true, runKey };
  },
});
