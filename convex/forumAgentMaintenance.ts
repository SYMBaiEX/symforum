"use node";

import { WorkflowManager, type WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import { FORUM_AGENT_ROSTER } from "./forumAgentRoster";

const workflow = new WorkflowManager(components.workflow);
const LEGACY_THREAD_BATCH_SIZE = 100;
const LEGACY_RESOURCE_DELAY_MS = 24 * 60 * 60 * 1_000;

type LegacyResource = {
  runId: Id<"forumAgentRuns">;
  agentThreadId?: string;
  workflowId?: string;
};

type LegacyResourceCleanupResult = {
  inspected: number;
  clearedAgentThreads: number;
  clearedWorkflows: number;
  orphanedAgentThreadsQueued: number;
  deletedReplySweepTelemetry: number;
};

type ComponentThread = {
  _id: string;
  _creationTime: number;
  title?: string;
  summary?: string;
};

export function isLegacyEditorialThread(
  thread: ComponentThread,
  cutoff: number,
) {
  return (
    thread._creationTime < cutoff &&
    / editorial run \d{4}-\d{2}-\d{2} \/ \d+$/.test(thread.title ?? "") &&
    (thread.summary ?? "").startsWith("Durable editorial memory for ")
  );
}

export const cleanupLegacyResources = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<LegacyResourceCleanupResult> => {
    const telemetry = await ctx.runMutation(
      internal.forum.cleanupForumReplySweepTelemetry,
      args.now === undefined ? {} : { now: args.now },
    );
    const rows: LegacyResource[] = await ctx.runQuery(
      internal.forumAgentMaintenanceData.readLegacyResourcesForCleanup,
      args.now === undefined ? {} : { now: args.now },
    );
    let clearedAgentThreads = 0;
    let clearedWorkflows = 0;

    for (const row of rows) {
      let clearAgentThread = row.agentThreadId === undefined;
      let clearWorkflow = row.workflowId === undefined;
      if (row.agentThreadId !== undefined) {
        try {
          await ctx.runMutation(
            components.agent.threads.deleteAllForThreadIdAsync,
            {
              threadId: row.agentThreadId,
              limit: 100,
            },
          );
          clearAgentThread = true;
          clearedAgentThreads += 1;
        } catch (error) {
          console.warn("Legacy forum agent thread cleanup failed", {
            runId: row.runId,
            error: safeError(error),
          });
        }
      }
      if (row.workflowId !== undefined) {
        try {
          clearWorkflow = await workflow.cleanup(
            ctx,
            row.workflowId as WorkflowId,
          );
          if (clearWorkflow) clearedWorkflows += 1;
        } catch (error) {
          console.warn("Completed forum workflow cleanup failed", {
            runId: row.runId,
            error: safeError(error),
          });
        }
      }
      if (clearAgentThread || clearWorkflow) {
        await ctx.runMutation(
          internal.forumAgentMaintenanceData.clearLegacyResourceReferences,
          {
            runId: row.runId,
            clearAgentThread,
            clearWorkflow,
          },
        );
      }
    }

    const orphanedAgentThreadsQueued = await queueOrphanedThreadCleanup(
      ctx,
      (args.now ?? Date.now()) - LEGACY_RESOURCE_DELAY_MS,
    );

    if (
      (rows.length >= 25 && clearedAgentThreads + clearedWorkflows > 0) ||
      orphanedAgentThreadsQueued >= LEGACY_THREAD_BATCH_SIZE
    ) {
      await ctx.scheduler.runAfter(
        orphanedAgentThreadsQueued >= LEGACY_THREAD_BATCH_SIZE ? 60_000 : 1_000,
        internal.forumAgentMaintenance.cleanupLegacyResources,
        args.now === undefined ? {} : { now: args.now },
      );
    }
    return {
      inspected: rows.length,
      clearedAgentThreads,
      clearedWorkflows,
      orphanedAgentThreadsQueued,
      deletedReplySweepTelemetry: telemetry.deleted,
    };
  },
});

async function queueOrphanedThreadCleanup(ctx: ActionCtx, cutoff: number) {
  for (const entry of FORUM_AGENT_ROSTER) {
    const result = await ctx.runQuery(
      components.agent.threads.listThreadsByUserId,
      {
        userId: entry.slug,
        order: "asc",
        paginationOpts: { cursor: null, numItems: LEGACY_THREAD_BATCH_SIZE },
      },
    );
    const threads = result.page.filter((thread) =>
      isLegacyEditorialThread(thread, cutoff),
    );
    if (threads.length === 0) continue;
    for (let offset = 0; offset < threads.length; offset += 10) {
      await Promise.all(
        threads.slice(offset, offset + 10).map((thread) =>
          ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
            threadId: thread._id,
            limit: 100,
          }),
        ),
      );
    }
    return threads.length;
  }
  return 0;
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 240);
}
