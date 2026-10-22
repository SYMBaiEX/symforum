/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import {
  estimatedModelCostMicroUsd,
  spendBucketForKey,
} from "../lib/ai-model-costs";
import { OPENROUTER_PAID_FALLBACK_MODEL } from "../lib/ai-models";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

test("cheap runtime usage settles the configured rescue price without provider dollar metadata", async () => {
  const t = convexTest(schema, modules);
  const model = OPENROUTER_PAID_FALLBACK_MODEL;
  const reservationKey = "eliza-runtime:cheap-rescue:001";
  const dayKey = "2026-10-20";
  const inputTokens = 10_000;
  const outputTokens = 1_000;
  const expectedCost = estimatedModelCostMicroUsd(
    model,
    inputTokens,
    outputTokens,
  );
  expect(expectedCost).toBeGreaterThan(0);

  const reservation = await t.mutation(
    internal.aiRoutingControlData.reserveModelCall,
    {
      reservationKey,
      model,
      dayKey,
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      budgetLimitMicroUsd: 10_000,
    },
  );
  expect(reservation).toEqual({
    accepted: true,
    reservationKey,
    estimatedMicroUsd: expectedCost,
  });

  await t.mutation(internal.forumAgentEditorialData.recordUsage, {
    runKey: "eliza-runtime-accounting:cheap-rescue",
    reservationKey,
    reservationModel: model,
    agentSlug: "suki",
    stage: "draft",
    model,
    servedModel: model,
    inputTokens,
    outputTokens,
    durationMs: 7,
    // The OpenRouter dollar-cost field was absent from this completion.
  });
  const state = await t.run(async (ctx) => ({
    reservation: await ctx.db
      .query("aiModelCallReservations")
      .withIndex("by_reservationKey", (q) =>
        q.eq("reservationKey", reservationKey),
      )
      .unique(),
    bucket: await ctx.db
      .query("aiSpendBuckets")
      .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
        q
          .eq("dayKey", dayKey)
          .eq("provider", "openrouter")
          .eq("bucket", spendBucketForKey(reservationKey)),
      )
      .unique(),
    events: await ctx.db.query("forumAgentUsageEvents").take(10),
  }));

  expect(state.reservation).toMatchObject({
    status: "settled",
    model,
    settledMicroUsd: expectedCost,
    settledInputTokens: inputTokens,
    settledOutputTokens: outputTokens,
  });
  expect(state.bucket).toMatchObject({
    spentMicroUsd: expectedCost,
    requests: 1,
    inputTokens,
    outputTokens,
  });
  expect(state.events).toHaveLength(1);
  expect(state.events[0]).toMatchObject({
    model,
    requestedModel: model,
    servedModel: model,
    estimatedCostMicroUsd: expectedCost,
    inputTokens,
    outputTokens,
  });
});
