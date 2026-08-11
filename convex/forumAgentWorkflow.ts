import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    // Keep Muse saturated without putting multiple long generations behind
    // the laptop's single active inference slot. One workflow can research
    // while the other is generating or waiting in the model queue.
    maxParallelism: 2,
    retryActionsByDefault: true,
    defaultRetryBehavior: {
      maxAttempts: 3,
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
      retry: { maxAttempts: 3, initialBackoffMs: 60_000, base: 3 },
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
    | { queued: false; retryAfter?: number }
    | { queued: true; workflowId: string }
  > => {
    const runDate = args.runDate ?? forumDateForTimestamp(Date.now());
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
