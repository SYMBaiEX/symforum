export const OPENROUTER_TOPIC_MODEL = "nvidia/nemotron-3-nano-30b-a3b:free";
export const OPENROUTER_FORUM_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
/** NyX uses the same bounded OpenRouter forum route as the other research agents. */
export const NYX_RESEARCH_MODEL = OPENROUTER_FORUM_MODEL;
export const OPENROUTER_TOPIC_PAID_MODEL = "nvidia/nemotron-3-nano-30b-a3b";
export const OPENROUTER_FORUM_PAID_MODEL = "nvidia/nemotron-3-super-120b-a12b";
/** Reliable OpenRouter-hosted structured-tool fallback when a Nemotron provider is unhealthy. */
export const OPENROUTER_TOOL_FALLBACK_MODEL = "openai/gpt-4.1-mini";
export const OPENROUTER_DEEPSEEK_MODEL = "deepseek/deepseek-v4-flash-0731";
export const OPENROUTER_NEWSLETTER_LAST_RESORT_MODEL = "openai/gpt-5.4-mini";
export const OPENROUTER_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export type SymbaiexModelId =
  | typeof OPENROUTER_TOPIC_MODEL
  | typeof OPENROUTER_FORUM_MODEL
  | typeof NYX_RESEARCH_MODEL
  | typeof OPENROUTER_TOPIC_PAID_MODEL
  | typeof OPENROUTER_FORUM_PAID_MODEL
  | typeof OPENROUTER_TOOL_FALLBACK_MODEL
  | typeof OPENROUTER_DEEPSEEK_MODEL
  | typeof OPENROUTER_NEWSLETTER_LAST_RESORT_MODEL
  | typeof OPENROUTER_EMBEDDING_MODEL;
