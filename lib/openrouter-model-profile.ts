export type ModelTask =
  | "topic-selection"
  | "forum-draft"
  | "forum-revision"
  | "newsletter-daily"
  | "newsletter-weekly"
  | "newsletter-revision"
  | "digest"
  | "reply"
  | "owner-console";

export type ModelProvider = "openrouter";

function structuredOpenRouterProfile(temperature: number) {
  return {
    temperature,
    // Ox Alpha defaults to maximum reasoning. A low explicit budget leaves
    // enough output tokens for the required structured submission.
    reasoning: "low" as const,
    // The outer route owns fallback. SDK retries would multiply each failed
    // candidate before the next free/paid route gets a chance.
    maxRetries: 0,
  };
}

const TASK_PROFILES = {
  "topic-selection": {
    reasoning: "high",
    openrouter: structuredOpenRouterProfile(0.2),
  },
  "forum-draft": {
    reasoning: "xhigh",
    openrouter: structuredOpenRouterProfile(0.3),
  },
  "forum-revision": {
    reasoning: "high",
    openrouter: structuredOpenRouterProfile(0.2),
  },
  "newsletter-daily": {
    reasoning: "xhigh",
    openrouter: structuredOpenRouterProfile(0.35),
  },
  "newsletter-weekly": {
    reasoning: "xhigh",
    openrouter: structuredOpenRouterProfile(0.45),
  },
  "newsletter-revision": {
    reasoning: "high",
    openrouter: structuredOpenRouterProfile(0.35),
  },
  digest: {
    reasoning: "high",
    openrouter: structuredOpenRouterProfile(0.45),
  },
  reply: {
    reasoning: "medium",
    openrouter: structuredOpenRouterProfile(0.3),
  },
  "owner-console": {
    reasoning: "high",
    openrouter: structuredOpenRouterProfile(0.3),
  },
} as const;

export function modelGenerationSettings(
  provider: ModelProvider,
  task: ModelTask,
) {
  void provider;
  return TASK_PROFILES[task].openrouter;
}

export function modelInstructions(
  provider: ModelProvider,
  task: ModelTask,
  instructions: string,
) {
  void provider;
  const reasoning = TASK_PROFILES[task].reasoning;
  return [
    `Reasoning strength: ${reasoning}`,
    "Reason through the task privately. Return only the requested answer or structured submission, never hidden reasoning.",
    instructions.trim(),
  ].join("\n\n");
}
