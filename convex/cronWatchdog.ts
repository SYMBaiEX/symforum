import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  env,
  internalAction,
  internalMutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { requireSiteAdmin } from "./authz";

const watchdogEnv = env as typeof env & {
  CRON_WATCHDOG_ENABLED: string | undefined;
};
const RUN_HISTORY_CAP = 30;
const SUMMARY_LIMIT = 20;

const jobKeyValidator = v.union(
  v.literal("evidence-cisa-kev"),
  v.literal("evidence-github-advisories"),
  v.literal("evidence-github-releases"),
  v.literal("evidence-crossref"),
  v.literal("evidence-first-party"),
  v.literal("evidence-dataset-snapshots"),
  v.literal("evidence-nvd-cves"),
  v.literal("evidence-nvd-change-history"),
  v.literal("evidence-artifact-cleanup"),
  v.literal("evidence-claim-revision-cleanup"),
  v.literal("evidence-health"),
  v.literal("evidence-citation-benchmark"),
  v.literal("semantic-cleanup"),
  v.literal("web-vitals-slo"),
  v.literal("newsletter-schedule"),
  v.literal("evidence-webhook-recovery"),
  v.literal("forum-suki-reply-recovery"),
  v.literal("forum-belle-reply-recovery"),
);
const statusValidator = v.union(
  v.literal("running"),
  v.literal("healthy"),
  v.literal("failed"),
  v.literal("stale"),
  v.literal("missing"),
);
const actionJobKeyValidator = v.union(
  v.literal("evidence-cisa-kev"),
  v.literal("evidence-github-advisories"),
  v.literal("evidence-github-releases"),
  v.literal("evidence-crossref"),
  v.literal("evidence-first-party"),
  v.literal("evidence-dataset-snapshots"),
  v.literal("evidence-nvd-cves"),
  v.literal("evidence-nvd-change-history"),
  v.literal("newsletter-schedule"),
  v.literal("forum-suki-reply-recovery"),
  v.literal("forum-belle-reply-recovery"),
);
const mutationJobKeyValidator = v.union(
  v.literal("evidence-artifact-cleanup"),
  v.literal("evidence-claim-revision-cleanup"),
  v.literal("evidence-health"),
  v.literal("evidence-citation-benchmark"),
  v.literal("semantic-cleanup"),
  v.literal("web-vitals-slo"),
  v.literal("evidence-webhook-recovery"),
);
type JobKey = typeof jobKeyValidator.type;
type ActionJobKey = typeof actionJobKeyValidator.type;
type MutationJobKey = typeof mutationJobKeyValidator.type;
type WatchdogStatus = "healthy" | "failed" | "stale" | "missing";

const startRunRef = makeFunctionReference<
  "mutation",
  { jobKey: JobKey; now?: number },
  { runId: string; startedAt: number }
>("cronWatchdog:startRun");
const completeRunRef = makeFunctionReference<
  "mutation",
  {
    jobKey: JobKey;
    runId: string;
    succeeded: boolean;
    startedAt: number;
    failureClass?: string;
    now?: number;
  },
  null
>("cronWatchdog:completeRun");

const actionRefs = {
  cisa: makeFunctionReference<"action", Record<string, never>, unknown>(
    "evidenceIngestion:syncCisaKev",
  ),
  githubAdvisories: makeFunctionReference<
    "action",
    Record<string, never>,
    unknown
  >("evidenceIngestion:syncGithubAdvisories"),
  githubReleases: makeFunctionReference<
    "action",
    Record<string, never>,
    unknown
  >("evidenceIngestion:syncGithubReleases"),
  crossref: makeFunctionReference<"action", Record<string, never>, unknown>(
    "evidenceIngestion:syncCrossref",
  ),
  firstParty: makeFunctionReference<"action", Record<string, never>, unknown>(
    "evidenceFirstParty:sync",
  ),
  datasetSnapshots: makeFunctionReference<
    "action",
    Record<string, never>,
    unknown
  >("evidenceJobActions:materializeAllDatasetSnapshots"),
  nvdCves: makeFunctionReference<"action", Record<string, never>, unknown>(
    "evidenceNvd:syncCves",
  ),
  nvdHistory: makeFunctionReference<"action", Record<string, never>, unknown>(
    "evidenceNvd:syncChangeHistory",
  ),
  sukiReplies: makeFunctionReference<"action", Record<string, never>, unknown>(
    "sukiForumReplyAgent:runReplySweep",
  ),
  belleReplies: makeFunctionReference<"action", Record<string, never>, unknown>(
    "sukiForumReplyAgent:runBelleReplySweep",
  ),
  newsletterSchedule: makeFunctionReference<
    "action",
    Record<string, never>,
    unknown
  >("dailyNewsletter:checkDailyNewsletterSchedule"),
} as const;
const mutationRefs = {
  artifactCleanup: makeFunctionReference<
    "mutation",
    Record<string, never>,
    unknown
  >("evidenceJobs:cleanupExpiredArtifacts"),
  claimCleanup: makeFunctionReference<"mutation", { limit: number }, unknown>(
    "evidence:cleanupExpiredClaimRevisions",
  ),
  health: makeFunctionReference<"mutation", Record<string, never>, unknown>(
    "evidenceHealth:check",
  ),
  benchmark: makeFunctionReference<"mutation", Record<string, never>, unknown>(
    "evidenceBenchmarks:runDailyCitationCoverage",
  ),
  semanticCleanup: makeFunctionReference<
    "mutation",
    Record<string, never>,
    unknown
  >("semanticSearch:cleanupExpiredOperations"),
  webVitalsSlo: makeFunctionReference<
    "mutation",
    Record<string, never>,
    unknown
  >("operationalSlo:evaluate"),
  webhookRecovery: makeFunctionReference<
    "mutation",
    { limit: number },
    unknown
  >("evidenceWebhooks:recoverPendingDeliveries"),
} as const;

