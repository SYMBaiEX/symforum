import {
  createGateway,
  type GatewayModelId,
  type GatewayProviderOptions,
} from "@ai-sdk/gateway";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";
import {
  DEEPSEEK_FALLBACK_MODEL,
  MUSE_AGENT_MODEL,
  MUSE_API_MODEL_ID,
  OPENROUTER_FORUM_MODEL,
  OPENROUTER_FORUM_PAID_MODEL,
  OPENROUTER_TOPIC_MODEL,
  OPENROUTER_TOPIC_PAID_MODEL,
} from "./ai-models";
import { MUSE_TOP_K } from "./muse-model-profile";

export type ModelRoute = {
  provider: "openrouter" | "muse" | "gateway";
  modelId: string;
  persistedModel: string;
};

export type RoutedModel = ModelRoute & {
  model: LanguageModel;
  providerOptions?: ProviderOptions;
};

export type ModelRoutingConfig = {
  openRouterApiKey?: string;
  museBaseUrl?: string;
  museApiKey?: string;
  gatewayApiKey?: string;
};

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_SITE_URL = "https://forum.symbaiex.com";
const OPENROUTER_APP_NAME = "SYMBiEX Forum Agents";

export type ModelRouteAttempt = {
  correlationId: string;
  feature: string;
  stage: string;
  attempt: number;
  provider: ModelRoute["provider"];
  model: string;
  outcome: "completed" | "failed";
  fallback: boolean;
  durationMs: number;
  errorMessage?: string;
};

type RouteTelemetryContext = {
  correlationId?: string;
  feature?: string;
  agent?: string;
};

export type RouteRunArgs<T> = RouteTelemetryContext & {
  stage: string;
  totalTimeoutMs: number;
  attemptOffset?: number;
  run: (candidate: RoutedModel, signal: AbortSignal) => Promise<T>;
  onAttempt?: (event: ModelRouteAttempt) => void | Promise<void>;
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
  healthCache = { baseUrl, expiresAt: now + 30_000, result };
  return result;
}

export function clearMuseHealthCacheForTests() {
  healthCache = undefined;
}

function safeTelemetryHeader(value: string | undefined) {
  const cleaned = clean(value);
  return cleaned && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(cleaned)
    ? cleaned
    : undefined;
}

function museModel(
  config: ModelRoutingConfig,
  telemetry?: RouteTelemetryContext,
): RoutedModel | undefined {
  const baseURL = museBaseUrl(config.museBaseUrl);
  const apiKey = clean(config.museApiKey);
  if (!baseURL || !apiKey) return undefined;
  const provider = createOpenAICompatible({
    name: "symbaiexMuse",
    apiKey,
    baseURL,
    includeUsage: true,
    headers: {
      ...(safeTelemetryHeader(telemetry?.correlationId)
        ? {
            "x-symbaiex-correlation-id": safeTelemetryHeader(
              telemetry?.correlationId,
            )!,
          }
        : {}),
      ...(safeTelemetryHeader(telemetry?.feature)
        ? { "x-symbaiex-feature": safeTelemetryHeader(telemetry?.feature)! }
        : {}),
      ...(safeTelemetryHeader(telemetry?.agent)
        ? { "x-symbaiex-agent": safeTelemetryHeader(telemetry?.agent)! }
        : {}),
    },
  });
  return {
    provider: "muse",
    modelId: MUSE_API_MODEL_ID,
    persistedModel: MUSE_AGENT_MODEL,
    model: provider(MUSE_API_MODEL_ID),
    // The generic OpenAI-compatible adapter treats topK as unsupported, but it
    // forwards unknown provider options into the request body. Muse's server
    // accepts the native snake_case field recommended by its model card.
    providerOptions: {
      symbaiexMuse: { top_k: MUSE_TOP_K },
    } as ProviderOptions,
  };
}

function openRouterModel(
  config: ModelRoutingConfig,
  modelId: string,
): RoutedModel | undefined {
  const apiKey = clean(config.openRouterApiKey);
  if (!apiKey) return undefined;
  const openRouter = createOpenAICompatible({
    name: "openrouter",
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    includeUsage: true,
    headers: {
      "HTTP-Referer": OPENROUTER_SITE_URL,
      "X-OpenRouter-Title": OPENROUTER_APP_NAME,
    },
  });
  return {
    provider: "openrouter",
    modelId,
    persistedModel: modelId,
    model: openRouter(modelId),
  };
}

export function openRouterModelForStage(stage: string) {
  return stage.endsWith(":forum-topic")
    ? OPENROUTER_TOPIC_MODEL
    : OPENROUTER_FORUM_MODEL;
}

export function openRouterModelsForStage(stage: string) {
  return stage.endsWith(":forum-topic")
    ? [OPENROUTER_TOPIC_MODEL, OPENROUTER_TOPIC_PAID_MODEL]
    : [OPENROUTER_FORUM_MODEL, OPENROUTER_FORUM_PAID_MODEL];
}

