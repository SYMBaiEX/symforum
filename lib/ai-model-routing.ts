import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  NoObjectGeneratedError,
  wrapLanguageModel,
  type generateText,
  type LanguageModel,
} from "ai";
import {
  estimatedModelCostMicroUsd,
  isOpenRouterFreeModel,
  openRouterReportedCostMicroUsd,
  openRouterReservationModel,
} from "./ai-model-costs";
export {
  openRouterBillingModel,
  openRouterReservationModel,
  openRouterSettlementModel,
  openRouterSettlementRoute,
} from "./ai-model-costs";
export type { OpenRouterSettlementRoute } from "./ai-model-costs";
import {
  OPENROUTER_GENERATION_MODELS,
  OPENROUTER_IDEATION_MODELS,
  OPENROUTER_TOPIC_MODEL,
} from "./ai-models";

export type ModelRoute = {
  provider: "openrouter";
  modelId: string;
  persistedModel: string;
  reservationKey?: string;
  reservationModel?: string;
  providerReportedCostMicroUsd?: number;
};

export type ModelUsageEstimate = {
  inputTokens: number;
  outputTokens: number;
  estimatedMicroUsd: number;
};

export type ModelAttemptCompletion = {
  succeeded: boolean;
  reservationKey?: string;
};

type RouteEstimateInput =
  number | ((candidate: RoutedModel) => number) | undefined;

type ProviderOptions = Parameters<typeof generateText>[0]["providerOptions"];

export type RoutedModel = ModelRoute & {
  model: LanguageModel;
  providerOptions?: ProviderOptions;
};

export type ModelRoutingConfig = {
  openRouterApiKey?: string;
  disabledModelIds?: readonly string[];
  beforeAttempt?: (
    candidate: RoutedModel,
    estimate: ModelUsageEstimate,
  ) => string | undefined | Promise<string | undefined>;
  afterAttempt?: (
    candidate: RoutedModel,
    completion: ModelAttemptCompletion,
  ) => void | Promise<void>;
};

export class ModelSpendBudgetExceededError extends Error {
  constructor(reason: string) {
    super(`OpenRouter daily spend reservation rejected: ${reason}`);
    this.name = "ModelSpendBudgetExceededError";
  }
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_SITE_URL = "https://forum.symbaiex.com";
const OPENROUTER_APP_NAME = "SYMBiEX Forum Agents";

/** Apply OpenRouter's contract at the transport boundary, including agent calls. */
function openRouterRequestBody(body: Record<string, unknown>) {
  const request = { ...body };
  const format = request.response_format as { type?: string } | undefined;
  const structured = format?.type === "json_schema";
  const hasTools = Array.isArray(request.tools) && request.tools.length > 0;
  if (structured || hasTools) {
    request.provider = {
      ...(request.provider as Record<string, unknown> | undefined),
      // Endpoint support varies even among providers serving the same model.
      // Never silently discard the requested schema or tool parameters.
      require_parameters: true,
    };
  }
  if (structured && request.stream !== true) {
    const plugins = Array.isArray(request.plugins) ? request.plugins : [];
    request.plugins = plugins.some(
      (plugin) => plugin?.id === "response-healing",
    )
      ? plugins
      : [...plugins, { id: "response-healing" }];
  }
  // The compatible SDK emits the legacy reasoning_effort field. OpenRouter's
  // native reasoning object controls the budget across its different providers.
  // Free routing can select a thinking model that ignores a low effort hint.
  // Default its structured calls to no separate reasoning output; preserve
  // explicit native reasoning settings supplied by a caller.
  const effort = request.reasoning_effort ?? (structured ? "low" : undefined);
  const reasoning = request.reasoning as Record<string, unknown> | undefined;
  if (
    effort !== undefined &&
    reasoning?.effort === undefined &&
    reasoning?.max_tokens === undefined &&
    reasoning?.enabled === undefined
  ) {
    request.reasoning = {
      ...(structured && request.model === "openrouter/free"
        ? { enabled: false }
        : { effort }),
      ...reasoning,
    };
  }
  delete request.reasoning_effort;
  return request;
}

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
  estimatedCostMicroUsd: number;
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
  estimatedInputTokens?: RouteEstimateInput;
  maxOutputTokens?: RouteEstimateInput;
  run: (candidate: RoutedModel, signal: AbortSignal) => Promise<T>;
  onAttempt?: (event: ModelRouteAttempt) => void | Promise<void>;
  beforeAttempt?: ModelRoutingConfig["beforeAttempt"];
  afterAttempt?: ModelRoutingConfig["afterAttempt"];
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
    supportsStructuredOutputs: true,
    transformRequestBody: openRouterRequestBody,
    headers: {
      "HTTP-Referer": OPENROUTER_SITE_URL,
      "X-OpenRouter-Title": OPENROUTER_APP_NAME,
    },
  });
  return {
    provider: "openrouter",
    modelId,
    persistedModel: modelId,
    model: wrapLanguageModel({
      model: openRouter(modelId),
      middleware: {
        specificationVersion: "v4",
        wrapGenerate: async ({ doGenerate, params }) => {
          const result = await doGenerate();
          if (
            params.responseFormat?.type === "json" &&
            !result.content.some(
              (part) =>
                (part.type === "text" && part.text.trim().length > 0) ||
                part.type === "tool-call",
            )
          ) {
            throw new Error(
              `OpenRouter returned empty structured output ` +
                `(finish=${result.finishReason.unified}, ` +
                `outputTokens=${result.usage.outputTokens.total ?? 0}, ` +
                `reasoningTokens=${result.usage.outputTokens.reasoning ?? 0})`,
            );
          }
          return result;
        },
      },
    }),
  };
}

