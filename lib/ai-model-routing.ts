import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";
import { OPENROUTER_LUNA_MODEL } from "./ai-models";

export type ModelRoute = {
  provider: "openrouter";
  modelId: string;
  persistedModel: string;
};

export type RoutedModel = ModelRoute & {
  model: LanguageModel;
  providerOptions?: ProviderOptions;
};

export type ModelRoutingConfig = {
  openRouterApiKey?: string;
  disabledModelIds?: readonly string[];
  beforeAttempt?: (candidate: RoutedModel) => void | Promise<void>;
  afterAttempt?: (candidate: RoutedModel) => void | Promise<void>;
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

export type OpenRouterRequestContext = {
  user?: string;
  tags?: readonly string[];
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
  beforeAttempt?: (candidate: RoutedModel) => void | Promise<void>;
  afterAttempt?: (candidate: RoutedModel) => void | Promise<void>;
};

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
  void stage;
  return OPENROUTER_LUNA_MODEL;
}

export function openRouterModelsForStage(stage: string) {
  void stage;
  return [OPENROUTER_LUNA_MODEL];
}

export async function routedModelCandidates(
  config: ModelRoutingConfig,
  requestContext?: OpenRouterRequestContext,
  _unusedModelIds?: readonly string[],
  telemetry?: RouteTelemetryContext,
  openRouterModelIds: readonly string[] = [OPENROUTER_LUNA_MODEL],
) {
  // Keep request context in the routing contract so callers can continue to
  // attach stable attribution metadata without introducing another provider.
  void requestContext;
  void _unusedModelIds;
  void telemetry;
  const candidates: RoutedModel[] = [];
  const disabled = new Set(config.disabledModelIds ?? []);
  for (const modelId of new Set(openRouterModelIds)) {
    if (disabled.has(modelId)) continue;
    const primary = openRouterModel(config, modelId);
    if (primary) candidates.push(primary);
  }
  if (!clean(config.openRouterApiKey)) {
    throw new Error(
      "No AI model route is available. Configure OPENROUTER_API_KEY.",
    );
  }
  if (!candidates.length) {
    throw new Error("No enabled AI model route is available.");
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
    let attemptStarted = false;
    try {
      await args.beforeAttempt?.(candidate);
      attemptStarted = true;
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
    } finally {
      if (attemptStarted && args.afterAttempt) {
        try {
          await args.afterAttempt(candidate);
        } catch (error) {
          console.warn("AI model attempt cleanup failed", {
            stage: args.stage,
            provider: candidate.provider,
            model: candidate.persistedModel,
            error: safeError(error),
          });
        }
      }
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
  requestContext: OpenRouterRequestContext | undefined,
  args: RouteRunArgs<T>,
  fallbackModelIds?: readonly string[],
) {
  const candidates = await routedModelCandidates(
    config,
    requestContext,
    fallbackModelIds,
    args,
    fallbackModelIds ?? openRouterModelsForStage(args.stage),
  );
  return runRoutedCandidates(candidates, {
    ...args,
    beforeAttempt: args.beforeAttempt ?? config.beforeAttempt,
    afterAttempt: args.afterAttempt ?? config.afterAttempt,
  });
}

export async function selectStreamingModel(
  config: ModelRoutingConfig,
  requestContext?: OpenRouterRequestContext,
  telemetry?: RouteTelemetryContext,
) {
  const [candidate] = await routedModelCandidates(
    config,
    requestContext,
    undefined,
    telemetry,
  );
  console.info("AI streaming model route selected", {
    provider: candidate.provider,
    model: candidate.persistedModel,
  });
  return candidate;
}
