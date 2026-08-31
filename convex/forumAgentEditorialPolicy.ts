export const FORUM_AGENT_FEEDBACK_MIN_SAMPLE = 5;

export type ForumAgentOutcomeCounts = {
  sampleCount: number;
  helpfulCount: number;
  sourceIssueCount: number;
  duplicateConfirmedCount: number;
  disclosureIssueCount: number;
};

/**
 * Outcome-only editorial signal. Notes, views, replies, and poll activity are
 * deliberately absent. A cohort has no score until it reaches k-anonymity's
 * minimum sample floor.
 */
export function forumAgentModerationOutcomeScore(
  counts: ForumAgentOutcomeCounts,
  minimumSampleSize = FORUM_AGENT_FEEDBACK_MIN_SAMPLE,
) {
  if (counts.sampleCount < minimumSampleSize) return undefined;
  const net =
    counts.helpfulCount -
    counts.sourceIssueCount -
    counts.duplicateConfirmedCount -
    counts.disclosureIssueCount;
  return Number(
    Math.max(0, Math.min(100, 50 + (net / counts.sampleCount) * 50)).toFixed(2),
  );
}

export function forumAgentEditorialCohortKey(args: {
  agentSlug: string;
  categorySlug: string;
  contentFormat: string;
  promptVersion: string;
}) {
  return JSON.stringify([
    args.agentSlug,
    args.categorySlug,
    args.contentFormat,
    args.promptVersion,
  ]);
}
