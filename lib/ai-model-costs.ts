import { OPENROUTER_EMBEDDING_MODEL, OPENROUTER_LUNA_MODEL } from "./ai-models";

type TokenPrice = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

const MODEL_PRICES: Record<string, TokenPrice> = {
  [OPENROUTER_LUNA_MODEL]: {
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.6,
  },
  // OpenRouter price snapshot, checked 2026-08-18:
  // https://openrouter.ai/openai/text-embedding-3-small/api ($0.02 / M tokens).
  // Embeddings are input-token only. Keep this nonzero so the existing spend
  // bucket and daily budget kill switch account for every indexing request.
  [OPENROUTER_EMBEDDING_MODEL]: {
    inputUsdPerMillion: 0.02,
    outputUsdPerMillion: 0,
  },
};

export const DEFAULT_OPENROUTER_DAILY_BUDGET_USD = 0.75;

export function estimatedModelCostMicroUsd(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
) {
  const price = MODEL_PRICES[model];
  if (price === undefined) return 0;
  return Math.max(
    0,
    Math.round(
      (inputTokens ?? 0) * price.inputUsdPerMillion +
        (outputTokens ?? 0) * price.outputUsdPerMillion,
    ),
  );
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