const STALENESS_MS: Record<JobKey, number> = {
  "evidence-cisa-kev": 3 * 60 * 60 * 1_000,
  "evidence-github-advisories": 8 * 60 * 60 * 1_000,
  "evidence-github-releases": 4 * 60 * 60 * 1_000,
  "evidence-crossref": 14 * 60 * 60 * 1_000,
  "evidence-first-party": 6 * 60 * 60 * 1_000,
  "evidence-dataset-snapshots": 30 * 60 * 60 * 1_000,
  "evidence-nvd-cves": 30 * 60 * 1_000,
  "evidence-nvd-change-history": 30 * 60 * 1_000,
  "evidence-artifact-cleanup": 2 * 60 * 60 * 1_000,
  "evidence-claim-revision-cleanup": 30 * 60 * 60 * 1_000,
  "evidence-health": 2 * 60 * 60 * 1_000,
  "evidence-citation-benchmark": 30 * 60 * 60 * 1_000,
  "semantic-cleanup": 15 * 60 * 1_000,
  "web-vitals-slo": 2 * 60 * 60 * 1_000,
  "newsletter-schedule": 30 * 60 * 1_000,
  "evidence-webhook-recovery": 15 * 60 * 1_000,
  "forum-suki-reply-recovery": 2 * 60 * 60 * 1_000,
  "forum-belle-reply-recovery": 2 * 60 * 60 * 1_000,
};
const JOB_KEYS = Object.keys(STALENESS_MS) as JobKey[];

