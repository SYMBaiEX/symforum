/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const quality = {
  evaluateThread: makeFunctionReference<"mutation", any, any>("researchQuality:evaluateThread"),
  review: makeFunctionReference<"mutation", any, any>("researchQuality:review"),
  publicationStatus: makeFunctionReference<"query", any, any>("researchQuality:publicationStatus"),
  listReviewQueue: makeFunctionReference<"query", any, any>("researchQuality:listReviewQueue"),
  benchmarkSummary: makeFunctionReference<"query", any, any>("researchQuality:benchmarkSummary"),
  recordModerationFeedback: makeFunctionReference<"mutation", any, any>("researchQuality:recordModerationFeedback"),
} as const;

function setup() {
  return convexTest(schema, modules);
}

async function seed(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const now = 1_800_000_000_000;
    const ownerId = await ctx.db.insert("users", { name: "Owner", username: "owner", usernameNormalized: "owner", role: "owner" });
    const moderatorId = await ctx.db.insert("users", { name: "Moderator", username: "moderator", usernameNormalized: "moderator", forumRole: "moderator" });
    const agentId = await ctx.db.insert("users", {
      name: "NyX", username: "nyx", usernameNormalized: "nyx", role: "reader", isAgent: true,
      agentSlug: "nyx", agentStatus: "active", agentScopes: ["forum"], agentKeyVersion: 1, agentEnrolledAt: now,
    });
    const categoryId = await ctx.db.insert("forumCategories", {
      slug: "research", name: "Research", description: "Research", kind: "board", status: "active", viewAccess: "public",
      threadAccess: "trusted", replyAccess: "trusted", pollAccess: "trusted", position: 1, threadCount: 0, postCount: 0, createdAt: now, updatedAt: now,
    });
    return { ownerId, moderatorId, agentId, categoryId, now };
  });
}

async function insertThread(
  t: ReturnType<typeof setup>,
  values: Awaited<ReturnType<typeof seed>>,
  slug: string,
  body: string,
) {
  return await t.run(async (ctx) => await ctx.db.insert("forumThreads", {
    categoryId: values.categoryId, categorySlug: "research", slug, title: `${slug} research analysis`, body, authorId: values.agentId, status: "pending", pinned: false,
    replyCount: 0, viewCount: 0, lastPostAt: values.now, lastPostUserId: values.agentId, searchText: body, createdAt: values.now, updatedAt: values.now,
  }));
}

describe("research quality gates", () => {
  test("fails closed for undisclosed, uncited agent drafts and preserves a bounded review queue", async () => {
    const t = setup();
    const values = await seed(t);
    const threadId = await insertThread(t, values, "uncited", "This research claims a new capability exists. It changes production behavior.");
    const owner = t.withIdentity({ subject: values.ownerId });
    const result = await owner.mutation(quality.evaluateThread, { threadId });
    expect(result).toMatchObject({ status: "needs_review", blocking: true });
    expect(result.flags).toEqual(expect.arrayContaining(["missing_sources", "missing_ai_authorship_disclosure"]));
    await expect(owner.mutation(quality.review, { assessmentId: result.assessmentId, decision: "approved", reason: "Looks good enough" })).rejects.toThrow("BLOCKING_QUALITY_FINDING");
    expect(await t.query(quality.publicationStatus, { threadId })).toEqual(expect.objectContaining({ canPublish: false, status: "needs_review" }));
    expect(await owner.query(quality.listReviewQueue, { limit: 1 })).toHaveLength(1);
    expect(await owner.query(quality.benchmarkSummary, {})).toEqual(expect.objectContaining({ sampleSize: 1, sampledPerStatusCap: 100 }));
  });

  test("requires an explicit durable override for a blocked draft and records human accountability", async () => {
    const t = setup();
    const values = await seed(t);
    const body = "AI-assisted research analysis. This finding is supported by https://example.com/source. A second conclusion is supported by https://docs.example.net/reference.";
    const threadId = await insertThread(t, values, "override", body);
    const owner = t.withIdentity({ subject: values.ownerId });
    const assessment = await owner.mutation(quality.evaluateThread, { threadId });
    await expect(owner.mutation(quality.review, { assessmentId: assessment.assessmentId, decision: "overridden", reason: "short" })).rejects.toThrow("INVALID_QUALITY_INPUT");
    await owner.mutation(quality.review, { assessmentId: assessment.assessmentId, decision: "overridden", reason: "The editor reviewed the primary source and accepts this exception." });
    expect(await t.query(quality.publicationStatus, { threadId })).toEqual(expect.objectContaining({ canPublish: true, status: "overridden" }));
    const reviews = await t.run((ctx) => ctx.db.query("researchQualityReviews").withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", threadId)).collect());
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.reviewerUserId).toBe(values.ownerId);
  });

  test("detects a near duplicate of approved research and allows a forum moderator to send feedback", async () => {
    const t = setup();
    const values = await seed(t);
    const body = "AI-assisted research report covering deterministic source checks, publication gating, editorial review, forum evidence, provenance, duplicate detection, and human accountability at https://example.com/one https://example.net/two.";
    const first = await insertThread(t, values, "first", body);
    const owner = t.withIdentity({ subject: values.ownerId });
    const firstAssessment = await owner.mutation(quality.evaluateThread, { threadId: first });
    await owner.mutation(quality.review, { assessmentId: firstAssessment.assessmentId, decision: "overridden", reason: "Editorial review approved this source-backed baseline despite deterministic score limits." });
    const second = await insertThread(t, values, "second", body);
    const secondAssessment = await owner.mutation(quality.evaluateThread, { threadId: second });
    expect(secondAssessment.flags).toContain("near_duplicate");
    const moderator = t.withIdentity({ subject: values.moderatorId });
    const feedback = await moderator.mutation(quality.recordModerationFeedback, { threadId: second, assessmentId: secondAssessment.assessmentId, outcome: "duplicate_confirmed", note: "Reviewed against the approved baseline." });
    expect(feedback.feedbackId).toBeTruthy();
    await expect(t.withIdentity({ subject: values.agentId }).mutation(quality.recordModerationFeedback, { threadId: second, outcome: "helpful", note: "Self approval is forbidden." })).rejects.toThrow("FORUM_MODERATOR_REQUIRED");
  });
});
