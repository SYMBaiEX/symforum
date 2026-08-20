"use node";

import { Agent } from "@convex-dev/agent";
import { WorkflowManager, type WorkflowId } from "@convex-dev/workflow";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible-v3";
import { v } from "convex/values";
import {
  OPENROUTER_DEEPSEEK_FALLBACK_MODEL,
  OPENROUTER_EMBEDDING_MODEL,
} from "../lib/ai-models";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction } from "./_generated/server";

const EMBEDDING_MODEL = OPENROUTER_EMBEDDING_MODEL;
const workflow = new WorkflowManager(components.workflow);

type LegacyResource = {
  runId: Id<"forumAgentRuns">;
  agentThreadId?: string;
  workflowId?: string;
};

type LegacyResourceCleanupResult = {
  inspected: number;
  clearedAgentThreads: number;
  clearedWorkflows: number;
};

function legacyAgent() {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  const openRouter = createOpenAICompatible({
    name: "openrouter",
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": "https://forum.symbaiex.com",
      "X-OpenRouter-Title": "SYMBiEX Forum Agents",
    },
  });
  return new Agent(components.agent, {
    name: "Legacy Forum Editorial Cleanup",
    // Thread deletion does not generate editorial content, but the Agent
    // component still requires a language model. Keep this maintenance path
    // on the same reviewed OpenRouter/DeepSeek fallback boundary as the app.
    languageModel: openRouter(OPENROUTER_DEEPSEEK_FALLBACK_MODEL),
    embeddingModel: openRouter.embeddingModel(EMBEDDING_MODEL),
  });
}

export const cleanupLegacyResources = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<LegacyResourceCleanupResult> => {
    const rows: LegacyResource[] = await ctx.runQuery(
      internal.forumAgentMaintenanceData.readLegacyResourcesForCleanup,
      args.now === undefined ? {} : { now: args.now },
    );
    const agent = legacyAgent();
    let clearedAgentThreads = 0;
    let clearedWorkflows = 0;

    for (const row of rows) {
      let clearAgentThread = row.agentThreadId === undefined;
      let clearWorkflow = row.workflowId === undefined;
      if (row.agentThreadId !== undefined && agent !== null) {
        try {
          await agent.deleteThreadAsync(ctx, {
            threadId: row.agentThreadId,
            pageSize: 100,
          });
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

    if (rows.length >= 25 && clearedAgentThreads + clearedWorkflows > 0) {
      await ctx.scheduler.runAfter(
        1_000,
        internal.forumAgentMaintenance.cleanupLegacyResources,
        args.now === undefined ? {} : { now: args.now },
      );
    }
    return {
      inspected: rows.length,
      clearedAgentThreads,
      clearedWorkflows,
    };
  },
});

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 240);
}
