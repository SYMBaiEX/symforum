"use node";

import { randomUUID } from "node:crypto";
import { generateText, Output } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import {
  estimatePromptInputTokens,
  forumDayKey,
  hasModelPrice,
  openRouterReservationModel,
  openRouterDailyBudgetMicroUsd,
} from "../lib/ai-model-costs";
import {
  ModelSpendBudgetExceededError,
  routedModelCandidates,
  runRoutedCandidates,
  type ModelRoutingConfig,
  type RoutedModel,
} from "../lib/ai-model-routing";
import { modelGenerationSettings } from "../lib/openrouter-model-profile";
import { openRouterStructuredOutputBudget } from "../lib/ai-models";
import { internal } from "./_generated/api";
import { env, internalAction, type ActionCtx } from "./_generated/server";
import { routeTelemetry } from "./aiTelemetryHelpers";
import { shadowWorkerOrigin } from "../lib/eliza-shadow-contract";
import { ElizaRuntimeTransportError } from "../lib/eliza-runtime-transport";

const CANARY_MESSAGE = "SYMBiEX structured model route healthy";
const CANARY_FAILURE_PAUSE_MS = 30 * 60 * 1_000;
const canaryOutputSchema = z.object({
  topic: z.string().min(12).max(120),
  title: z.string().min(12).max(120),
  draft: z.string().min(80).max(1_200),
  sourceUrls: z.array(z.string().url()).min(1).max(3),
  message: z.literal(CANARY_MESSAGE),
});

export async function convexModelRoutingConfig(
  ctx?: ActionCtx,
  options?: {
    correlationId?: string;
    runtimeScope?: "forum-newsletter" | "system-canary";
    elizaRuntime?: "force" | "off";
  },
): Promise<ModelRoutingConfig> {
  const base: ModelRoutingConfig = {
    openRouterApiKey: env.OPENROUTER_API_KEY,
  };
  const useEliza =
    options?.elizaRuntime !== "off" &&
    (options?.elizaRuntime === "force" ||
      (options?.runtimeScope !== undefined &&
        env.ELIZA_RUNTIME_MODE === "live"));
  if (useEliza) {
    const url = shadowWorkerOrigin(env.ELIZA_RUNTIME_WORKER_URL);
    const secret = env.ELIZA_RUNTIME_WORKER_SECRET;
    // Once live generation is enabled, configuration failures must not silently
    // put some agents back on the legacy provider transport.
    if (
      !url ||
      !secret ||
      secret.length < 32 ||
      secret.length > 512 ||
      /\s/.test(secret)
    ) {
      throw new ElizaRuntimeTransportError("configuration_unavailable");
    }
    base.elizaRuntime = {
      url,
      secret,
      ...(ctx === undefined
        ? {}
        : {
            onRequest: async (request) => {
              if (!options?.correlationId)
                throw new ElizaRuntimeTransportError(
                  "operation_identity_required",
                );
              await ctx.runMutation(internal.elizaRuntimeData.reserveCall, {
                ...request,
                operationKey: options.correlationId,
              });
            },
            onReceipt: async (receipt) => {
              if (!options?.correlationId)
                throw new ElizaRuntimeTransportError(
                  "operation_identity_required",
                );
              await ctx.runMutation(internal.elizaRuntimeData.recordReceipt, {
                ...receipt,
                operationKey: options.correlationId,
              });
            },
          }),
    };
  }
  if (ctx === undefined) return base;
  if (
    options?.runtimeScope !== undefined ||
    options?.elizaRuntime === "force"
  ) {
    try {
      if (!options?.correlationId) throw new Error("missing_identity");
      await ctx.runQuery(internal.elizaRuntimeData.assertOperationReady, {
        operationKey: options.correlationId,
      });
    } catch {
      throw new ElizaRuntimeTransportError("operation_unavailable");
    }
  }

  const control = await ctx.runQuery(
    internal.aiRoutingControlData.readRoutingControl,
    { now: Date.now() },
  );
  return {
    ...base,
    disabledModelIds: control.disabledModelIds,
    beforeAttempt: async (candidate, estimate) => {
      const reservationModel = openRouterReservationModel(
        candidate.persistedModel,
      );
      if (!hasModelPrice(reservationModel)) {
        throw new ModelSpendBudgetExceededError("missing-model-price");
      }
      if (estimate.inputTokens <= 0 || estimate.outputTokens <= 0) {
        throw new ModelSpendBudgetExceededError("missing-token-estimate");
      }
      if (estimate.estimatedMicroUsd <= 0) {
        throw new ModelSpendBudgetExceededError("invalid-cost-estimate");
      }
      const reservation = await ctx.runMutation(
        internal.aiRoutingControlData.reserveModelCall,
        {
          reservationKey: `${options?.correlationId ?? "ai"}:${candidate.persistedModel}:${randomUUID()}`,
          model: reservationModel,
          dayKey: forumDayKey(Date.now()),
          estimatedInputTokens: estimate.inputTokens,
          estimatedOutputTokens: estimate.outputTokens,
          budgetLimitMicroUsd: openRouterDailyBudgetMicroUsd(
            env.OPENROUTER_DAILY_BUDGET_USD,
          ),
        },
      );
      if (!reservation.accepted) {
        throw new ModelSpendBudgetExceededError(reservation.reason);
      }
      return reservation.reservationKey;
    },
    afterAttempt: async (_candidate, completion) => {
      if (completion.succeeded || completion.reservationKey === undefined)
        return;
      await ctx.runMutation(internal.aiRoutingControlData.markModelCallFailed, {
        reservationKey: completion.reservationKey,
      });
    },
  };
}