function gatewayModel(
  config: ModelRoutingConfig,
  modelId: GatewayModelId,
): RoutedModel | undefined {
  const apiKey = clean(config.gatewayApiKey);
  if (!apiKey) return undefined;
  const gateway = createGateway({ apiKey });
  return {
    provider: "gateway",
    modelId,
    persistedModel: modelId,
    model: gateway(modelId),
    // Route attribution already lives in aiRouteEvents. Avoid duplicating it
    // in providerOptions because older Gateway deployments reject that shape
    // before a fallback request can run.
    providerOptions: undefined,
  };
}

export async function routedModelCandidates(
  config: ModelRoutingConfig,
  gatewayOptions?: GatewayProviderOptions,
  gatewayModelIds: readonly GatewayModelId[] = [
    DEEPSEEK_FALLBACK_MODEL as GatewayModelId,
  ],
  telemetry?: RouteTelemetryContext,
  openRouterModelIds: readonly string[] = [
    OPENROUTER_FORUM_MODEL,
    OPENROUTER_FORUM_PAID_MODEL,
  ],
) {
  // Preserve the public route-builder signature for callers while keeping
  // optional Gateway attribution out of providerOptions (see gatewayModel).
  void gatewayOptions;
  const candidates: RoutedModel[] = [];
  for (const modelId of openRouterModelIds) {
    const primary = openRouterModel(config, modelId);
    if (primary) candidates.push(primary);
  }
  const muse = museModel(config, telemetry);
  if (muse) {
    // Avoid adding a health-probe delay to the OpenRouter primary path. If it
    // fails, Muse is attempted normally and remains bounded by route timeout.
    if (candidates.length > 0 || (await isMuseAvailable(config))) {
      candidates.push(muse);
    } else {
      console.warn(
        "Muse model route unavailable; using configured gateway fallback",
      );
    }
  }
  for (const modelId of gatewayModelIds) {
    const fallback = gatewayModel(config, modelId);
    if (fallback) candidates.push(fallback);
  }
  if (!candidates.length) {
    throw new Error(
      "No AI model route is available. Configure OPENROUTER_API_KEY, Muse API access, or AI_GATEWAY_API_KEY.",
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
  const attemptOffset = Math.max(0, Math.floor(args.attemptOffset ?? 0));
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const remaining = deadline - Date.now();
    if (remaining <= 1_000) break;
    const remainingFallbacks = candidates.length - index - 1;
    const reservePerFallback = Math.min(
      90_000,
      Math.max(30_000, Math.floor(args.totalTimeoutMs * 0.25)),
    );
    const fallbackReserve =
      remainingFallbacks > 0
        ? Math.min(remaining - 1_000, reservePerFallback * remainingFallbacks)
        : 0;
    const attemptTimeout = Math.max(1_000, remaining - fallbackReserve);
    const attemptStartedAt = Date.now();
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
      await emitRouteAttempt(args, {
        correlationId:
          args.correlationId ?? `${args.feature ?? "ai"}:${args.stage}`,
        feature: args.feature ?? "ai-generation",
        stage: args.stage,
        attempt: index + 1 + attemptOffset,
        provider: candidate.provider,
        model: candidate.persistedModel,
        outcome: "completed",
        fallback: index + attemptOffset > 0,
        durationMs: Date.now() - attemptStartedAt,
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
      await emitRouteAttempt(args, {
        correlationId:
          args.correlationId ?? `${args.feature ?? "ai"}:${args.stage}`,
        feature: args.feature ?? "ai-generation",
        stage: args.stage,
        attempt: index + 1 + attemptOffset,
        provider: candidate.provider,
        model: candidate.persistedModel,
        outcome: "failed",
        fallback: index + attemptOffset > 0,
        durationMs: Date.now() - attemptStartedAt,
        errorMessage: safeError(error),
      });
    }
  }
  throw new Error(
    `AI generation failed for ${args.stage} after ${failures.length} route attempt${failures.length === 1 ? "" : "s"}: ${failures.join(" | ")}`,
  );
}

async function emitRouteAttempt<T>(
  args: RouteRunArgs<T>,
  event: ModelRouteAttempt,
) {
  if (!args.onAttempt) return;
  try {
    await args.onAttempt(event);
  } catch (error) {
    console.warn("AI route telemetry write failed", {
      stage: args.stage,
      error: safeError(error),
    });
  }
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
    args,
    openRouterModelsForStage(args.stage),
  );
  return runRoutedCandidates(candidates, args);
}

export async function selectStreamingModel(
  config: ModelRoutingConfig,
  gatewayOptions?: GatewayProviderOptions,
  telemetry?: RouteTelemetryContext,
) {
  const [candidate] = await routedModelCandidates(
    config,
    gatewayOptions,
    undefined,
    telemetry,
  );
  console.info("AI streaming model route selected", {
    provider: candidate.provider,
    model: candidate.persistedModel,
  });
  return candidate;
}
