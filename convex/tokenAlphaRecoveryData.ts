import { v } from "convex/values";
import { OPENROUTER_TOKEN_SCOUT_MODEL } from "../lib/ai-models";
import { internal } from "./_generated/api";
import { env, internalMutation, type MutationCtx } from "./_generated/server";

const BAGS_DATA_FAILURE = "token-pilot-mint-verification-failed:http-429";
const BAGS_VALIDATION_FAILURE = "token-pilot-model-draft-failed";
const BAGS_GRAMMAR_FAILURE =
  "token-pilot-model-draft-failed:analysis-policy-phrase";
const RECEIPT_SCAN_LIMIT = 257;

/** Only the current ordinary slot's confirmed pre-model RPC failure qualifies. */
export async function validateBagsDataRecovery(
  ctx: MutationCtx,
  failedRunKey: string,
  now: number,
): Promise<boolean> {
  if (failedRunKey !== `bags:${new Date(now).toISOString().slice(0, 13)}`)
    return false;

  const source = await ctx.db
    .query("tokenAlphaRuns")
    .withIndex("by_runKey", (q) => q.eq("runKey", failedRunKey))
    .unique();
  if (
    source === null ||
    source.platform !== "bags" ||
    source.status !== "failed" ||
    source.reason !== BAGS_DATA_FAILURE ||
    source.snapshot !== undefined ||
    source.previous !== undefined ||
    source.analysis !== undefined ||
    source.title !== undefined ||
    source.body !== undefined ||
    source.threadId !== undefined ||
    source.postId !== undefined ||
    source.operatorFirstPost !== undefined ||
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
    forumRun.model !== OPENROUTER_TOKEN_SCOUT_MODEL ||
    forumRun.errorMessage !== BAGS_DATA_FAILURE ||
    forumRun.threadId !== undefined ||
    forumRun.followUpPostId !== undefined ||
    forumRun.title !== undefined ||
    forumRun.imageSourceUrl !== undefined ||
    forumRun.contentFormat !== undefined ||
    forumRun.inputTokens !== undefined ||
    forumRun.outputTokens !== undefined ||
    forumRun.sourceUrls.length !== 0
  )
    return false;

  const [operation, calls, packet, revision, publications] = await Promise.all([
    ctx.db
      .query("elizaRuntimeOperations")
      .withIndex("by_operationKey", (q) => q.eq("operationKey", failedRunKey))
      .unique(),
    // Receipts lack an operation-key index. The complete bounded indexed scan
    // fails closed at capacity instead of assuming an unseen receipt is absent.
    ctx.db
      .query("elizaRuntimeCalls")
      .withIndex("by_expiresAt")
      .take(RECEIPT_SCAN_LIMIT),
    ctx.db
      .query("forumAgentResearchPackets")
      .withIndex("by_runKey", (q) => q.eq("runKey", failedRunKey))
      .first(),
    ctx.db
      .query("forumAgentDraftRevisions")
      .withIndex("by_runKey_and_revision", (q) => q.eq("runKey", failedRunKey))
      .first(),
    ctx.db
      .query("forumAgentRuns")
      .withIndex("by_agentSlug_and_status_and_startedAt", (q) =>
        q.eq("agentSlug", "bags-scout").eq("status", "published"),
      )
      .take(1),
  ]);
  return (
    operation === null &&
    calls.length < RECEIPT_SCAN_LIMIT &&
    !calls.some((call) => call.operationKey === failedRunKey) &&
    packet === null &&
    revision === null &&
    publications.length === 0
  );
}

/** Shared receipt/proof checks; callers fix one exact local failure reason. */
async function validateCompletedBagsDraftFailure(
  ctx: MutationCtx,
  failedRunKey: string,
  jobId: string,
  now: number,
  failureReason: typeof BAGS_VALIDATION_FAILURE | typeof BAGS_GRAMMAR_FAILURE,
): Promise<boolean> {
  if (
    failedRunKey !== `bags:${new Date(now).toISOString().slice(0, 13)}` ||
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
    source.reason !== failureReason ||
    source.operatorFirstPost !== undefined ||
    source.operatorRetryOf !== undefined ||
    source.snapshot === undefined ||
    source.analysis !== undefined ||
    source.title !== undefined ||
    source.body !== undefined ||
    source.threadId !== undefined ||
    source.postId !== undefined
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
    forumRun.model !== OPENROUTER_TOKEN_SCOUT_MODEL ||
    forumRun.errorMessage !== failureReason ||
    forumRun.threadId !== undefined ||
    forumRun.followUpPostId !== undefined ||
    forumRun.title !== undefined ||
    forumRun.imageSourceUrl !== undefined ||
    forumRun.contentFormat !== undefined ||
    forumRun.sourceUrls.length !== 0
  )
    return false;

  const [operation, calls, packet, revision, publications] = await Promise.all([
    ctx.db
      .query("elizaRuntimeOperations")
      .withIndex("by_operationKey", (q) => q.eq("operationKey", failedRunKey))
      .unique(),
    ctx.db
      .query("elizaRuntimeCalls")
      .withIndex("by_expiresAt")
      .take(RECEIPT_SCAN_LIMIT),
    ctx.db
      .query("forumAgentResearchPackets")
      .withIndex("by_runKey", (q) => q.eq("runKey", failedRunKey))
      .first(),
    ctx.db
      .query("forumAgentDraftRevisions")
      .withIndex("by_runKey_and_revision", (q) => q.eq("runKey", failedRunKey))
      .first(),
    ctx.db
      .query("forumAgentRuns")
      .withIndex("by_agentSlug_and_status_and_startedAt", (q) =>
        q.eq("agentSlug", "bags-scout").eq("status", "published"),
      )
      .take(1),
  ]);
  if (
    operation === null ||
    operation.status !== "ready" ||
    operation.jobId !== jobId ||
    calls.length === RECEIPT_SCAN_LIMIT ||
    packet !== null ||
    revision !== null ||
    publications.length !== 0
  )
    return false;
  const sourceCalls = calls.filter(
    (call) => call.operationKey === failedRunKey,
  );
  if (sourceCalls.length !== 1) return false;
  const call = sourceCalls[0];
  return (
    call.jobId === jobId &&
    call.agentSlug === "bags-scout" &&
    call.stage === "bags-scout:forum-draft" &&
    call.model === OPENROUTER_TOKEN_SCOUT_MODEL &&
    call.status === "completed" &&
    call.outcomeUnknown !== true &&
    /^[a-f0-9]{64}$/.test(call.inputHash) &&
    operation.inputHash === call.inputHash
  );
}

