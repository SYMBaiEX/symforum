/** Canonical OpenRouter route for all forum editorial generations. */
export const OPENROUTER_LUNA_MODEL = "openai/gpt-5.6-luna";
export const OPENROUTER_TOPIC_MODEL = OPENROUTER_LUNA_MODEL;
export const OPENROUTER_FORUM_MODEL = OPENROUTER_LUNA_MODEL;
/** NyX uses the same bounded OpenRouter forum route as the other research agents. */
export const NYX_RESEARCH_MODEL = OPENROUTER_FORUM_MODEL;
export const OPENROUTER_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export type SymbaiexModelId =
  | typeof OPENROUTER_LUNA_MODEL
  | typeof OPENROUTER_TOPIC_MODEL
  | typeof OPENROUTER_FORUM_MODEL
  | typeof NYX_RESEARCH_MODEL
  | typeof OPENROUTER_EMBEDDING_MODEL;
