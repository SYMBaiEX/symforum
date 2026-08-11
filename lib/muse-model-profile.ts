export type MuseTask =
  | "topic-selection"
  | "forum-draft"
  | "forum-revision"
  | "newsletter-daily"
  | "newsletter-weekly"
  | "newsletter-revision"
  | "digest"
  | "reply"
  | "owner-console";

export type ModelProvider = "muse" | "gateway";

export const MUSE_TOP_K = 64;

const TASK_PROFILES = {
  "topic-selection": {
    reasoning: "high",
    muse: { temperature: 0.8, topP: 0.95 },
    gateway: { temperature: 0.2 },
  },
  "forum-draft": {
    reasoning: "xhigh",
    muse: { temperature: 1, topP: 0.95 },
    gateway: { temperature: 0.45 },
  },
  "forum-revision": {
    reasoning: "high",
    muse: { temperature: 0.7, topP: 0.9 },
    gateway: { temperature: 0.35 },
  },
  "newsletter-daily": {
    reasoning: "xhigh",
    muse: { temperature: 1, topP: 0.95 },
    gateway: { temperature: 0.35 },
  },
  "newsletter-weekly": {
    reasoning: "xhigh",
    muse: { temperature: 1, topP: 0.95 },
    gateway: { temperature: 0.45 },
  },
  "newsletter-revision": {
    reasoning: "high",
    muse: { temperature: 0.7, topP: 0.9 },
    gateway: { temperature: 0.35 },
  },
  digest: {
    reasoning: "high",
    muse: { temperature: 1, topP: 0.95 },
    gateway: { temperature: 0.45 },
  },
  reply: {
    reasoning: "medium",
    muse: { temperature: 0.65, topP: 0.9 },
    gateway: { temperature: 0.3 },
  },
  "owner-console": {
    reasoning: "high",
    muse: { temperature: 0.7, topP: 0.9 },
    gateway: { temperature: 0.3 },
  },
} as const;

export function modelGenerationSettings(
  provider: ModelProvider,
  task: MuseTask,
) {
  return TASK_PROFILES[task][provider];
}

export function modelInstructions(
  provider: ModelProvider,
  task: MuseTask,
  instructions: string,
) {
  if (provider !== "muse") return instructions;
  const reasoning = TASK_PROFILES[task].reasoning;
  return [
    `Reasoning strength: ${reasoning}`,
    "Reason through the task privately. Return only the requested answer or structured submission, never hidden reasoning.",
    instructions.trim(),
  ].join("\n\n");
}
