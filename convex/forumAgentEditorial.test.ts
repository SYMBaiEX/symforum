// @vitest-environment node

import { describe, expect, test } from "vitest";
import { buildEditorialCohorts } from "./forumAgentEditorial";

describe("forum editorial cohorts", () => {
  test("uses only moderator outcomes after the minimum sample and keeps smaller cohorts neutral", () => {
    const cohorts = buildEditorialCohorts([
      {
        cohortKey: "suki-guide-v1",
        agentSlug: "suki",
        categorySlug: "ai-skills",
        contentFormat: "guide",
        promptVersion: "v1",
        sampleCount: 5,
        helpfulCount: 4,
        sourceIssueCount: 1,
        duplicateConfirmedCount: 0,
        disclosureIssueCount: 0,
        minimumSampleSize: 5,
      },
      {
        cohortKey: "belle-brief-v2",
        agentSlug: "belle",
        categorySlug: "news-hacker-news",
        contentFormat: "brief",
        promptVersion: "v2",
        sampleCount: 4,
        helpfulCount: 4,
        sourceIssueCount: 0,
        duplicateConfirmedCount: 0,
        disclosureIssueCount: 0,
        minimumSampleSize: 5,
      },
    ]);

    expect(cohorts).toEqual([
      expect.objectContaining({
        cohortKey: "suki-guide-v1",
        feedbackSampleCount: 5,
        totalViews: 0,
        totalReplies: 0,
        totalPollVotes: 0,
        score: 80,
      }),
    ]);
    expect(cohorts[0]).not.toHaveProperty("notes");
  });

  test("raw engagement has no place in an editorial outcome", () => {
    const outcome = {
      cohortKey: "suki-guide-v1",
      agentSlug: "suki",
      categorySlug: "ai-skills",
      contentFormat: "guide",
      promptVersion: "v1",
      sampleCount: 5,
      helpfulCount: 5,
      sourceIssueCount: 0,
      duplicateConfirmedCount: 0,
      disclosureIssueCount: 0,
      minimumSampleSize: 5,
      views: 999_999,
    };
    type Outcome = Parameters<typeof buildEditorialCohorts>[0][number];
    expect(buildEditorialCohorts([outcome as Outcome])).toEqual([
      expect.objectContaining({
        score: 100,
        totalViews: 0,
      }),
    ]);
    expect(
      buildEditorialCohorts([{ ...outcome, views: 0 } as Outcome]),
    ).toEqual([
      expect.objectContaining({
        score: 100,
        totalViews: 0,
      }),
    ]);
  });
});
