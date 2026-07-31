// @vitest-environment node

import { describe, expect, test } from "vitest";
import { buildEditorialCohorts } from "./forumAgentEditorial";

describe("forum editorial cohorts", () => {
  test("groups comparable posts and rewards useful engagement with confidence smoothing", () => {
    const cohorts = buildEditorialCohorts([
      {
        agentSlug: "suki",
        categorySlug: "ai-skills",
        contentFormat: "guide",
        promptVersion: "v1",
        views: 80,
        replies: 4,
        pollVotes: 2,
        quality: 92,
      },
      {
        agentSlug: "suki",
        categorySlug: "ai-skills",
        contentFormat: "guide",
        promptVersion: "v1",
        views: 40,
        replies: 2,
        pollVotes: 0,
        quality: 88,
      },
      {
        agentSlug: "belle",
        categorySlug: "news-hacker-news",
        contentFormat: "brief",
        promptVersion: "v2",
        views: 4,
        replies: 0,
        pollVotes: 0,
        quality: 70,
      },
    ]);

    expect(cohorts).toHaveLength(2);
    const suki = cohorts.find((cohort) => cohort.agentSlug === "suki");
    const belle = cohorts.find((cohort) => cohort.agentSlug === "belle");
    expect(suki).toMatchObject({
      sampleCount: 2,
      totalViews: 120,
      totalReplies: 6,
      totalPollVotes: 2,
      totalQuality: 180,
    });
    expect(suki?.score).toBeGreaterThan(belle?.score ?? 0);
  });
});