export function openRouterModelForStage(stage: string) {
  return openRouterModelsForStage(stage)[0] ?? OPENROUTER_TOPIC_MODEL;
}

export function openRouterModelsForStage(stage: string) {
  return isLowStakesIdeationStage(stage)
    ? [...OPENROUTER_IDEATION_MODELS]
    : [...OPENROUTER_GENERATION_MODELS];
}

function isLowStakesIdeationStage(stage: string) {
  return /(?:^|:|-)(?:brainstorm|ideation|ideas?)(?:$|:|-)/i.test(stage);
}

export async function routedModelCandidates(
  config: ModelRoutingConfig,
  openRouterModelIds: readonly string[] = OPENROUTER_GENERATION_MODELS,
) {
  const candidates: RoutedModel[] = [];
  const disabled = new Set(config.disabledModelIds ?? []);
  const modelIds = [...new Set(openRouterModelIds)];
  for (const modelId of modelIds) {
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
    // A circuit is advisory for this bounded route, not a permanent provider
    // outage. Retry the free primary as the emergency route so open circuits
    // cannot force paid traffic or strand the platform indefinitely.
    const emergencyModelId =
      modelIds.find((modelId) => modelId === "openrouter/free") ??
      modelIds.at(0);
    const emergency =
      emergencyModelId === undefined
        ? undefined
        : openRouterModel(config, emergencyModelId);
    if (emergency) return [emergency];
    throw new Error("No enabled AI model route is available.");
  }
  return candidates;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (NoObjectGeneratedError.isInstance(error)) {
    // Record enough to distinguish malformed JSON from exhausted output,
    // without logging prompts, generated private content, or reasoning text.
    const diagnostic =
      `finish=${error.finishReason ?? "unknown"}, ` +
      `outputTokens=${error.usage?.outputTokens ?? 0}, ` +
      `reasoningTokens=${error.usage?.outputTokenDetails.reasoningTokens ?? 0}, ` +
      `textChars=${error.text?.length ?? 0}`;
    return `${message.replace(/\s+/g, " ").slice(0, 120)} (${diagnostic})`;
  }
  return message.replace(/\s+/g, " ").slice(0, 240);
}

function shouldAttemptModelFallback(error: unknown) {
  // These OpenRouter responses are account-level failures. Sending the same
  // request to another model with the same credentials cannot repair invalid
  // authentication or missing payment, and can turn one failure into a paid
  // retry. Keep model-specific 4xx errors eligible for a different candidate.
  return !(
    APICallError.isInstance(error) &&
    (error.statusCode === 401 || error.statusCode === 402)
  );
}

