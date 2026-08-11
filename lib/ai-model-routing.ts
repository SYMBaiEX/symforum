import { createGateway, type GatewayModelId, type GatewayProviderOptions } from "@ai-sdk/gateway";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";
import {
  DEEPSEEK_FALLBACK_MODEL,
  MUSE_AGENT_MODEL,
  MUSE_API_MODEL_ID,
} from "./ai-models";

export type ModelRoute = {
  provider: "muse" | "gateway";
  modelId: string;
  persistedModel: string;
};

export type RoutedModel = ModelRoute & {
  model: LanguageModel;
  providerOptions?: ProviderOptions;
};

export type ModelRoutingConfig = {
  museBaseUrl?: string;
  museApiKey?: string;
  gatewayApiKey?: string;
};

type RouteRunArgs<T> = {
  stage: string;
  totalTimeoutMs: number;
  run: (candidate: RoutedModel, signal: AbortSignal) => Promise<T>;
};

let healthCache:
  | { baseUrl: string; expiresAt: number; result: Promise<boolean> }
  | undefined;

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function museBaseUrl(value: string | undefined) {
  const configured = clean(value);
  if (!configured) return undefined;
  const url = new URL(configured);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("MUSE_API_BASE_URL must use HTTPS");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

async function checkMuseHealth(baseUrl: string, apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function isMuseAvailable(config: ModelRoutingConfig) {
  const baseUrl = museBaseUrl(config.museBaseUrl);
  const apiKey = clean(config.museApiKey);
  if (!baseUrl || !apiKey) return false;
  const now = Date.now();
  if (healthCache?.baseUrl === baseUrl && healthCache.expiresAt > now) {
    return healthCache.result;
  }
  const result = checkMuseHealth(baseUrl, apiKey);
  healthCache = { baseUrl, expiresAt: now + 5_000, result };
  return result;
}

export function clearMuseHealthCacheForTests() {
  healthCache = undefined;
}

function museModel(config: ModelRoutingConfig): RoutedModel | undefined {
  const baseURL = museBaseUrl(config.museBaseUrl);
  const apiKey = clean(config.museApiKey);
  if (!baseURL || !apiKey) return undefined;
  const provider = createOpenAICompatible({
    name: "symbaiexMuse",
    apiKey,
    baseURL,
    includeUsage: true,
  });
  return {
    provider: "muse",
    modelId: MUSE_API_MODEL_ID,
    persistedModel: MUSE_AGENT_MODEL,
    model: provider(MUSE_API_MODEL_ID),
  };
}

function gatewayModel(
  config: ModelRoutingConfig,
  modelId: GatewayModelId,
  gatewayOptions?: GatewayProviderOptions,
): RoutedModel | undefined {
  const apiKey = clean(config.gatewayApiKey);
  if (!apiKey) return undefined;
  const gateway = createGateway({ apiKey });
  return {
    provider: "gateway",
    modelId,
    persistedModel: modelId,
    model: gateway(modelId),
    providerOptions: gatewayOptions
      ? ({ gateway: gatewayOptions } as ProviderOptions)
      : undefined,
  };
}

export async function routedModelCandidates(
  config: ModelRoutingConfig,
  gatewayOptions?: GatewayProviderOptions,
  gatewayModelIds: readonly GatewayModelId[] = [
    DEEPSEEK_FALLBACK_MODEL as GatewayModelId,
  ],
) {
  const candidates: RoutedModel[] = [];
  const muse = museModel(config);
  if (muse) {
    if (await isMuseAvailable(config)) {
      candidates.push(muse);
    } else {
      console.warn("Muse model route unavailable; using configured gateway fallback");
    }
  }
  for (const modelId of gatewayModelIds) {
    const fallback = gatewayModel(config, modelId, gatewayOptions);
    if (fallback) candidates.push(fallback);
  }
  if (!candidates.length) {
    throw new Error(
      "No AI model route is available. Configure Muse API access and AI_GATEWAY_API_KEY.",
    );
  }
  return candidates;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 240);
}

export async function runRoutedCandidates<T>(
  candidates: RoutedModel[],
  args: RouteRunArgs<T>,
): Promise<{ value: T; route: ModelRoute }> {
  const deadline = Date.now() + args.totalTimeoutMs;
  const failures: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const remaining = deadline - Date.now();
    if (remaining <= 1_000) break;
    const fallbackReserve = index < candidates.length - 1
      ? Math.min(45_000, Math.floor(args.totalTimeoutMs * 0.3))
      : 0;
    const attemptTimeout = Math.max(1_000, remaining - fallbackReserve);
    try {
      const value = await args.run(
        candidate,
        AbortSignal.timeout(attemptTimeout),
      );
      console.info("AI model route completed", {
        stage: args.stage,
        provider: candidate.provider,
        model: candidate.persistedModel,
      });
      return {
        value,
        route: {
          provider: candidate.provider,
          modelId: candidate.modelId,
          persistedModel: candidate.persistedModel,
        },
      };
    } catch (error) {
      const failure = `${candidate.persistedModel}: ${safeError(error)}`;
      failures.push(failure);
      console.warn("AI model route failed", {
        stage: args.stage,
        provider: candidate.provider,
        model: candidate.persistedModel,
        error: safeError(error),
      });
    }
  }
  throw new Error(
    `AI generation failed for ${args.stage} after ${failures.length} route attempt${failures.length === 1 ? "" : "s"}: ${failures.join(" | ")}`,
  );
}

export async function runWithModelFallback<T>(
  config: ModelRoutingConfig,
  gatewayOptions: GatewayProviderOptions | undefined,
  args: RouteRunArgs<T>,
  gatewayModelIds?: readonly GatewayModelId[],
) {
  const candidates = await routedModelCandidates(
    config,
    gatewayOptions,
    gatewayModelIds,
  );
  return runRoutedCandidates(candidates, args);
}

export async function selectStreamingModel(
  config: ModelRoutingConfig,
  gatewayOptions?: GatewayProviderOptions,
) {
  const [candidate] = await routedModelCandidates(config, gatewayOptions);
  console.info("AI streaming model route selected", {
    provider: candidate.provider,
    model: candidate.persistedModel,
  });
  return candidate;
}
