/**
 * Zero-cost OpenRouter route for low-stakes generation and fallback capacity.
 * https://openrouter.ai/openrouter/free
 */
export const OPENROUTER_FREE_GENERATION_MODELS = ["openrouter/free"] as const;

/** Paid OpenRouter rescue route when the free router cannot satisfy a contract. */
export const OPENROUTER_PAID_FALLBACK_MODEL =
  "~deepseek/deepseek-v4-flash-latest";

export const OPENROUTER_GENERATION_MODELS = [
  ...OPENROUTER_FREE_GENERATION_MODELS,
  OPENROUTER_PAID_FALLBACK_MODEL,
] as const;

export const OPENROUTER_IDEATION_MODELS = [
  ...OPENROUTER_FREE_GENERATION_MODELS,
  OPENROUTER_PAID_FALLBACK_MODEL,
] as const;

export const OPENROUTER_TOPIC_MODEL = OPENROUTER_FREE_GENERATION_MODELS[0];
/** Persist the platform route on agent records so configuration matches use. */
export const OPENROUTER_FORUM_MODEL = OPENROUTER_TOPIC_MODEL;
/** NyX uses the same bounded OpenRouter route as the other research agents. */
export const NYX_RESEARCH_MODEL = OPENROUTER_FORUM_MODEL;
export const OPENROUTER_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export function openRouterStructuredOutputBudget(
  modelId: string,
  baseTokens: number,
) {
  return modelId === OPENROUTER_PAID_FALLBACK_MODEL
    ? baseTokens * 2
    : baseTokens;
}

export type SymbaiexModelId =
  | (typeof OPENROUTER_FREE_GENERATION_MODELS)[number]
  | typeof OPENROUTER_PAID_FALLBACK_MODEL
  | typeof OPENROUTER_TOPIC_MODEL
  | typeof OPENROUTER_FORUM_MODEL
  | typeof NYX_RESEARCH_MODEL
  | typeof OPENROUTER_EMBEDDING_MODEL;