/** Non-publishing structured smoke test for operators. */
export const probe = internalAction({
  args: {
    provider: v.optional(v.literal("openrouter")),
    freeOnly: v.optional(v.boolean()),
    elizaRuntime: v.optional(v.boolean()),
    validationTag: v.optional(v.string()),
    model: v.optional(
      v.union(
        v.literal("openrouter/free"),
        v.literal("~deepseek/deepseek-v4-flash-latest"),
        v.literal("deepseek/deepseek-v4.1-flash-1017"),
      ),
    ),
  },
  returns: v.object({
    provider: v.union(v.literal("openrouter")),
    model: v.string(),
    response: v.string(),
  }),
  handler: async (ctx, args) =>
    await runStructuredProbe(ctx, args.provider, args.freeOnly, args),
});

export const runStructuredCanary = internalAction({
  args: {},
  returns: v.object({
    healthy: v.boolean(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    detail: v.string(),
  }),
  handler: async (ctx) => {
    try {
      const result = await runStructuredProbe(ctx);
      await ctx.runMutation(internal.aiRoutingControlData.recordCanaryState, {
        healthy: true,
        provider: result.provider,
        model: result.model,
        detail: result.response,
        pauseUntil: 0,
      });
      return {
        healthy: true,
        provider: result.provider,
        model: result.model,
        detail: result.response,
      };
    } catch (error) {
      const detail = safeError(error);
      await ctx.runMutation(internal.aiRoutingControlData.recordCanaryState, {
        healthy: false,
        detail,
        pauseUntil: Date.now() + CANARY_FAILURE_PAUSE_MS,
      });
      return { healthy: false, detail };
    }
  },
});

export async function runStructuredProbe(
  ctx: ActionCtx,
  provider?: "openrouter",
  freeOnly = false,
  options?: { elizaRuntime?: boolean; model?: string; validationTag?: string },
) {
  if (
    options?.validationTag !== undefined &&
    !/^[A-Za-z0-9_-]{1,64}$/.test(options.validationTag)
  ) {
    throw new Error("invalid_canary_validation_tag");
  }
  const correlationId = `model-canary:${Date.now()}`;
  const generationStartedAt = Date.now();
  const config = await convexModelRoutingConfig(ctx, {
    correlationId,
    runtimeScope: "system-canary",
    ...(options?.elizaRuntime ? { elizaRuntime: "force" as const } : {}),
  });
  const canaryPrompt =
    "You are validating the exact structured-output contract used by a " +
    "forum agent before it may publish. Return one structured object using " +
    "topic 'Structured routing health check', title " +
    "'Structured routing health check passed', source URL " +
    `'https://symbaiex.com/agents.md', message '${CANARY_MESSAGE}', and ` +
    "an 80-200 character draft explaining that this synthetic payload " +
    "checks schema-valid tool submission without publishing. Do not write prose." +
    (options?.validationTag
      ? ` This is a new diagnostic batch: ${options.validationTag}.`
      : "");
  const routeArgs = {
    stage: `operator:model-route-probe:${freeOnly ? "free" : (provider ?? "auto")}`,
    correlationId,
    feature: "model-route-canary",
    onAttempt: routeTelemetry(ctx, {
      correlationId,
      feature: "model-route-canary",
      runKey: correlationId,
    }),
    totalTimeoutMs: 180_000,
    estimatedInputTokens: estimatePromptInputTokens(canaryPrompt),
    maxOutputTokens: (candidate: RoutedModel) =>
      openRouterStructuredOutputBudget(candidate.modelId, 4_000),
    run: async (candidate: RoutedModel, signal: AbortSignal) => {
      const result = await generateText({
        model: candidate.model,
        prompt: canaryPrompt,
        output: Output.object({ schema: canaryOutputSchema }),
        maxOutputTokens: openRouterStructuredOutputBudget(
          candidate.modelId,
          4_000,
        ),
        maxRetries: 0,
        temperature: 0,
        reasoning: modelGenerationSettings("openrouter", "topic-selection")
          .reasoning,
        providerOptions: candidate.providerOptions,
        abortSignal: signal,
      });
      const output = result.output;
      if (
        output.message !== CANARY_MESSAGE ||
        output.topic.trim().length < 12 ||
        output.title.trim().length < 12 ||
        output.draft.trim().length < 80 ||
        output.sourceUrls.length < 1
      ) {
        throw new Error(
          `model route did not complete the structured canary (finish=${result.finishReason}, outputTokens=${result.usage.outputTokens ?? 0})`,
        );
      }
      return {
        response: output.message,
        modelId: result.response.modelId,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        usage: result.usage,
      };
    },
  };
  // Every canary path, including the hourly default, must use the worker's
  // purpose-bound system stage. The operator telemetry label is not a runtime
  // stage and must never be sent as one when global live mode is enabled.
  const generation = await runRoutedCandidates(
    (
      await routedModelCandidates(
        config,
        options?.model
          ? [options.model]
          : freeOnly
            ? ["openrouter/free"]
            : undefined,
        { agentSlug: "system", stage: "health-canary", correlationId },
      )
    ).filter(
      (candidate) => provider === undefined || candidate.provider === provider,
    ),
    {
      ...routeArgs,
      beforeAttempt: config.beforeAttempt,
      afterAttempt: config.afterAttempt,
    },
  );
  await ctx.runMutation(internal.forumAgentEditorialData.recordUsage, {
    runKey: correlationId,
    reservationKey: generation.route.reservationKey,
    reservationModel: generation.route.reservationModel,
    agentSlug: "system",
    stage: "canary",
    model: generation.route.persistedModel,
    servedModel: generation.value.modelId,
    providerReportedCostMicroUsd: generation.route.providerReportedCostMicroUsd,
    inputTokens: generation.value.inputTokens,
    outputTokens: generation.value.outputTokens,
    durationMs: Date.now() - generationStartedAt,
  });
  return {
    provider: generation.route.provider,
    model: generation.value.modelId || generation.route.persistedModel,
    response: generation.value.response,
  };
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 240);
}
