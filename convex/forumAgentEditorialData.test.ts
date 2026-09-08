/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const editorial = {
  replaceEditorialCohorts: makeFunctionReference<"mutation", any, any>(
    "forumAgentEditorialData:replaceEditorialCohorts",
  ),
} as const;

const cohort = {
  cohortKey: "suki:research:guide:v1",
  agentSlug: "suki",
  categorySlug: "research",
  contentFormat: "guide",
  promptVersion: "v1",
  sampleCount: 5,
  totalViews: 0,
  totalReplies: 0,
  totalPollVotes: 0,
  totalQuality: 0,
  feedbackSampleCount: 5,
  helpfulCount: 5,
  sourceIssueCount: 0,
  duplicateConfirmedCount: 0,
  disclosureIssueCount: 0,
  minimumSampleSize: 5,
  score: 100,
};

describe("forum editorial cohort refresh", () => {
  test("does not rewrite an unchanged moderator-outcome cohort", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(editorial.replaceEditorialCohorts, { cohorts: [cohort] }),
    ).resolves.toEqual({ created: 1, updated: 0, unchanged: 0 });

    const before = await t.run(
      async (ctx) =>
        await ctx.db
          .query("forumAgentEditorialCohorts")
          .withIndex("by_cohortKey", (q) => q.eq("cohortKey", cohort.cohortKey))
          .unique(),
    );

    await expect(
      t.mutation(editorial.replaceEditorialCohorts, { cohorts: [cohort] }),
    ).resolves.toEqual({ created: 0, updated: 0, unchanged: 1 });

    const after = await t.run(
      async (ctx) =>
        await ctx.db
          .query("forumAgentEditorialCohorts")
          .withIndex("by_cohortKey", (q) => q.eq("cohortKey", cohort.cohortKey))
          .unique(),
    );
    expect(after).toEqual(before);
  });
});
