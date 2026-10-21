"use node";

import { generateText, Output } from "ai";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { runWithModelFallback } from "../lib/ai-model-routing";
import { estimatePromptInputTokens } from "../lib/ai-model-costs";
import { openRouterStructuredOutputBudget } from "../lib/ai-models";
import { shadowInputHash } from "../lib/eliza-shadow-contract";
import { modelGenerationSettings, modelInstructions } from "../lib/openrouter-model-profile";
import { convexModelRoutingConfig } from "./modelRouting";
import {
  applyForumReplyEvidenceReview,
  assertAiSourceReplyGrounding,
  enqueueSukiShadowComparison,
  fetchForumReplyEvidence,
  replyInstructions,
  reviewForumReplyEvidence,
  sukiReplyDecisionSchema,
  sukiReplyPrompt,
  validateForumReplyEvidence,
  validateSukiReplyDecision,
  type ForumReplyPromptCandidate,
} from "./sukiForumReplyAgent";

type Kind = "suki-reply" | "belle-newsletter";
type PilotStatus = "reserved" | "completed" | "blocked" | "failed";
type Summary = {
  nonce: string; kind: Kind; sourceKey: string; status: PilotStatus;
  sourceHash?: string; sourceCount?: number;
  shadowJobId?: Id<"elizaShadowJobs">; shadowStatus?: string;
  baselineDecision?: string; errorCode?: string;
};
const summaryValidator = v.object({
  nonce: v.string(),
  kind: v.union(v.literal("suki-reply"), v.literal("belle-newsletter")),
  sourceKey: v.string(),
  status: v.union(v.literal("reserved"), v.literal("completed"), v.literal("blocked"), v.literal("failed")),
  sourceHash: v.optional(v.string()), sourceCount: v.optional(v.number()),
  shadowJobId: v.optional(v.id("elizaShadowJobs")), shadowStatus: v.optional(v.string()),
  baselineDecision: v.optional(v.string()), errorCode: v.optional(v.string()),
});
const resultValidator = v.object({ duplicate: v.boolean(), run: summaryValidator });
const reserveRef = makeFunctionReference<"mutation", {
  nonce: string; kind: Kind; sourceKey: string;
}, { duplicate: boolean; run: Summary }>("elizaPilotValidationData:reserve");
const finishRef = makeFunctionReference<"mutation", {
  nonce: string; status: Exclude<PilotStatus, "reserved">;
  sourceHash?: string; sourceCount?: number;
  shadowJobId?: Id<"elizaShadowJobs">; shadowStatus?: string;
  baselineDecision?: string; errorCode?: string;
}, Summary>("elizaPilotValidationData:finish");
const readPublicThreadRef = makeFunctionReference<"query", { threadId: Id<"forumThreads"> },
  ForumReplyPromptCandidate | null>("elizaPilotValidationData:readPublicThread");
const readSnapshotRef = makeFunctionReference<"query", { snapshotDate: string; limit: number }, {
  snapshot: { snapshotDate: string; status: "running" | "complete" | "failed"; completedAt?: number } | null;
  stories: Array<{ hnItemId: number; title: string; rank: number }>;
}>("news:readIndexedSnapshot");
const generateDailyRef = makeFunctionReference<"action", {
  runDate: string; snapshotDate: string; siteUrl: string;
  shadowSourceRunKey: string; forceLegacyGeneration?: boolean; forceElizaRuntimeGeneration?: boolean;
}, {
  subject: string; storyCount: number; topStoryIds: number[];
  shadowEnqueue?: { status: "queued" | "disabled" | "duplicate" | "limited"; jobId?: Id<"elizaShadowJobs"> };
}>("newsletterAgent:generateDailySignal");

