import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";

const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    // A model attempt's timeout starts before it reaches the laptop queue.
    // Keep one publication workflow active so queue wait cannot consume the
    // generation budget for another workflow on the single llama.cpp slot.
    maxParallelism: 1,
    retryActionsByDefault: true,
    defaultRetryBehavior: {
      maxAttempts: 2,
      initialBackoffMs: 60_000,
      base: 3,
    },
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

type PublicationResult =
  | {
      status: "published";
      categorySlug: string;
      threadSlug: string;
      title: string;
    }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

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
      retry: { maxAttempts: 2, initialBackoffMs: 60_000, base: 3 },
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
  const agent = await ctx.db
    .query("forumAgents")
    .withIndex("by_slug", (q) => q.eq("slug", args.agentSlug))
    .unique();
  if (agent === null || !agent.enabled || agent.dailyPostTarget < 1) {
    return { ok: false as const, reason: "agent-disabled" };
  }

  const runKey = `${args.agentSlug}:${args.runDate}:${args.slot}`;
  const existing = await ctx.db
    .query("forumAgentRuns")
    .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
    .unique();
  if (existing?.status === "published") {
    return { ok: false as const, reason: "already-published" };
  }
  if (
    existing?.status === "running" &&
    Date.now() - existing.updatedAt < 30 * 60 * 1_000
  ) {
    return { ok: false as const, reason: "already-running" };
  }

  const todayRuns = await ctx.db
    .query("forumAgentRuns")
    .withIndex("by_agentSlug_and_runDate_and_slot", (q) =>
      q.eq("agentSlug", args.agentSlug).eq("runDate", args.runDate),
    )
    .take(40);
  if (
    todayRuns.filter((run) => run.status === "published").length >=
    agent.dailyPostTarget
  ) {
    return { ok: false as const, reason: "daily-target" };
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