export function routedAttemptTimeoutMs({
  remainingMs,
  remainingFallbacks,
  totalTimeoutMs,
}: {
  remainingMs: number;
  remainingFallbacks: number;
  totalTimeoutMs: number;
}) {
  const reservePerFallback = Math.min(
    120_000,
    Math.max(30_000, Math.floor(totalTimeoutMs * 0.4)),
  );
  const fallbackReserve =
    remainingFallbacks > 0
      ? Math.min(remainingMs - 1_000, reservePerFallback * remainingFallbacks)
      : 0;
  return Math.max(1_000, remainingMs - fallbackReserve);
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
    // Structured free routes can legitimately consume most of their window
    // before revealing that tool calling is unsupported. Preserve a useful
    // rescue window instead of leaving the paid fallback only the last 25%.
    const attemptTimeout = routedAttemptTimeoutMs({
      remainingMs: remaining,
      remainingFallbacks,
      totalTimeoutMs: args.totalTimeoutMs,
    });
    const attemptStartedAt = Date.now();
    let attemptStarted = false;
    let attemptSucceeded = false;
    let reservationKey: string | undefined;
    let estimatedCostMicroUsd = 0;
    try {
      const estimatedInputTokens = resolveEstimate(
        args.estimatedInputTokens,
        candidate,
      );
      const estimatedOutputTokens = resolveEstimate(
        args.maxOutputTokens,
        candidate,
      );
      // This runner sends the free router as a standalone request; its paid
      // rescue is another candidate and has its own preflight reservation.
      // Do not transiently charge free calls against the paid daily budget.
      const isFreeRoute =
        candidate.provider === "openrouter" &&
        isOpenRouterFreeModel(candidate.persistedModel);
      const reservationModel = isFreeRoute
        ? undefined
        : openRouterReservationModel(candidate.persistedModel);
      estimatedCostMicroUsd =
        reservationModel === undefined
          ? 0
          : estimatedModelCostMicroUsd(
              reservationModel,
              estimatedInputTokens,
              estimatedOutputTokens,
            );
      if (reservationModel !== undefined) {
        reservationKey = await args.beforeAttempt?.(candidate, {
          inputTokens: estimatedInputTokens,
          outputTokens: estimatedOutputTokens,
          estimatedMicroUsd: estimatedCostMicroUsd,
        });
      }
      attemptStarted = true;
      const value = await args.run(
        candidate,
        AbortSignal.timeout(attemptTimeout),
      );
      attemptSucceeded = true;
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
        fallback: index > 0,
        durationMs: Date.now() - attemptStartedAt,
        estimatedCostMicroUsd,
      });
      const providerReportedCostMicroUsd =
        openRouterReportedCostMicroUsd(value);
      return {
        value,
        route: {
          provider: candidate.provider,
          modelId: candidate.modelId,
          persistedModel: candidate.persistedModel,
          ...(providerReportedCostMicroUsd === undefined
            ? {}
            : { providerReportedCostMicroUsd }),
          ...(reservationModel === undefined ? {} : { reservationModel }),
          ...(reservationKey === undefined ? {} : { reservationKey }),
        },
      };
    } catch (error) {
      // A failed preflight (especially a rejected spend reservation) is not a
      // provider failure and must never fall through to a paid candidate.
      if (!attemptStarted) throw error;
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
        fallback: index > 0,
        durationMs: Date.now() - attemptStartedAt,
        estimatedCostMicroUsd,
        errorMessage: safeError(error),
      });
      if (!shouldAttemptModelFallback(error)) throw error;
    } finally {
      if (attemptStarted && args.afterAttempt) {
        try {
          await args.afterAttempt(candidate, {
            succeeded: attemptSucceeded,
            reservationKey,
          });
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

function resolveEstimate(estimate: RouteEstimateInput, candidate: RoutedModel) {
  const value = typeof estimate === "function" ? estimate(candidate) : estimate;
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : 0;
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
  args: RouteRunArgs<T>,
  fallbackModelIds?: readonly string[],
) {
  const candidates = await routedModelCandidates(
    config,
    fallbackModelIds ?? openRouterModelsForStage(args.stage),
  );
  return runRoutedCandidates(candidates, {
    ...args,
    beforeAttempt: args.beforeAttempt ?? config.beforeAttempt,
    afterAttempt: args.afterAttempt ?? config.afterAttempt,
  });
}

export async function selectStreamingModel(config: ModelRoutingConfig) {
  const [candidate, ...fallbacks] = await routedModelCandidates(
    config,
    OPENROUTER_IDEATION_MODELS,
  );
  console.info("AI streaming model route selected", {
    provider: candidate.provider,
    model: candidate.persistedModel,
  });
  return {
    ...candidate,
    // Streaming responses cannot be restarted after bytes reach the client.
    // Let OpenRouter fail over before the stream begins using the same audited
    // order as the non-streaming Convex generation paths.
    providerOptions:
      fallbacks.length === 0
        ? undefined
        : ({
            openrouter: {
              models: fallbacks.map((fallback) => fallback.modelId),
            },
          } satisfies ProviderOptions),
  };
}
