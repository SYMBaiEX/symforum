import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import {
  adaptivePublicationSlot,
  forumDailyPublicationLimit,
} from "../lib/forum-agent-cadence";
import { components, internal } from "./_generated/api";
import { env, internalMutation, type MutationCtx } from "./_generated/server";
import { STRUCTURED_CANARY_KEY } from "./aiRoutingControlData";

const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    // One publication workflow at a time keeps spend checks and provider work
    // bounded while avoiding contention on the shared editorial pipeline.
    maxParallelism: 1,
    // Each research action records its outcome before returning. Retrying it
    // here repeats expensive inference after a failed run has already been
    // accounted for, so workflows intentionally make one attempt per slot.
    retryActionsByDefault: false,
  },
});

const rateLimiter = new RateLimiter(components.rateLimiter, {
  forumPublications: {
    kind: "token bucket",
    rate: 12,
    period: HOUR,
    capacity: 4,
  },
});
const STRUCTURED_CANARY_MAX_AGE_MS = 2 * HOUR;
const MAX_FAILED_RUNS_PER_DAY = 12;
const MAX_AGENT_RUNS_PER_DAY_READ = 40;

type StructuredCanaryState = {
  healthy: boolean;
  checkedAt: number;
};

export function structuredCanaryBlockReason(
  canary: StructuredCanaryState | null,
  now: number,
) {
  if (canary === null) return "structured-canary-missing";
  if (!canary.healthy) return "structured-canary-unhealthy";
  if (now - canary.checkedAt > STRUCTURED_CANARY_MAX_AGE_MS)
    return "structured-canary-stale";
  return null;
}

type PublicationResult =
  | {
      status: "published";
      categorySlug: string;
      threadSlug: string;
      title: string;
    }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

type ExistingRunRangeResult<T> =
  { complete: true; existing: T | null } | { complete: false };

function existingRunFromAgentDayRange<T extends { runKey: string }>(
  runs: T[],
  runKey: string,
): ExistingRunRangeResult<T> {
  if (runs.length >= MAX_AGENT_RUNS_PER_DAY_READ) return { complete: false };

  const matchingRuns = runs.filter((run) => run.runKey === runKey);
  if (matchingRuns.length > 1) return { complete: false };

  return { complete: true, existing: matchingRuns[0] ?? null };
}

export async function resolveExistingRunFromAgentDayRange<
  T extends { runKey: string },
>(
  runs: T[],
  runKey: string,
  loadByRunKey: () => Promise<T | null>,
): Promise<T | null> {
  const result = existingRunFromAgentDayRange(runs, runKey);
  return result.complete ? result.existing : await loadByRunKey();
}

export const publishForumSlot = workflow
  .define({
    args: {
      agentSlug: v.string(),
      slot: v.number(),
      runDate: v.string(),
    },
  })
  .handler(async (step, args): Promise<PublicationResult> => {
    const runArgs = {
      slot: args.slot,
      runDate: args.runDate,
      workflowManaged: true,
      workflowId: step.workflowId,
    };
    const options = {
      name: `research-write-publish-${args.agentSlug}-${args.slot}`,
    } as const;
    if (args.agentSlug === "suki") {
      return await step.runAction(
        internal.sukiForumAgent.runDailySlot,
        runArgs,
        options,
      );
    }
    if (args.agentSlug === "belle") {
      return await step.runAction(
        internal.belleForumAgent.runDailySlot,
        runArgs,
        options,
      );
    }
    if (args.agentSlug === "nyx") {
      return await step.runAction(
        internal.nyxForumAgent.runDailySlot,
        runArgs,
        options,
      );
    }
    return await step.runAction(
      internal.rosterForumAgent.runDailySlot,
      { ...runArgs, agentSlug: args.agentSlug },
      options,
    );
  });