/** One real public source and comparison; optional forced Eliza path never publishes. */
export const validateSuki = internalAction({
  args: { nonce: v.string(), threadId: v.id("forumThreads"), useElizaRuntime: v.optional(v.boolean()) },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const reserved = await ctx.runMutation(reserveRef, {
      nonce: args.nonce, kind: "suki-reply", sourceKey: `thread:${args.threadId}${args.useElizaRuntime ? ":eliza" : ""}`,
    });
    if (reserved.duplicate) return reserved;
    try {
      const candidate = await ctx.runQuery(readPublicThreadRef, { threadId: args.threadId });
      if (!candidate || candidate.sourceBody.trim().length < 18) {
        return done(ctx, args.nonce, "blocked", "public_source_unavailable");
      }
      const sourceHash = await shadowInputHash(JSON.stringify(candidate));
      const evidence = await fetchForumReplyEvidence(candidate);
      const prompt = sukiReplyPrompt(candidate, "Suki", evidence);
      const routing = await convexModelRoutingConfig(ctx, {
        correlationId: `pilot:suki:${args.nonce}`, runtimeScope: "forum-newsletter", elizaRuntime: args.useElizaRuntime ? "force" : "off",
      });
      if (!routing.openRouterApiKey?.trim()) {
        return done(ctx, args.nonce, "blocked", "baseline_model_unconfigured", sourceHash, 1);
      }
      const started = Date.now();
      const generation = await runWithModelFallback(routing, {
        stage: "suki:forum-reply", correlationId: `pilot:suki:${args.nonce}`,
        feature: "forum-reply", agent: "suki", totalTimeoutMs: 90_000,
        estimatedInputTokens: estimatePromptInputTokens(prompt),
        maxOutputTokens: route => openRouterStructuredOutputBudget(route.modelId, 1_400),
        run: async (route, signal) => await generateText({
          model: route.model,
          system: modelInstructions(route.provider, "reply", replyInstructions("suki")),
          prompt,
          output: Output.object({ schema: sukiReplyDecisionSchema }),
          maxOutputTokens: openRouterStructuredOutputBudget(route.modelId, 1_400),
          abortSignal: signal,
          providerOptions: route.providerOptions,
          ...modelGenerationSettings(route.provider, "reply"),
          maxRetries: 0,
        }),
      });
      const generated = generation.value;
      await ctx.runMutation(internal.forumAgentEditorialData.recordUsage, {
        runKey: `pilot:suki:${args.nonce}`,
        reservationKey: generation.route.reservationKey,
        reservationModel: generation.route.reservationModel,
        agentSlug: "suki", stage: "reply",
        model: generation.route.persistedModel,
        servedModel: generated.response.modelId,
        providerReportedCostMicroUsd: generation.route.providerReportedCostMicroUsd,
        categorySlug: candidate.categorySlug,
        inputTokens: generated.usage.inputTokens,
        outputTokens: generated.usage.outputTokens,
        durationMs: Date.now() - started,
      });
      let decision = validateForumReplyEvidence(
        validateSukiReplyDecision(generated.output), evidence,
      );
      if (candidate.authorIsAgent && decision.decision === "reply")
        assertAiSourceReplyGrounding(decision.body, candidate.sourceBody, evidence);
      let review: {
        approved: boolean; issues: string[]; model: string;
        servedModel?: string; inputTokens?: number; outputTokens?: number; durationMs: number;
      } | undefined;
      if (decision.decision === "reply") {
        const reviewStarted = Date.now();
        const reviewed = await reviewForumReplyEvidence(routing, {
          candidate, decision, evidence, agentSlug: "suki",
          replyRunKey: `pilot:suki:${args.nonce}:review`, onAttempt: async () => {},
        });
        await ctx.runMutation(internal.forumAgentEditorialData.recordUsage, {
          runKey: `pilot:suki:${args.nonce}:review`,
          reservationKey: reviewed.route.reservationKey,
          reservationModel: reviewed.route.reservationModel,
          agentSlug: "suki", stage: "research",
          model: reviewed.route.persistedModel,
          servedModel: reviewed.value.response.modelId,
          providerReportedCostMicroUsd: reviewed.route.providerReportedCostMicroUsd,
          categorySlug: candidate.categorySlug,
          inputTokens: reviewed.value.usage.inputTokens,
          outputTokens: reviewed.value.usage.outputTokens,
          durationMs: Date.now() - reviewStarted,
        });
        decision = applyForumReplyEvidenceReview(decision, reviewed.value.output);
        review = {
          approved: reviewed.value.output.approved,
          issues: reviewed.value.output.issues,
          model: reviewed.route.persistedModel,
          servedModel: reviewed.value.response.modelId,
          inputTokens: reviewed.value.usage.inputTokens,
          outputTokens: reviewed.value.usage.outputTokens,
          durationMs: Date.now() - reviewStarted,
        };
      }
      const shadow = await enqueueSukiShadowComparison(ctx, {
        agentSlug: "suki", sourceRunKey: `pilot:suki:${args.nonce}`, attempt: 0,
        candidate, evidence,
        baseline: {
          decision,
          generation: {
            model: generation.route.persistedModel,
            servedModel: generated.response.modelId,
            inputTokens: generated.usage.inputTokens,
            outputTokens: generated.usage.outputTokens,
            durationMs: Date.now() - started,
            providerReportedCostMicroUsd: generation.route.providerReportedCostMicroUsd,
          },
          review,
        },
      });
      if (!shadow || shadow.status !== "queued" || !shadow.jobId) {
        return done(ctx, args.nonce, "blocked", `shadow_${shadow?.status ?? "enqueue_failed"}`,
          sourceHash, 1, decision.decision);
      }
      const run = await ctx.runMutation(finishRef, {
        nonce: args.nonce, status: "completed", sourceHash, sourceCount: 1,
        shadowJobId: shadow.jobId, shadowStatus: shadow.status,
        baselineDecision: decision.decision,
      });
      return { duplicate: false, run };
    } catch {
      return done(ctx, args.nonce, "failed", "baseline_or_evidence_failed");
    }
  },
});

