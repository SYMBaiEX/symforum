"use node";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

type EditorialOutcome = {
  agentSlug: "suki" | "belle";
  categorySlug: string;
  contentFormat: string;
  promptVersion: string;
  views: number;
  replies: number;
  pollVotes: number;
  quality: number;
};

export function buildEditorialCohorts(outcomes: EditorialOutcome[]) {
  const grouped = new Map<
    string,
    Omit<EditorialOutcome, "views" | "replies" | "pollVotes" | "quality"> & {
      sampleCount: number;
      totalViews: number;
      totalReplies: number;
      totalPollVotes: number;
      totalQuality: number;
    }
  >();
  for (const outcome of outcomes) {
    const cohortKey = [
      outcome.agentSlug,
      outcome.categorySlug,
      outcome.contentFormat,
      outcome.promptVersion,
    ].join(":");
    const current = grouped.get(cohortKey) ?? {
      agentSlug: outcome.agentSlug,
      categorySlug: outcome.categorySlug,
      contentFormat: outcome.contentFormat,
      promptVersion: outcome.promptVersion,
      sampleCount: 0,
      totalViews: 0,
      totalReplies: 0,
      totalPollVotes: 0,
      totalQuality: 0,
    };
    current.sampleCount += 1;
    current.totalViews += Math.max(0, outcome.views);
    current.totalReplies += Math.max(0, outcome.replies);
    current.totalPollVotes += Math.max(0, outcome.pollVotes);
    current.totalQuality += Math.max(0, outcome.quality);
    grouped.set(cohortKey, current);
  }
  return [...grouped.entries()].map(([cohortKey, cohort]) => {
    const divisor = Math.max(1, cohort.sampleCount);
    const quality = cohort.totalQuality / divisor;
    const engagement =
      Math.log1p(cohort.totalViews / divisor) * 4 +
      (cohort.totalReplies / divisor) * 9 +
      (cohort.totalPollVotes / divisor) * 7;
    const confidence = Math.min(1, cohort.sampleCount / 8);
    const score = Number(
      (70 + (quality * 0.55 + engagement - 70) * confidence).toFixed(2),
    );
    return { cohortKey, ...cohort, score };
  });
}

export const refreshEditorialCohorts = internalAction({
  args: {},
  handler: async (ctx): Promise<{ updated: number }> => {
    const snapshot = await ctx.runQuery(
      internal.forumAgentEditorialData.readEditorialOutcomeSnapshot,
      {},
    );
    const outcomes = snapshot.filter(
      (row: EditorialOutcome | null): row is EditorialOutcome => row !== null,
    );
    const cohorts = buildEditorialCohorts(outcomes);
    return await ctx.runMutation(
      internal.forumAgentEditorialData.replaceEditorialCohorts,
      { cohorts },
    );
  },
});
