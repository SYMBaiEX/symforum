import { OPENROUTER_EMBEDDING_MODEL } from "./ai-models";

const DEFAULT_DAILY_BUDGET_USD = 0.05;

export type SemanticSearchConfig = {
  enabled: boolean;
  model: string;
  dailyBudgetMicroUsd: number;
  reason?: string;
};

export function semanticSearchConfig(values: {
  enabled?: string;
  dailyBudgetUsd?: string;
  embeddingModel?: string;
}): SemanticSearchConfig {
  if (values.enabled?.trim().toLowerCase() !== "true") {
    return {
      enabled: false,
      model: OPENROUTER_EMBEDDING_MODEL,
      dailyBudgetMicroUsd: 0,
      reason: "SEMANTIC_SEARCH_ENABLED is not true.",
    };
  }
  const configuredModel =
    values.embeddingModel?.trim() || OPENROUTER_EMBEDDING_MODEL;
  // Pricing and vector dimensions are a security boundary: do not silently
  // route to an unpriced model or mix incompatible vectors in one namespace.
  if (configuredModel !== OPENROUTER_EMBEDDING_MODEL) {
    return {
      enabled: false,
      model: configuredModel,
      dailyBudgetMicroUsd: 0,
      reason:
        "The configured embedding model has no approved price/dimension profile.",
    };
  }
  const rawBudget = values.dailyBudgetUsd?.trim();
  const budgetUsd =
    rawBudget === undefined || rawBudget === ""
      ? DEFAULT_DAILY_BUDGET_USD
      : Number(rawBudget);
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 5) {
    return {
      enabled: false,
      model: configuredModel,
      dailyBudgetMicroUsd: 0,
      reason: "SEMANTIC_SEARCH_DAILY_BUDGET_USD must be between 0 and 5.",
    };
  }
  return {
    enabled: true,
    model: configuredModel,
    dailyBudgetMicroUsd: Math.round(budgetUsd * 1_000_000),
  };
}
