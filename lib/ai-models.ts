/**
 * Zero-cost OpenRouter routes that passed the production structured tool-use
 * canary on 2026-08-20. The fixed Gemma route is tried first for predictable
 * behavior; OpenRouter's capability-filtered free pool broadens availability.
 */
export const OPENROUTER_FREE_GENERATION_MODELS = [
  "google/gemma-4-26b-a4b-it:free",
  "openrouter/free",
] as const;

/** Stable paid reliability fallback; the `~` alias follows V4 Flash updates. */
export const OPENROUTER_DEEPSEEK_FALLBACK_MODEL =
  "~deepseek/deepseek-v4-flash-latest";

/** Canonical free-first route for every text-generation surface. */
export const OPENROUTER_GENERATION_MODELS = [
  ...OPENROUTER_FREE_GENERATION_MODELS,
  OPENROUTER_DEEPSEEK_FALLBACK_MODEL,
] as const;

export const OPENROUTER_TOPIC_MODEL = OPENROUTER_GENERATION_MODELS[0];
/** Persist the guaranteed fallback on agent records, not an opportunistic free endpoint. */
export const OPENROUTER_FORUM_MODEL = OPENROUTER_DEEPSEEK_FALLBACK_MODEL;
/** NyX uses the same bounded OpenRouter route as the other research agents. */
export const NYX_RESEARCH_MODEL = OPENROUTER_FORUM_MODEL;
export const OPENROUTER_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export type SymbaiexModelId =
  | (typeof OPENROUTER_FREE_GENERATION_MODELS)[number]
  | typeof OPENROUTER_DEEPSEEK_FALLBACK_MODEL
  | typeof OPENROUTER_TOPIC_MODEL
  | typeof OPENROUTER_FORUM_MODEL
  | typeof NYX_RESEARCH_MODEL
  | typeof OPENROUTER_EMBEDDING_MODEL;
