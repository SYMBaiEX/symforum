export const MUSE_API_MODEL_ID = "Muse-Glimmer-30B";
export const MUSE_AGENT_MODEL = `muse/${MUSE_API_MODEL_ID}`;
export const DEEPSEEK_FALLBACK_MODEL = "deepseek/deepseek-v4-flash-0731";
export const NEWSLETTER_LAST_RESORT_MODEL = "openai/gpt-5.4-mini";

export type SymbaiexModelId =
  | typeof MUSE_AGENT_MODEL
  | typeof DEEPSEEK_FALLBACK_MODEL
  | typeof NEWSLETTER_LAST_RESORT_MODEL;
