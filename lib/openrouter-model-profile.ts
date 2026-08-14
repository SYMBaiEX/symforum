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

const TASK_PROFILES = {
  "topic-selection": {
    reasoning: "high",
    openrouter: { temperature: 0.2 },
  },
  "forum-draft": {
    reasoning: "xhigh",
    openrouter: { temperature: 0.45 },
  },
  "forum-revision": {
    reasoning: "high",
    openrouter: { temperature: 0.35 },
  },
  "newsletter-daily": {
    reasoning: "xhigh",
    openrouter: { temperature: 0.35 },
  },
  "newsletter-weekly": {
    reasoning: "xhigh",
    openrouter: { temperature: 0.45 },
  },
  "newsletter-revision": {
    reasoning: "high",
    openrouter: { temperature: 0.35 },
  },
  digest: {
    reasoning: "high",
    openrouter: { temperature: 0.45 },
  },
  reply: {
    reasoning: "medium",
    openrouter: { temperature: 0.3 },
  },
  "owner-console": {
    reasoning: "high",
    openrouter: { temperature: 0.3 },
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
