"use node";

import { generateText, tool } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import {
  OPENROUTER_FORUM_PAID_MODEL,
  OPENROUTER_TOPIC_PAID_MODEL,
} from "../lib/ai-models";
import {
  forumDayKey,
  openRouterDailyBudgetMicroUsd,
} from "../lib/ai-model-costs";
import {
  routedModelCandidates,
  runRoutedCandidates,
  runWithModelFallback,
  type ModelRoutingConfig,
  type RoutedModel,
} from "../lib/ai-model-routing";
import { internal } from "./_generated/api";
import { env, internalAction, type ActionCtx } from "./_generated/server";
import { routeTelemetry } from "./aiTelemetryHelpers";

const CANARY_MESSAGE = "SYMBiEX structured model route healthy";
const CANARY_FAILURE_PAUSE_MS = 30 * 60 * 1_000;

export async function convexModelRoutingConfig(
  ctx?: ActionCtx,
  options?: { correlationId?: string },
): Promise<ModelRoutingConfig> {
  const base: ModelRoutingConfig = {
    openRouterApiKey: env.OPENROUTER_API_KEY,
  };
  if (ctx === undefined) return base;

  const now = Date.now();
  const budgetLimitMicroUsd = openRouterDailyBudgetMicroUsd(
    env.OPENROUTER_DAILY_BUDGET_USD,
  );
  const control: {
    disabledModelIds: string[];
    paidBudgetExceeded: boolean;
  } = await ctx.runQuery(internal.aiRoutingControlData.readRoutingControl, {
    dayKey: forumDayKey(now),
    budgetLimitMicroUsd,
    now,
  });
  const disabledModelIds = new Set(control.disabledModelIds);
  if (control.paidBudgetExceeded) {
    disabledModelIds.add(OPENROUTER_TOPIC_PAID_MODEL);
    disabledModelIds.add(OPENROUTER_FORUM_PAID_MODEL);
  }

  void options;
  return { ...base, disabledModelIds: [...disabledModelIds] };
}

/** Non-publishing structured smoke test for operators. */
export const probe = internalAction({
  args: {
    provider: v.optional(
      v.literal("openrouter"),
    ),
  },
  returns: v.object({
    provider: v.union(
      v.literal("openrouter"),
    ),
    model: v.string(),
    response: v.string(),
  }),
  handler: async (ctx, args) => await runStructuredProbe(ctx, args.provider),
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

async function runStructuredProbe(
  ctx: ActionCtx,
  provider?: "openrouter",
) {
  const correlationId = `model-canary:${Date.now()}`;
  const config = await convexModelRoutingConfig(ctx, { correlationId });
  const requestContext = {
    user: "operator-route-probe",
    tags: ["feature:model-route-probe"],
  };
  const routeArgs = {
    stage: `operator:model-route-probe:${provider ?? "auto"}`,
    correlationId,
    feature: "model-route-canary",
    onAttempt: routeTelemetry(ctx, {
      correlationId,
      feature: "model-route-canary",
      runKey: correlationId,
    }),
    totalTimeoutMs: 180_000,
    run: async (candidate: RoutedModel, signal: AbortSignal) => {
      const result = await generateText({
        model: candidate.model,
        prompt: `Call confirmHealth with the exact message: ${CANARY_MESSAGE}`,
        tools: {
          confirmHealth: tool({
            description: "Confirm that structured forum-agent tool use works.",
            inputSchema: z.object({ message: z.literal(CANARY_MESSAGE) }),
          }),
        },
        toolChoice: "required",
        maxOutputTokens: 256,
        maxRetries: 0,
        temperature: 0,
        providerOptions: candidate.providerOptions,
        abortSignal: signal,
      });
      const call = result.staticToolCalls[0];
      if (
        call?.toolName !== "confirmHealth" ||
        call.input.message !== CANARY_MESSAGE
      ) {
        throw new Error("model route did not complete the structured canary");
      }
      return { response: call.input.message };
    },
  };
  const generation =
    provider === undefined
      ? await runWithModelFallback<{ response: string }>(
          config,
          requestContext,
          routeArgs,
        )
      : await runRoutedCandidates(
          (await routedModelCandidates(config, requestContext)).filter(
            (candidate) => candidate.provider === provider,
          ),
          {
            ...routeArgs,
            beforeAttempt: config.beforeAttempt,
            afterAttempt: config.afterAttempt,
          },
        );
  return {
    provider: generation.route.provider,
    model: generation.route.persistedModel,
    response: generation.value.response,
  };
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 240);
}
