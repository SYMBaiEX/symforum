/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { forumDayKey } from "../lib/ai-model-costs";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());
async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T18:00:00Z"));
  const t = convexTest(schema, modules),
    model = "openai/gpt-6-luna";
  const runKey = "suki:2026-10-28:0",
    jobId = "eliza-review-audit";
  const reservationKey = `${runKey}:${model}:uuid`;
  await t.mutation(internal.aiRoutingControlData.reserveModelCall, {
    reservationKey,
    model,
    dayKey: forumDayKey(),
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    budgetLimitMicroUsd: 750000,
  });
  const receipt = {
    jobId,
    inputHash: "a".repeat(64),
    agentSlug: "suki",
    stage: "suki:forum-evidence-review",
    model,
    operationKey: runKey,
  };
  await t.mutation(internal.elizaRuntimeData.reserveCall, receipt);
  await t.mutation(internal.elizaRuntimeData.recordReceipt, {
    ...receipt,
    status: "completed",
    inputTokens: 100,
    outputTokens: 30,
  });
  await t.mutation(internal.forumAgentEditorialData.recordUsage, {
    runKey,
    agentSlug: "suki",
    stage: "research",
    model,
    inputTokens: 100,
    outputTokens: 30,
    providerReportedCostMicroUsd: 37,
    durationMs: 100,
  });
  const ids = await t.run(async (ctx) => ({
    reservationId: (await ctx.db.query("aiModelCallReservations").first())!._id,
    usageId: (await ctx.db.query("forumAgentUsageEvents").first())!._id,
    jobId,
  }));
  const spend = () =>
    t.run(async (ctx) =>
      (await ctx.db.query("aiSpendBuckets").take(16)).reduce(
        (sum, b) => sum + b.spentMicroUsd,
        0,
      ),
    );
  return { t, ids, spend };
}
test("preview changes nothing; reconciliation removes only the double reservation and is idempotent", async () => {
  const { t, ids, spend } = await fixture(),
    before = await spend();
  const preview = await t.mutation(
    internal.agentUsageReconciliation.recordedForumReview,
    {
      ...ids,
      dryRun: true,
    },
  );
  expect(await spend()).toBe(before);
  expect(preview).toEqual({ changed: false, releasedMicroUsd: 450 });
  expect(
    await t.mutation(internal.agentUsageReconciliation.recordedForumReview, {
      ...ids,
      dryRun: false,
    }),
  ).toEqual({ changed: true, releasedMicroUsd: 450 });
  expect(await spend()).toBe(37);
  expect(
    await t.mutation(internal.agentUsageReconciliation.recordedForumReview, {
      ...ids,
      dryRun: false,
    }),
  ).toEqual({ changed: false, releasedMicroUsd: 0 });
  expect(
    await t.run((ctx) => ctx.db.query("forumAgentUsageEvents").take(10)),
  ).toHaveLength(1);
});
test.each(["unknown", "tokens", "wrong-job"])(
  "mismatched %s cannot release budget",
  async (mode) => {
    const { t, ids, spend } = await fixture(),
      before = await spend();
    await t.run(async (ctx) => {
      if (mode === "tokens")
        await ctx.db.patch("forumAgentUsageEvents", ids.usageId, {
          inputTokens: 101,
        });
      else {
        const call = (await ctx.db.query("elizaRuntimeCalls").first())!;
        await ctx.db.patch(
          "elizaRuntimeCalls",
          call._id,
          mode === "unknown"
            ? { status: "failed", outcomeUnknown: true }
            : { operationKey: "different-run" },
        );
      }
    });
    await expect(
      t.mutation(internal.agentUsageReconciliation.recordedForumReview, {
        ...ids,
        dryRun: false,
      }),
    ).rejects.toThrow("recorded_review_receipts_do_not_match");
    expect(await spend()).toBe(before);
  },
);