export const queuePublication = internalMutation({
  args: {
    agentSlug: v.string(),
    slot: v.number(),
    runDate: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { queued: false; reason?: string; retryAfter?: number }
    | { queued: true; workflowId: string }
  > => {
    const runDate = args.runDate ?? forumDateForTimestamp(Date.now());
    const preflight = await publicationPreflight(ctx, {
      agentSlug: args.agentSlug,
      runDate,
      slot: args.slot,
    });
    if (!preflight.ok) {
      return { queued: false as const, reason: preflight.reason };
    }
    const capacity = await rateLimiter.limit(ctx, "forumPublications", {
      key: args.agentSlug,
    });
    if (!capacity.ok) {
      await ctx.scheduler.runAfter(
        Math.max(30_000, capacity.retryAfter ?? 60_000),
        internal.forumAgentWorkflow.queuePublication,
        { ...args, runDate },
      );
      return { queued: false as const, retryAfter: capacity.retryAfter };
    }
    const workflowId: string = await workflow.start(
      ctx,
      internal.forumAgentWorkflow.publishForumSlot,
      { agentSlug: args.agentSlug, slot: args.slot, runDate },
      { startAsync: true },
    );
    return { queued: true as const, workflowId };
  },
});

async function publicationPreflight(
  ctx: MutationCtx,
  args: { agentSlug: string; runDate: string; slot: number },
) {
  const now = Date.now();
  const agent = await ctx.db
    .query("forumAgents")
    .withIndex("by_slug", (q) => q.eq("slug", args.agentSlug))
    .unique();
  // Roster slots stay statically scheduled so an admin can enable an agent
  // without redeploying crons. Skip dormant slots before reading the shared
  // canary state, which they cannot affect or use.
  if (agent === null || !agent.enabled || agent.dailyPostTarget < 1) {
    return { ok: false as const, reason: "agent-disabled" };
  }

  const dailyLimit = forumDailyPublicationLimit(
    env.FORUM_AGENT_DAILY_PUBLICATION_LIMIT,
  );
  const canary = await ctx.db
    .query("aiOperationalStates")
    .withIndex("by_key", (q) => q.eq("key", STRUCTURED_CANARY_KEY))
    .unique();
  const canaryBlockReason = structuredCanaryBlockReason(canary, now);
  if (canaryBlockReason !== null)
    return { ok: false as const, reason: canaryBlockReason };
  if (
    !adaptivePublicationSlot({
      agentSlug: args.agentSlug,
      runDate: args.runDate,
      slot: args.slot,
      dailyLimit,
    })
  ) {
    return { ok: false as const, reason: "adaptive-cadence" };
  }

  const runKey = `${args.agentSlug}:${args.runDate}:${args.slot}`;
  const todayRuns = await ctx.db
    .query("forumAgentRuns")
    .withIndex("by_agentSlug_and_runDate_and_slot", (q) =>
      q.eq("agentSlug", args.agentSlug).eq("runDate", args.runDate),
    )
    .take(MAX_AGENT_RUNS_PER_DAY_READ);
  const existing = await resolveExistingRunFromAgentDayRange(
    todayRuns,
    runKey,
    () =>
      ctx.db
        .query("forumAgentRuns")
        .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
        .unique(),
  );
  if (existing?.promptVersion?.includes(":alpha-v1:")) {
    return { ok: false as const, reason: "alpha-already-attempted" };
  }
  if (existing?.status === "published") {
    return { ok: false as const, reason: "already-published" };
  }
  if (
    existing?.status === "running" &&
    now - existing.updatedAt < 30 * 60 * 1_000
  ) {
    return { ok: false as const, reason: "already-running" };
  }

  if (
    todayRuns.filter(
      (run) => run.status === "running" || run.status === "published",
    ).length >= agent.dailyPostTarget
  ) {
    return { ok: false as const, reason: "daily-target" };
  }

  const globalRuns = await ctx.db
    .query("forumAgentRuns")
    .withIndex("by_runDate", (q) => q.eq("runDate", args.runDate))
    .take(dailyLimit + MAX_FAILED_RUNS_PER_DAY + 1);
  if (
    globalRuns.filter(
      (run) => run.status === "running" || run.status === "published",
    ).length >= dailyLimit
  ) {
    return { ok: false as const, reason: "global-daily-limit" };
  }
  if (
    globalRuns.filter((run) => run.status === "failed").length >=
    MAX_FAILED_RUNS_PER_DAY
  ) {
    return { ok: false as const, reason: "global-failure-circuit" };
  }
  return { ok: true as const };
}

function forumDateForTimestamp(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}