/** Existing Belle draft action only: no issue, digest, forum post, send, or scheduler. */
export const validateBelle = internalAction({
  args: { nonce: v.string(), runDate: v.string(), snapshotDate: v.string(), useElizaRuntime: v.optional(v.boolean()) },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const reserved = await ctx.runMutation(reserveRef, {
      nonce: args.nonce, kind: "belle-newsletter",
      sourceKey: `snapshot:${args.snapshotDate}:run:${args.runDate}${args.useElizaRuntime ? ":eliza" : ""}`,
    });
    if (reserved.duplicate) return reserved;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.runDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(args.snapshotDate) ||
        args.snapshotDate > args.runDate) {
      return done(ctx, args.nonce, "blocked", "invalid_source_date");
    }
    try {
      const indexed = await ctx.runQuery(readSnapshotRef, {
        snapshotDate: args.snapshotDate, limit: 18,
      });
      if (!indexed.snapshot || indexed.snapshot.status !== "complete" ||
          indexed.stories.length < 8) {
        return done(ctx, args.nonce, "blocked", "complete_snapshot_required");
      }
      const sourceHash = await shadowInputHash(JSON.stringify(indexed.stories.map(
        story => [story.hnItemId, story.rank, story.title],
      )));
      let generated: Awaited<ReturnType<typeof ctx.runAction<typeof generateDailyRef>>>;
      try {
        generated = await ctx.runAction(generateDailyRef, {
          runDate: args.runDate, snapshotDate: args.snapshotDate,
          siteUrl: "https://symbaiex.com",
          shadowSourceRunKey: `pilot:belle:${args.nonce}`,
          ...(args.useElizaRuntime ? { forceElizaRuntimeGeneration: true } : { forceLegacyGeneration: true }),
        });
      } catch (error) {
        const data = error instanceof ConvexError ? error.data : null;
        if (
          data !== null && typeof data === "object" &&
          "code" in data &&
          (data.code === "baseline_quality_rejected" || data.code === "baseline_review_failed") &&
          "shadowJobId" in data && typeof data.shadowJobId === "string"
        ) {
          const run = await ctx.runMutation(finishRef, {
            nonce: args.nonce, status: "failed", errorCode: data.code,
            sourceHash, sourceCount: indexed.stories.length,
            shadowJobId: data.shadowJobId as Id<"elizaShadowJobs">,
            shadowStatus: "queued",
          });
          return { duplicate: false, run };
        }
        throw error;
      }
      const shadow = generated.shadowEnqueue;
      if (!shadow || shadow.status !== "queued" || !shadow.jobId) {
        return done(ctx, args.nonce, "blocked", `shadow_${shadow?.status ?? "enqueue_failed"}`,
          sourceHash, indexed.stories.length);
      }
      const run = await ctx.runMutation(finishRef, {
        nonce: args.nonce, status: "completed", sourceHash,
        sourceCount: indexed.stories.length, shadowJobId: shadow.jobId,
        shadowStatus: shadow.status,
      });
      return { duplicate: false, run };
    } catch {
      return done(ctx, args.nonce, "failed", "baseline_or_source_failed");
    }
  },
});

async function done(ctx: ActionCtx, nonce: string,
  status: "blocked" | "failed", errorCode: string,
  sourceHash?: string, sourceCount?: number, baselineDecision?: string,
) {
  const run = await ctx.runMutation(finishRef, {
    nonce, status, errorCode, sourceHash, sourceCount, baselineDecision,
  });
  return { duplicate: false, run };
}
