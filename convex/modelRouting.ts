"use node";

import type { GatewayProviderOptions } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { v } from "convex/values";
import {
  routedModelCandidates,
  runRoutedCandidates,
  runWithModelFallback,
  type ModelRoutingConfig,
} from "../lib/ai-model-routing";
import { env, internalAction } from "./_generated/server";

export function convexModelRoutingConfig(): ModelRoutingConfig {
  return {
    museBaseUrl: env.MUSE_API_BASE_URL,
    museApiKey: env.MUSE_API_KEY,
    gatewayApiKey: env.AI_GATEWAY_API_KEY,
  };
}

/**
 * Non-publishing production smoke test for operators. It exercises the same
 * Muse-first route and DeepSeek fallback used by scheduled forum agents. An
 * operator can select one route to verify the fallback without disrupting
 * Muse.
 */
export const probe = internalAction({
  args: {
    provider: v.optional(v.union(v.literal("muse"), v.literal("gateway"))),
  },
  returns: v.object({
    provider: v.union(v.literal("muse"), v.literal("gateway")),
    model: v.string(),
    response: v.string(),
  }),
  handler: async (_ctx, args) => {
    const gatewayOptions = {
      user: "operator-route-probe",
      tags: ["feature:model-route-probe"],
    } satisfies GatewayProviderOptions;
    const routeArgs = {
      stage: `operator:model-route-probe:${args.provider ?? "auto"}`,
      totalTimeoutMs: 180_000,
      run: async (
        candidate: Awaited<ReturnType<typeof routedModelCandidates>>[number],
        signal: AbortSignal,
      ) => {
        const result = await generateText({
          model: candidate.model,
          prompt: "Reply with exactly: SYMBiEX model route healthy",
          maxOutputTokens: 256,
          maxRetries: 0,
          temperature: 0,
          providerOptions: candidate.providerOptions,
          abortSignal: signal,
        });
        const response = result.text.trim();
        if (!response) {
          throw new Error("model route returned an empty visible response");
        }
        return { response };
      },
    };
    const generation =
      args.provider === undefined
        ? await runWithModelFallback<{ response: string }>(
            convexModelRoutingConfig(),
            gatewayOptions,
            routeArgs,
          )
        : await runRoutedCandidates(
            (
              await routedModelCandidates(
                convexModelRoutingConfig(),
                gatewayOptions,
              )
            ).filter((candidate) => candidate.provider === args.provider),
            routeArgs,
          );
    return {
      provider: generation.route.provider,
      model: generation.route.persistedModel,
      response: generation.value.response.slice(0, 120),
    };
  },
});