function enabled() {
  return watchdogEnv.CRON_WATCHDOG_ENABLED?.trim().toLowerCase() === "true";
}
function failureClass(error: unknown) {
  return error instanceof Error && /^[A-Za-z0-9_.-]{1,120}$/.test(error.name)
    ? error.name
    : "CronJobFailure";
}
function safeFailureClass(value: string | undefined) {
  return value !== undefined && /^[A-Za-z0-9_.-]{1,120}$/.test(value)
    ? value
    : "CronJobFailure";
}
function resultRecord(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export class CronTargetReportedFailure extends Error {
  override name = "CronTargetReportedFailure";
}
export function assertCronTargetSucceeded(value: unknown) {
  const result = resultRecord(value);
  if (
    result?.ok === false ||
    result?.healthy === false ||
    result?.success === false ||
    result?.status === "degraded" ||
    result?.status === "failed"
  ) {
    throw new CronTargetReportedFailure(
      "Critical cron target reported an unsuccessful result.",
    );
  }
}
function statusFor(
  heartbeat: {
    status: "running" | "healthy" | "failed";
    lastSucceededAt?: number;
    lastFailedAt?: number;
  } | null,
  jobKey: JobKey,
  now: number,
): { status: WatchdogStatus; lastCompletedAt: number | null } {
  const lastCompletedAt =
    heartbeat?.lastSucceededAt ?? heartbeat?.lastFailedAt ?? null;
  if (heartbeat === null) return { status: "missing", lastCompletedAt };
  if (heartbeat.status === "failed")
    return { status: "failed", lastCompletedAt };
  if (
    heartbeat.status === "running" ||
    lastCompletedAt === null ||
    now - lastCompletedAt > STALENESS_MS[jobKey]
  )
    return { status: "stale", lastCompletedAt };
  return { status: "healthy", lastCompletedAt };
}

export async function executeActionTarget(
  ctx: Pick<ActionCtx, "runAction">,
  jobKey: ActionJobKey,
) {
  switch (jobKey) {
    case "evidence-cisa-kev":
      return await ctx.runAction(actionRefs.cisa, {});
    case "evidence-github-advisories":
      return await ctx.runAction(actionRefs.githubAdvisories, {});
    case "evidence-github-releases":
      return await ctx.runAction(actionRefs.githubReleases, {});
    case "evidence-crossref":
      return await ctx.runAction(actionRefs.crossref, {});
    case "evidence-first-party":
      return await ctx.runAction(actionRefs.firstParty, {});
    case "evidence-dataset-snapshots":
      return await ctx.runAction(actionRefs.datasetSnapshots, {});
    case "evidence-nvd-cves":
      return await ctx.runAction(actionRefs.nvdCves, {});
    case "evidence-nvd-change-history":
      return await ctx.runAction(actionRefs.nvdHistory, {});
    case "newsletter-schedule":
      return await ctx.runAction(actionRefs.newsletterSchedule, {});
    case "forum-suki-reply-recovery":
      return await ctx.runAction(actionRefs.sukiReplies, {});
    case "forum-belle-reply-recovery":
      return await ctx.runAction(actionRefs.belleReplies, {});
  }
}

export async function executeMutationTarget(
  ctx: Pick<ActionCtx, "runMutation">,
  jobKey: MutationJobKey,
) {
  switch (jobKey) {
    case "evidence-artifact-cleanup":
      return await ctx.runMutation(mutationRefs.artifactCleanup, {});
    case "evidence-claim-revision-cleanup":
      return await ctx.runMutation(mutationRefs.claimCleanup, { limit: 100 });
    case "evidence-health":
      return await ctx.runMutation(mutationRefs.health, {});
    case "evidence-citation-benchmark":
      return await ctx.runMutation(mutationRefs.benchmark, {});
    case "semantic-cleanup":
      return await ctx.runMutation(mutationRefs.semanticCleanup, {});
    case "web-vitals-slo":
      return await ctx.runMutation(mutationRefs.webVitalsSlo, {});
    case "evidence-webhook-recovery":
      return await ctx.runMutation(mutationRefs.webhookRecovery, { limit: 50 });
  }
}

export const startRun = internalMutation({
  args: { jobKey: jobKeyValidator, now: v.optional(v.number()) },
  returns: v.object({
    runId: v.id("cronJobRunSummaries"),
    startedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const heartbeat = await ctx.db
      .query("cronJobHeartbeats")
      .withIndex("by_jobKey", (q) => q.eq("jobKey", args.jobKey))
      .unique();
    let runSequence: number;
    if (heartbeat?.historyMigratedAt === undefined) {
      const retained = await ctx.db
        .query("cronJobRunSummaries")
        .withIndex("by_jobKey_and_startedAt", (q) =>
          q.eq("jobKey", args.jobKey),
        )
        .order("desc")
        .take(RUN_HISTORY_CAP);
      retained.reverse();
      for (let index = 0; index < retained.length; index += 1) {
        await ctx.db.patch("cronJobRunSummaries", retained[index]!._id, {
          runSequence: index + 1,
        });
      }
      runSequence = retained.length + 1;
    } else {
      runSequence = (heartbeat.nextRunSequence ?? 0) + 1;
    }
    const runId = await ctx.db.insert("cronJobRunSummaries", {
      jobKey: args.jobKey,
      runSequence,
      startedAt: now,
      outcome: "running",
    });
    const expiredSequence = runSequence - RUN_HISTORY_CAP;
    if (expiredSequence > 0) {
      const expired = await ctx.db
        .query("cronJobRunSummaries")
        .withIndex("by_jobKey_and_runSequence", (q) =>
          q.eq("jobKey", args.jobKey).eq("runSequence", expiredSequence),
        )
        .unique();
      if (expired !== null)
        await ctx.db.delete("cronJobRunSummaries", expired._id);
    }
    const values = {
      jobKey: args.jobKey,
      status: "running" as const,
      currentRunId: runId,
      lastStartedAt: now,
      consecutiveFailures: heartbeat?.consecutiveFailures ?? 0,
      nextRunSequence: runSequence,
      historyMigratedAt: heartbeat?.historyMigratedAt ?? now,
      updatedAt: now,
    };
    if (heartbeat === null) await ctx.db.insert("cronJobHeartbeats", values);
    else await ctx.db.patch("cronJobHeartbeats", heartbeat._id, values);
    return { runId, startedAt: now };
  },
});

export const completeRun = internalMutation({
  args: {
    jobKey: jobKeyValidator,
    runId: v.id("cronJobRunSummaries"),
    succeeded: v.boolean(),
    startedAt: v.number(),
    failureClass: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const heartbeat = await ctx.db
      .query("cronJobHeartbeats")
      .withIndex("by_jobKey", (q) => q.eq("jobKey", args.jobKey))
      .unique();
    if (heartbeat === null) throw new Error("Cron heartbeat is missing.");
    const run = await ctx.db.get("cronJobRunSummaries", args.runId);
    if (
      run === null ||
      run.jobKey !== args.jobKey ||
      run.startedAt !== args.startedAt
    ) {
      throw new Error("Cron run does not match its heartbeat.");
    }
    const durationMs = Math.max(0, now - args.startedAt);
    await ctx.db.patch("cronJobRunSummaries", args.runId, {
      completedAt: now,
      outcome: args.succeeded ? "succeeded" : "failed",
      durationMs,
      ...(args.succeeded
        ? {}
        : { failureClass: safeFailureClass(args.failureClass) }),
    });
    if (
      heartbeat.currentRunId === args.runId &&
      heartbeat.lastStartedAt === args.startedAt
    ) {
      await ctx.db.patch("cronJobHeartbeats", heartbeat._id, {
        status: args.succeeded ? "healthy" : "failed",
        lastDurationMs: durationMs,
        ...(args.succeeded
          ? { lastSucceededAt: now, consecutiveFailures: 0 }
          : {
              lastFailedAt: now,
              consecutiveFailures: heartbeat.consecutiveFailures + 1,
            }),
        updatedAt: now,
      });
    }
    return null;
  },
});

export const runActionJob = internalAction({
  args: { jobKey: actionJobKeyValidator },
  returns: v.object({ executed: v.boolean(), monitored: v.boolean() }),
  handler: async (ctx, args) => {
    if (!enabled()) {
      const result = await executeActionTarget(ctx, args.jobKey);
      assertCronTargetSucceeded(result);
      return { executed: true, monitored: false };
    }
    const { runId, startedAt } = await ctx.runMutation(startRunRef, {
      jobKey: args.jobKey,
    });
    try {
      const result = await executeActionTarget(ctx, args.jobKey);
      assertCronTargetSucceeded(result);
      await ctx.runMutation(completeRunRef, {
        jobKey: args.jobKey,
        runId,
        startedAt,
        succeeded: true,
      });
      return { executed: true, monitored: true };
    } catch (error) {
      await ctx.runMutation(completeRunRef, {
        jobKey: args.jobKey,
        runId,
        startedAt,
        succeeded: false,
        failureClass: failureClass(error),
      });
      if (error instanceof CronTargetReportedFailure)
        return { executed: true, monitored: true };
      throw error;
    }
  },
});

export const runMutationJob = internalAction({
  args: { jobKey: mutationJobKeyValidator },
  returns: v.object({ executed: v.boolean(), monitored: v.boolean() }),
  handler: async (ctx, args) => {
    if (!enabled()) {
      const result = await executeMutationTarget(ctx, args.jobKey);
      assertCronTargetSucceeded(result);
      return { executed: true, monitored: false };
    }
    const { runId, startedAt } = await ctx.runMutation(startRunRef, {
      jobKey: args.jobKey,
    });
    try {
      const result = await executeMutationTarget(ctx, args.jobKey);
      assertCronTargetSucceeded(result);
      await ctx.runMutation(completeRunRef, {
        jobKey: args.jobKey,
        runId,
        startedAt,
        succeeded: true,
      });
      return { executed: true, monitored: true };
    } catch (error) {
      await ctx.runMutation(completeRunRef, {
        jobKey: args.jobKey,
        runId,
        startedAt,
        succeeded: false,
        failureClass: failureClass(error),
      });
      if (error instanceof CronTargetReportedFailure)
        return { executed: true, monitored: true };
      throw error;
    }
  },
});

export const evaluate = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({
    enabled: v.boolean(),
    healthy: v.number(),
    unhealthy: v.number(),
    states: v.array(
      v.object({
        jobKey: jobKeyValidator,
        status: statusValidator,
        lastCompletedAt: v.union(v.number(), v.null()),
        consecutiveFailures: v.number(),
        lastEvaluatedAt: v.union(v.number(), v.null()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    if (!enabled())
      return {
        enabled: false,
        healthy: 0,
        unhealthy: JOB_KEYS.length,
        states: JOB_KEYS.map((jobKey) => ({
          jobKey,
          status: "missing" as const,
          lastCompletedAt: null,
          consecutiveFailures: 0,
          lastEvaluatedAt: null,
        })),
      };
    const states = await Promise.all(
      JOB_KEYS.map(async (jobKey) => {
        const heartbeat = await ctx.db
          .query("cronJobHeartbeats")
          .withIndex("by_jobKey", (q) => q.eq("jobKey", jobKey))
          .unique();
        return {
          jobKey,
          ...statusFor(heartbeat, jobKey, now),
          consecutiveFailures: heartbeat?.consecutiveFailures ?? 0,
          heartbeat,
        };
      }),
    );
    let healthy = 0;
    for (const state of states) {
      if (state.heartbeat !== null)
        await ctx.db.patch("cronJobHeartbeats", state.heartbeat._id, {
          evaluatedStatus: state.status,
          lastEvaluatedAt: now,
          updatedAt: now,
        });
      if (state.status === "healthy") {
        healthy += 1;
        const openLog = state.heartbeat?.openLogId
          ? await ctx.db.get("systemLogs", state.heartbeat.openLogId)
          : await ctx.db
              .query("systemLogs")
              .withIndex("by_fingerprint_and_createdAt", (q) =>
                q.eq("fingerprint", `cron-watchdog:${state.jobKey}:unhealthy`),
              )
              .order("desc")
              .first();
        if (openLog !== null && openLog.status !== "resolved")
          await ctx.db.patch("systemLogs", openLog._id, {
            status: "resolved",
            updatedAt: now,
            lastSeenAt: now,
          });
        continue;
      }
      const fingerprint = `cron-watchdog:${state.jobKey}:unhealthy`;
      const existing = await ctx.db
        .query("systemLogs")
        .withIndex("by_fingerprint_and_createdAt", (q) =>
          q.eq("fingerprint", fingerprint),
        )
        .order("desc")
        .first();
      const logId =
        existing !== null && existing.status !== "resolved"
          ? existing._id
          : await ctx.db.insert("systemLogs", {
              createdAt: now,
              updatedAt: now,
              lastSeenAt: now,
              occurrences: 1,
              level: "warn",
              status: "open",
              source: "convex",
              scope: "cron-watchdog",
              eventType: "critical_cron_unhealthy",
              message: `Critical cron ${state.jobKey} is ${state.status}.`,
              fingerprint,
              component: "cronWatchdog",
              action: "evaluate",
              metadataJson: JSON.stringify({
                jobKey: state.jobKey,
                status: state.status,
                consecutiveFailures: state.consecutiveFailures,
              }),
            });
      if (existing !== null && existing.status !== "resolved")
        await ctx.db.patch("systemLogs", existing._id, {
          lastSeenAt: now,
          updatedAt: now,
          occurrences: existing.occurrences + 1,
        });
      if (state.heartbeat !== null && state.heartbeat.openLogId !== logId)
        await ctx.db.patch("cronJobHeartbeats", state.heartbeat._id, {
          openLogId: logId,
          updatedAt: now,
        });
    }
    return {
      enabled: true,
      healthy,
      unhealthy: states.length - healthy,
      states: states.map(({ heartbeat: _heartbeat, ...state }) => ({
        ...state,
        lastEvaluatedAt: now,
      })),
    };
  },
});

export const summaryAdmin = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    jobs: v.array(
      v.object({
        jobKey: jobKeyValidator,
        status: statusValidator,
        lastCompletedAt: v.union(v.number(), v.null()),
        consecutiveFailures: v.number(),
        lastEvaluatedAt: v.union(v.number(), v.null()),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);
    const jobs = await Promise.all(
      JOB_KEYS.slice(0, SUMMARY_LIMIT).map(async (jobKey) => {
        const heartbeat = await ctx.db
          .query("cronJobHeartbeats")
          .withIndex("by_jobKey", (q) => q.eq("jobKey", jobKey))
          .unique();
        return {
          jobKey,
          status: heartbeat?.evaluatedStatus ?? "missing",
          lastCompletedAt:
            heartbeat?.lastSucceededAt ?? heartbeat?.lastFailedAt ?? null,
          consecutiveFailures: heartbeat?.consecutiveFailures ?? 0,
          lastEvaluatedAt: heartbeat?.lastEvaluatedAt ?? null,
        };
      }),
    );
    return { enabled: enabled(), jobs };
  },
});
