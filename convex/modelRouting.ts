"use node";

import type { GatewayProviderOptions } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { v } from "convex/values";
import {
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
 * Muse-first route and DeepSeek fallback used by scheduled forum agents.
 */
export const probe = internalAction({
  args: {},
  returns: v.object({
    provider: v.union(v.literal("muse"), v.literal("gateway")),
    model: v.string(),
    response: v.string(),
  }),
  handler: async () => {
    const gatewayOptions = {
      caching: "auto",
      user: "operator-route-probe",
      tags: ["feature:model-route-probe"],
    } satisfies GatewayProviderOptions;
    const generation = await runWithModelFallback<{ response: string }>(
      convexModelRoutingConfig(),
      gatewayOptions,
      {
        stage: "operator:model-route-probe",
        totalTimeoutMs: 90_000,
        run: async (candidate, signal) => {
          const result = await generateText({
            model: candidate.model,
            prompt: "Reply with exactly: SYMBiEX model route healthy",
            maxOutputTokens: 32,
            maxRetries: 0,
            temperature: 0,
            providerOptions: candidate.providerOptions,
            abortSignal: signal,
          });
          return { response: result.text };
        },
      },
    );
    return {
      provider: generation.route.provider,
      model: generation.route.persistedModel,
      response: generation.value.response.trim().slice(0, 120),
    };
  },
});