/** The earlier authorization remains restricted to its original generic code. */
export async function validateBagsValidationVerification(
  ctx: MutationCtx,
  failedRunKey: string,
  jobId: string,
  now: number,
): Promise<boolean> {
  return await validateCompletedBagsDraftFailure(
    ctx,
    failedRunKey,
    jobId,
    now,
    BAGS_VALIDATION_FAILURE,
  );
}

/** Separate authorization for the confirmed grammar-policy false positive. */
export async function validateBagsGrammarVerification(
  ctx: MutationCtx,
  failedRunKey: string,
  jobId: string,
  now: number,
): Promise<boolean> {
  return await validateCompletedBagsDraftFailure(
    ctx,
    failedRunKey,
    jobId,
    now,
    BAGS_GRAMMAR_FAILURE,
  );
}

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

/** Separate permanent authority for the owner's one approved data recovery. */
export const queueBagsDataRecovery = internalMutation({
  args: { failedRunKey: v.string() },
  returns: v.object({ queued: v.boolean(), runKey: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ queued: boolean; runKey?: string }> => {
    const control = await ctx.db
      .query("tokenAlphaControl")
      .withIndex("by_key", (q) => q.eq("key", "pilot"))
      .unique();
    const now = Date.now();
    if (
      control?.enabled !== true ||
      env.ELIZA_RUNTIME_MODE !== "live" ||
      control.operatorBagsDataRecovery !== undefined ||
      !(await validateBagsDataRecovery(ctx, args.failedRunKey, now))
    )
      return { queued: false };

    const runKey = `${args.failedRunKey}:operator-data-recovery-1`;
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

    await ctx.db.patch("tokenAlphaControl", control._id, {
      operatorBagsDataRecovery: {
        sourceRunKey: args.failedRunKey,
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

/** One owner-approved verification, separate from earlier permanent markers. */
export const queueBagsValidationVerification = internalMutation({
  args: { failedRunKey: v.string(), jobId: v.string() },
  returns: v.object({ queued: v.boolean(), runKey: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ queued: boolean; runKey?: string }> => {
    const control = await ctx.db
      .query("tokenAlphaControl")
      .withIndex("by_key", (q) => q.eq("key", "pilot"))
      .unique();
    const now = Date.now();
    if (
      control?.enabled !== true ||
      env.ELIZA_RUNTIME_MODE !== "live" ||
      control.operatorBagsValidationVerification !== undefined ||
      !(await validateBagsValidationVerification(
        ctx,
        args.failedRunKey,
        args.jobId,
        now,
      ))
    )
      return { queued: false };
    const runKey = `${args.failedRunKey}:operator-validation-verification-1`;
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
    await ctx.db.patch("tokenAlphaControl", control._id, {
      operatorBagsValidationVerification: {
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

/** One newly approved attempt; never resets or spends an earlier marker. */
export const queueBagsGrammarVerification = internalMutation({
  args: { failedRunKey: v.string(), jobId: v.string() },
  returns: v.object({ queued: v.boolean(), runKey: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ queued: boolean; runKey?: string }> => {
    const control = await ctx.db
      .query("tokenAlphaControl")
      .withIndex("by_key", (q) => q.eq("key", "pilot"))
      .unique();
    const now = Date.now();
    if (
      control?.enabled !== true ||
      env.ELIZA_RUNTIME_MODE !== "live" ||
      control.operatorBagsGrammarVerification !== undefined ||
      !(await validateBagsGrammarVerification(
        ctx,
        args.failedRunKey,
        args.jobId,
        now,
      ))
    )
      return { queued: false };
    const runKey = `${args.failedRunKey}:operator-grammar-verification-1`;
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
    await ctx.db.patch("tokenAlphaControl", control._id, {
      operatorBagsGrammarVerification: {
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
