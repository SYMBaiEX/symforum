"use node";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  forumAgentModerationOutcomeScore,
  type ForumAgentOutcomeCounts,
} from "./forumAgentEditorialPolicy";

type EditorialOutcome = ForumAgentOutcomeCounts & {
  cohortKey: string;
  agentSlug: string;
  categorySlug: string;
  contentFormat: string;
  promptVersion: string;
  minimumSampleSize: number;
  score?: number;
};

export function buildEditorialCohorts(outcomes: EditorialOutcome[]) {
  return outcomes.flatMap((outcome) => {
    const score = forumAgentModerationOutcomeScore(
      outcome,
      outcome.minimumSampleSize,
    );
    if (score === undefined) return [];
    return [
      {
        cohortKey: outcome.cohortKey,
        agentSlug: outcome.agentSlug,
        categorySlug: outcome.categorySlug,
        contentFormat: outcome.contentFormat,
        promptVersion: outcome.promptVersion,
        sampleCount: outcome.sampleCount,
        // Retained only for backward-compatible reporting storage. These raw
        // engagement counters no longer influence editorial selection.
        totalViews: 0,
        totalReplies: 0,
        totalPollVotes: 0,
        totalQuality: 0,
        feedbackSampleCount: outcome.sampleCount,
        helpfulCount: outcome.helpfulCount,
        sourceIssueCount: outcome.sourceIssueCount,
        duplicateConfirmedCount: outcome.duplicateConfirmedCount,
        disclosureIssueCount: outcome.disclosureIssueCount,
        minimumSampleSize: outcome.minimumSampleSize,
        score,
      },
    ];
  });
}

export const refreshEditorialCohorts = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ created: number; updated: number; unchanged: number }> => {
    const snapshot = await ctx.runQuery(
      internal.forumAgentEditorialData.readEditorialOutcomeSnapshot,
      {},
    );
    const cohorts = buildEditorialCohorts(snapshot);
    return await ctx.runMutation(
      internal.forumAgentEditorialData.replaceEditorialCohorts,
      { cohorts },
    );
  },
});
