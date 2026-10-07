/** Keep all generation and review inside Convex's ten-minute action lifetime. */
export const FORUM_GENERATION_RUN_MS = 9 * 60 * 1_000;
export const FORUM_GENERATION_COMMIT_RESERVE_MS = 15_000;
const MINIMUM_MODEL_WINDOW_MS = 5_000;

export class ForumGenerationBudgetError extends Error {
  override name = "ForumGenerationBudgetError";
  constructor() {
    super("Forum generation deadline reached; hold the draft for a later run.");
  }
}

export function forumGenerationDeadline(startedAt = Date.now()) {
  return startedAt + FORUM_GENERATION_RUN_MS;
}

export function forumGenerationStageTimeout(
  deadline: number,
  requestedMs: number,
  now = Date.now(),
) {
  const remainingMs = deadline - now - FORUM_GENERATION_COMMIT_RESERVE_MS;
  if (remainingMs < MINIMUM_MODEL_WINDOW_MS)
    throw new ForumGenerationBudgetError();
  return Math.min(requestedMs, remainingMs);
}
