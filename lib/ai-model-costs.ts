import {
  OPENROUTER_EMBEDDING_MODEL,
  OPENROUTER_FREE_GENERATION_MODELS,
  OPENROUTER_PAID_FALLBACK_MODEL,
} from "./ai-models";
import type { OwnerConsoleSettlementRoute } from "./ai-usage-settlement";

export type OpenRouterSettlementRoute = OwnerConsoleSettlementRoute;

/** Models that OpenRouter guarantees are zero-priced without a paid fallback. */
export function isOpenRouterFreeModel(modelId: string) {
  return (
    OPENROUTER_FREE_GENERATION_MODELS.some(
      (freeModelId) => freeModelId === modelId,
    ) || modelId.endsWith(":free")
  );
}

/** Resolve unambiguous free variants; unknown aliases are priced as paid. */
export function openRouterSettlementRoute(
  responseModelId: string,
): OpenRouterSettlementRoute {
  const modelId = responseModelId.trim().toLowerCase();
  return modelId !== "openrouter/free" && modelId.endsWith(":free")
    ? "free"
    : "paid";
}

export function openRouterSettlementModel(route: OpenRouterSettlementRoute) {
  return route === "free" ? "openrouter/free" : OPENROUTER_PAID_FALLBACK_MODEL;
}

/** Price aliases with a possible paid route at the configured rescue rate. */
export function openRouterReservationModel(modelId: string) {
  return isOpenRouterFreeModel(modelId)
    ? OPENROUTER_PAID_FALLBACK_MODEL
    : modelId;
}

/** Bill a known standalone free route at zero; treat other ambiguity as paid. */
export function openRouterBillingModel(
  responseModelId?: string,
  requestedModelId?: string,
) {
  if (
    requestedModelId !== undefined &&
    OPENROUTER_FREE_GENERATION_MODELS.includes(
      requestedModelId as (typeof OPENROUTER_FREE_GENERATION_MODELS)[number],
    ) &&
    (responseModelId === undefined || responseModelId === "openrouter/free")
  ) {
    return "openrouter/free";
  }
  return openRouterSettlementModel(
    openRouterSettlementRoute(responseModelId ?? ""),
  );
}

type TokenPrice = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

const MODEL_PRICES: Record<string, TokenPrice> = {
  [OPENROUTER_FREE_GENERATION_MODELS[0]]: {
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
  },
  // OpenRouter price snapshot, checked 2026-10-02:
  // https://openrouter.ai/~deepseek/deepseek-v4-flash-latest
  // The alias currently reports $0.005775/M input and $1.60/M output.
  [OPENROUTER_PAID_FALLBACK_MODEL]: {
    inputUsdPerMillion: 0.005775,
    outputUsdPerMillion: 1.6,
  },
  // OpenRouter price snapshot, checked 2026-10-02:
  // https://openrouter.ai/openai/text-embedding-3-small/api ($0.02 / M tokens).
  // Embeddings are input-token only. Keep this nonzero so the existing spend
  // bucket and daily budget kill switch account for every indexing request.
  [OPENROUTER_EMBEDDING_MODEL]: {
    inputUsdPerMillion: 0.02,
    outputUsdPerMillion: 0,
  },
};

export function hasModelPrice(model: string) {
  return Object.prototype.hasOwnProperty.call(MODEL_PRICES, model);
}

export function hasCostAttribution(
  model: string,
  estimatedCostMicroUsd: number | undefined,
) {
  if (estimatedCostMicroUsd !== undefined) {
    if (!Number.isFinite(estimatedCostMicroUsd) || estimatedCostMicroUsd < 0)
      return false;
    if (estimatedCostMicroUsd > 0) return true;
  }

  const price = MODEL_PRICES[model];
  return (
    (price !== undefined &&
      price.inputUsdPerMillion === 0 &&
      price.outputUsdPerMillion === 0) ||
    model === "openrouter/free" ||
    model.endsWith(":free")
  );
}

export const DEFAULT_OPENROUTER_DAILY_BUDGET_USD = 0.75;

export function estimatedModelCostMicroUsd(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
) {
  const price = MODEL_PRICES[model];
  if (price === undefined) return 0;
  // The ledger stores integer microdollars. Round positive usage up so a large
  // number of tiny embedding calls cannot accumulate as zero-cost requests.
  return Math.max(
    0,
    Math.ceil(
      (inputTokens ?? 0) * price.inputUsdPerMillion +
        (outputTokens ?? 0) * price.outputUsdPerMillion,
    ),
  );
}

/**
 * Conservative character-based prompt estimate used only for pre-call budget
 * reservations. Provider-reported token usage replaces this estimate after a
 * successful call. The fixed allowance covers system instructions and tools
 * that are not included in the user-visible prompt string.
 */
export function estimatePromptInputTokens(
  prompt: string,
  additionalTokens = 3_000,
) {
  const overhead = Number.isSafeInteger(additionalTokens)
    ? Math.max(0, additionalTokens)
    : 3_000;
  return Math.max(1, Math.ceil(prompt.length / 2) + overhead);
}

export function openRouterDailyBudgetMicroUsd(value: string | undefined) {
  const parsed = Number(value?.trim());
  const dollars =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, 100)
      : DEFAULT_OPENROUTER_DAILY_BUDGET_USD;
  return Math.round(dollars * 1_000_000);
}

export function forumDayKey(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

export function spendBucketForKey(key: string, bucketCount = 8) {
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % Math.max(1, Math.floor(bucketCount));
}
