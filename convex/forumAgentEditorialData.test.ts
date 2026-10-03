/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import { OPENROUTER_PAID_FALLBACK_MODEL } from "../lib/ai-models";
import {
  estimatedModelCostMicroUsd,
  forumDayKey,
  spendBucketForKey,
} from "../lib/ai-model-costs";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const editorial = {
  replaceEditorialCohorts: makeFunctionReference<"mutation", any, any>(
    "forumAgentEditorialData:replaceEditorialCohorts",
  ),
  recordUsage: makeFunctionReference<"mutation", any, null>(
    "forumAgentEditorialData:recordUsage",
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

async function usageEventsForRun(ctx: QueryCtx, runKey: string) {
  const recent = await ctx.db
    .query("forumAgentUsageEvents")
    .withIndex("by_createdAt")
    .order("desc")
    .take(100);
  return recent.filter((event) => event.runKey === runKey);
}

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

  test("accounts a research call in shared AI spend using its routed model id", async () => {
    const t = convexTest(schema, modules);
    const runKey = "evidence-research:test";
    const inputTokens = 1_000;
    const outputTokens = 500;
    const expectedCost = estimatedModelCostMicroUsd(
      OPENROUTER_PAID_FALLBACK_MODEL,
      inputTokens,
      outputTokens,
    );

    await t.mutation(editorial.recordUsage, {
      runKey,
      agentSlug: "evidence-research",
      stage: "research",
      model: OPENROUTER_PAID_FALLBACK_MODEL,
      inputTokens,
      outputTokens,
      durationMs: 20,
    });

    const { event, spend } = await t.run(async (ctx) => ({
      event: (await usageEventsForRun(ctx, runKey))[0] ?? null,
      spend: await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q
            .eq("dayKey", forumDayKey())
            .eq("provider", "openrouter")
            .eq("bucket", spendBucketForKey(runKey)),
        )
        .unique(),
    }));

    expect(event).toMatchObject({
      agentSlug: "evidence-research",
      stage: "research",
      model: OPENROUTER_PAID_FALLBACK_MODEL,
      estimatedCostMicroUsd: expectedCost,
    });
    expect(spend?.spentMicroUsd).toBe(expectedCost);
    expect(spend?.inputTokens).toBe(inputTokens);
    expect(spend?.outputTokens).toBe(outputTokens);
  });

  test("settles a conservative reservation at zero for a resolved free response", async () => {
    const t = convexTest(schema, modules);
    const reservationKey = "free-alias-settlement:test";
    const dayKey = forumDayKey();
    const reservation = await t.mutation(
      // Exercise settlement from a conservative reservation even though the
      // standalone free-router path no longer reserves before the request.
      internal.aiRoutingControlData.reserveModelCall,
      {
        reservationKey,
        model: OPENROUTER_PAID_FALLBACK_MODEL,
        dayKey,
        estimatedInputTokens: 1_000,
        estimatedOutputTokens: 500,
        budgetLimitMicroUsd: 1_000,
      },
    );
    expect(reservation.accepted).toBe(true);

    await t.mutation(editorial.recordUsage, {
      runKey: reservationKey,
      reservationKey,
      reservationModel: OPENROUTER_PAID_FALLBACK_MODEL,
      agentSlug: "suki",
      stage: "draft",
      model: "openrouter/free",
      servedModel: "qwen/qwen3-235b-a22b:free",
      inputTokens: 1_000,
      outputTokens: 500,
      durationMs: 20,
    });

    const {
      event,
      reservation: settled,
      spend,
    } = await t.run(async (ctx) => ({
      event: (await usageEventsForRun(ctx, reservationKey))[0] ?? null,
      reservation: await ctx.db
        .query("aiModelCallReservations")
        .withIndex("by_reservationKey", (q) =>
          q.eq("reservationKey", reservationKey),
        )
        .unique(),
      spend: await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q
            .eq("dayKey", dayKey)
            .eq("provider", "openrouter")
            .eq("bucket", spendBucketForKey(reservationKey)),
        )
        .unique(),
    }));

    expect(event).toMatchObject({
      model: "openrouter/free",
      requestedModel: "openrouter/free",
      servedModel: "qwen/qwen3-235b-a22b:free",
      estimatedCostMicroUsd: 0,
    });
    expect(settled).toMatchObject({ status: "settled", settledMicroUsd: 0 });
    expect(spend).toMatchObject({ spentMicroUsd: 0 });
  });

  test("records a standalone free-router response without paid spend rows", async () => {
    for (const [caseName, servedModel] of [
      ["alias", "openrouter/free"],
      ["missing", undefined],
    ] as const) {
      const t = convexTest(schema, modules);
      const runKey = `free-router-no-reservation:${caseName}`;
      await t.mutation(editorial.recordUsage, {
        runKey,
        agentSlug: "suki",
        stage: "draft",
        model: "openrouter/free",
        ...(servedModel === undefined ? {} : { servedModel }),
        inputTokens: 1_000,
        outputTokens: 500,
        durationMs: 20,
      });

      const { event, reservations, spend } = await t.run(async (ctx) => ({
        event: (await usageEventsForRun(ctx, runKey))[0] ?? null,
        reservations: await ctx.db.query("aiModelCallReservations").collect(),
        spend: await ctx.db.query("aiSpendBuckets").collect(),
      }));

      expect(event).toMatchObject({
        model: "openrouter/free",
        estimatedCostMicroUsd: 0,
      });
      expect(reservations).toHaveLength(0);
      expect(spend).toHaveLength(0);
    }
  });

  test("charges a paid route when response model metadata is missing", async () => {
    const t = convexTest(schema, modules);
    const reservationKey = "ambiguous-alias-settlement:test";
    const dayKey = forumDayKey();
    await t.mutation(internal.aiRoutingControlData.reserveModelCall, {
      reservationKey,
      model: OPENROUTER_PAID_FALLBACK_MODEL,
      dayKey,
      estimatedInputTokens: 1_000,
      estimatedOutputTokens: 500,
      budgetLimitMicroUsd: 1_000,
    });

    await t.mutation(editorial.recordUsage, {
      runKey: reservationKey,
      reservationKey,
      reservationModel: OPENROUTER_PAID_FALLBACK_MODEL,
      agentSlug: "suki",
      stage: "draft",
      model: OPENROUTER_PAID_FALLBACK_MODEL,
      inputTokens: 1_000,
      outputTokens: 500,
      durationMs: 20,
    });

    const { event, reservation, spend } = await t.run(async (ctx) => ({
      event: (await usageEventsForRun(ctx, reservationKey))[0] ?? null,
      reservation: await ctx.db
        .query("aiModelCallReservations")
        .withIndex("by_reservationKey", (q) =>
          q.eq("reservationKey", reservationKey),
        )
        .unique(),
      spend: await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q
            .eq("dayKey", dayKey)
            .eq("provider", "openrouter")
            .eq("bucket", spendBucketForKey(reservationKey)),
        )
        .unique(),
    }));

    const expectedCost = estimatedModelCostMicroUsd(
      OPENROUTER_PAID_FALLBACK_MODEL,
      1_000,
      500,
    );
    expect(event).toMatchObject({
      model: OPENROUTER_PAID_FALLBACK_MODEL,
      requestedModel: OPENROUTER_PAID_FALLBACK_MODEL,
      estimatedCostMicroUsd: expectedCost,
    });
    expect(reservation?.settledMicroUsd).toBe(expectedCost);
    expect(spend?.spentMicroUsd).toBe(expectedCost);
  });

  test("settles an actual DeepSeek response served by the fallback alias", async () => {
    const t = convexTest(schema, modules);
    const runKey = "deepseek-served-model-settlement:test";
    const servedModel = "deepseek/deepseek-v4-flash-0731";
    const inputTokens = 625_714;
    const outputTokens = 347_020;
    const expectedCost = estimatedModelCostMicroUsd(
      OPENROUTER_PAID_FALLBACK_MODEL,
      inputTokens,
      outputTokens,
    );

    await t.mutation(editorial.recordUsage, {
      runKey,
      agentSlug: "suki",
      stage: "draft",
      model: OPENROUTER_PAID_FALLBACK_MODEL,
      servedModel,
      inputTokens,
      outputTokens,
      durationMs: 20,
    });

    const { event, spend } = await t.run(async (ctx) => ({
      event: (await usageEventsForRun(ctx, runKey))[0] ?? null,
      spend: await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q
            .eq("dayKey", forumDayKey())
            .eq("provider", "openrouter")
            .eq("bucket", spendBucketForKey(runKey)),
        )
        .unique(),
    }));

    expect(event).toMatchObject({
      model: OPENROUTER_PAID_FALLBACK_MODEL,
      requestedModel: OPENROUTER_PAID_FALLBACK_MODEL,
      servedModel,
      estimatedCostMicroUsd: expectedCost,
    });
    expect(expectedCost).toBeGreaterThan(0);
    expect(spend?.spentMicroUsd).toBe(expectedCost);
    expect(spend?.inputTokens).toBe(inputTokens);
    expect(spend?.outputTokens).toBe(outputTokens);
  });

  test("uses OpenRouter's reported cost when settling a paid reservation", async () => {
    const t = convexTest(schema, modules);
    const reservationKey = "provider-reported-cost:test";
    const dayKey = forumDayKey();
    const providerReportedCostMicroUsd = 37;
    const reservation = await t.mutation(
      internal.aiRoutingControlData.reserveModelCall,
      {
        reservationKey,
        model: OPENROUTER_PAID_FALLBACK_MODEL,
        dayKey,
        estimatedInputTokens: 1_000,
        estimatedOutputTokens: 500,
        budgetLimitMicroUsd: 1_000,
      },
    );
    expect(reservation.accepted).toBe(true);

    await t.mutation(editorial.recordUsage, {
      runKey: reservationKey,
      reservationKey,
      reservationModel: OPENROUTER_PAID_FALLBACK_MODEL,
      agentSlug: "suki",
      stage: "draft",
      model: OPENROUTER_PAID_FALLBACK_MODEL,
      inputTokens: 1_000,
      outputTokens: 500,
      providerReportedCostMicroUsd,
      durationMs: 20,
    });

    const { event, settled, spend } = await t.run(async (ctx) => ({
      event: (await usageEventsForRun(ctx, reservationKey))[0] ?? null,
      settled: await ctx.db
        .query("aiModelCallReservations")
        .withIndex("by_reservationKey", (q) =>
          q.eq("reservationKey", reservationKey),
        )
        .unique(),
      spend: await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q
            .eq("dayKey", dayKey)
            .eq("provider", "openrouter")
            .eq("bucket", spendBucketForKey(reservationKey)),
        )
        .unique(),
    }));

    expect(event).toMatchObject({
      estimatedCostMicroUsd: estimatedModelCostMicroUsd(
        OPENROUTER_PAID_FALLBACK_MODEL,
        1_000,
        500,
      ),
      providerReportedCostMicroUsd,
    });
    expect(settled?.settledMicroUsd).toBe(providerReportedCostMicroUsd);
    expect(spend?.spentMicroUsd).toBe(providerReportedCostMicroUsd);
  });

  test("keeps incomplete usage reserved and reconciles its event in place", async () => {
    for (const [caseName, partialUsage] of [
      ["input", { outputTokens: 500 }],
      ["output", { inputTokens: 1_000 }],
    ] as const) {
      const t = convexTest(schema, modules);
      const reservationKey = `missing-${caseName}-usage:test`;
      const dayKey = forumDayKey();
      const expectedCost = estimatedModelCostMicroUsd(
        OPENROUTER_PAID_FALLBACK_MODEL,
        1_000,
        500,
      );
      const reservation = await t.mutation(
        internal.aiRoutingControlData.reserveModelCall,
        {
          reservationKey,
          model: OPENROUTER_PAID_FALLBACK_MODEL,
          dayKey,
          estimatedInputTokens: 1_000,
          estimatedOutputTokens: 500,
          budgetLimitMicroUsd: 1_000,
        },
      );
      expect(reservation.accepted).toBe(true);

      const commonUsage = {
        runKey: reservationKey,
        reservationKey,
        reservationModel: OPENROUTER_PAID_FALLBACK_MODEL,
        agentSlug: "suki",
        stage: "draft" as const,
        model: OPENROUTER_PAID_FALLBACK_MODEL,
        durationMs: 20,
      };
      await t.mutation(editorial.recordUsage, {
        ...commonUsage,
        ...partialUsage,
      });
      // Retrying an incomplete receipt is idempotent: it neither inserts a
      // duplicate usage event nor releases the conservative estimate.
      await t.mutation(editorial.recordUsage, {
        ...commonUsage,
        ...partialUsage,
      });

      const incomplete = await t.run(async (ctx) => ({
        events: await usageEventsForRun(ctx, reservationKey),
        reservation: await ctx.db
          .query("aiModelCallReservations")
          .withIndex("by_reservationKey", (q) =>
            q.eq("reservationKey", reservationKey),
          )
          .unique(),
        spend: await ctx.db
          .query("aiSpendBuckets")
          .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
            q
              .eq("dayKey", dayKey)
              .eq("provider", "openrouter")
              .eq("bucket", spendBucketForKey(reservationKey)),
          )
          .unique(),
      }));

      expect(incomplete.events).toHaveLength(1);
      expect(incomplete.events[0]).toMatchObject({
        runKey: reservationKey,
        ...(partialUsage.inputTokens === undefined
          ? { outputTokens: 500 }
          : { inputTokens: 1_000 }),
      });
      expect(incomplete.events[0]?.estimatedCostMicroUsd).toBeUndefined();
      expect(incomplete.reservation).toMatchObject({
        status: "reserved",
        estimatedMicroUsd: expectedCost,
      });
      expect(incomplete.reservation?.usageEventId).toBe(
        incomplete.events[0]?._id,
      );
      expect(incomplete.spend).toMatchObject({
        spentMicroUsd: expectedCost,
        inputTokens: 1_000,
        outputTokens: 500,
      });

      await t.mutation(editorial.recordUsage, {
        ...commonUsage,
        inputTokens: 1_000,
        outputTokens: 500,
      });
      const reconciled = await t.run(async (ctx) => ({
        events: await usageEventsForRun(ctx, reservationKey),
        reservation: await ctx.db
          .query("aiModelCallReservations")
          .withIndex("by_reservationKey", (q) =>
            q.eq("reservationKey", reservationKey),
          )
          .unique(),
        spend: await ctx.db
          .query("aiSpendBuckets")
          .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
            q
              .eq("dayKey", dayKey)
              .eq("provider", "openrouter")
              .eq("bucket", spendBucketForKey(reservationKey)),
          )
          .unique(),
      }));
      expect(reconciled.events).toHaveLength(1);
      expect(reconciled.events[0]).toMatchObject({
        inputTokens: 1_000,
        outputTokens: 500,
        estimatedCostMicroUsd: expectedCost,
      });
      expect(reconciled.reservation).toMatchObject({
        status: "settled",
        settledMicroUsd: expectedCost,
      });
      expect(reconciled.spend?.spentMicroUsd).toBe(expectedCost);
    }
  });
});
