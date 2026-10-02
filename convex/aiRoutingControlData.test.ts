/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  estimatedModelCostMicroUsd,
  spendBucketForKey,
} from "../lib/ai-model-costs";
import {
  OPENROUTER_EMBEDDING_MODEL,
  OPENROUTER_PAID_FALLBACK_MODEL,
} from "../lib/ai-models";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

async function usageEventsForRun(ctx: QueryCtx, runKey: string) {
  const recent = await ctx.db
    .query("forumAgentUsageEvents")
    .withIndex("by_createdAt")
    .order("desc")
    .take(100);
  return recent.filter((event) => event.runKey === runKey);
}

afterEach(() => vi.useRealTimers());

describe("AI routing controls", () => {
  test("returns only active model circuits", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiProviderCircuits", {
        model: "openrouter/free",
        consecutiveFailures: 3,
        reason: "temporarily unavailable",
        disabledUntil: 200,
        lastFailureAt: 90,
        updatedAt: 90,
      });
    });

    const control = await t.query(
      internal.aiRoutingControlData.readRoutingControl,
      {
        now: 100,
      },
    );

    expect(control).toEqual({ disabledModelIds: ["openrouter/free"] });
  });

  test("pauses the free alias for a full quota cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = setup();

    await t.mutation(internal.aiTelemetry.recordRouteEvent, {
      correlationId: "free-alias-quota:test",
      feature: "routing-test",
      stage: "draft",
      attempt: 1,
      provider: "openrouter",
      model: "openrouter/free",
      outcome: "failed",
      fallback: false,
      durationMs: 100,
      errorMessage: "OpenRouter free-models rate limit reached",
    });

    const circuit = await t.run(async (ctx) =>
      ctx.db
        .query("aiProviderCircuits")
        .withIndex("by_model", (q) => q.eq("model", "openrouter/free"))
        .unique(),
    );
    expect(circuit?.disabledUntil).toBe(1_000_000 + 60 * 60 * 1_000);
  });

  test("serializes paid-call reservations and settles them to reported usage", async () => {
    const t = setup();
    const dayKey = "2026-10-01";
    const reservationArgs = (reservationKey: string) => ({
      reservationKey,
      model: OPENROUTER_PAID_FALLBACK_MODEL,
      dayKey,
      estimatedInputTokens: 1_000,
      estimatedOutputTokens: 500,
      budgetLimitMicroUsd: 806,
    });
    const [first, second] = await Promise.all([
      t.mutation(
        internal.aiRoutingControlData.reserveModelCall,
        reservationArgs("route-a"),
      ),
      t.mutation(
        internal.aiRoutingControlData.reserveModelCall,
        reservationArgs("route-b"),
      ),
    ]);
    const accepted = [first, second].filter((result) => result.accepted);
    expect(accepted).toHaveLength(1);
    if (!accepted[0].accepted) throw new Error("expected reservation");

    const reservationKey = accepted[0].reservationKey;
    const actualInputTokens = 100;
    const actualOutputTokens = 25;
    const settledCost = estimatedModelCostMicroUsd(
      OPENROUTER_PAID_FALLBACK_MODEL,
      actualInputTokens,
      actualOutputTokens,
    );
    const usage = {
      runKey: "route-settlement-test",
      reservationKey,
      agentSlug: "test-agent",
      stage: "draft" as const,
      model: OPENROUTER_PAID_FALLBACK_MODEL,
      inputTokens: actualInputTokens,
      outputTokens: actualOutputTokens,
      durationMs: 10,
    };
    await t.mutation(internal.forumAgentEditorialData.recordUsage, usage);
    await t.mutation(internal.forumAgentEditorialData.recordUsage, usage);

    const result = await t.run(async (ctx) => ({
      spend: await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q
            .eq("dayKey", dayKey)
            .eq("provider", "openrouter")
            .eq("bucket", spendBucketForKey(reservationKey)),
        )
        .unique(),
      reservations: await ctx.db.query("aiModelCallReservations").collect(),
      events: await usageEventsForRun(ctx, usage.runKey),
    }));
    expect(result.spend).toMatchObject({
      spentMicroUsd: settledCost,
      requests: 1,
      inputTokens: actualInputTokens,
      outputTokens: actualOutputTokens,
    });
    expect(result.reservations[0]).toMatchObject({
      status: "settled",
      settledMicroUsd: settledCost,
      settledInputTokens: actualInputTokens,
      settledOutputTokens: actualOutputTokens,
    });
    expect(result.events).toHaveLength(1);
  });

  test("includes semantic-search spend in the global paid-call cap", async () => {
    const t = setup();
    const dayKey = "2026-10-01";
    await t.run(async (ctx) => {
      await ctx.db.insert("aiSpendBuckets", {
        dayKey,
        provider: "openrouter",
        bucket: 15,
        spentMicroUsd: 100,
        requests: 1,
        inputTokens: 5_000,
        outputTokens: 0,
        updatedAt: 1,
      });
    });

    const result = await t.mutation(
      internal.aiRoutingControlData.reserveModelCall,
      {
        reservationKey: "route-with-semantic-spend",
        model: OPENROUTER_PAID_FALLBACK_MODEL,
        dayKey,
        estimatedInputTokens: 1_000,
        estimatedOutputTokens: 500,
        budgetLimitMicroUsd: 200,
      },
    );

    expect(result).toEqual({ accepted: false, reason: "daily-budget" });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("aiModelCallReservations").collect()).toEqual(
        [],
      );
    });
  });

  test("reserves input-only embedding calls with no generated output tokens", async () => {
    const t = setup();
    const result = await t.mutation(
      internal.aiRoutingControlData.reserveModelCall,
      {
        reservationKey: "forum-memory-embedding:test",
        model: OPENROUTER_EMBEDDING_MODEL,
        dayKey: "2026-10-02",
        estimatedInputTokens: 100,
        estimatedOutputTokens: 0,
        budgetLimitMicroUsd: 2,
      },
    );

    expect(result).toEqual({
      accepted: true,
      reservationKey: "forum-memory-embedding:test",
      estimatedMicroUsd: 2,
    });
    await t.mutation(internal.forumAgentEditorialData.recordUsage, {
      runKey: "forum-memory-embedding-usage:test",
      reservationKey: "forum-memory-embedding:test",
      agentSlug: "suki",
      stage: "embedding",
      model: OPENROUTER_EMBEDDING_MODEL,
      inputTokens: 80,
      durationMs: 5,
    });

    await t.run(async (ctx) => {
      const spend = await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q
            .eq("dayKey", "2026-10-02")
            .eq("provider", "openrouter")
            .eq("bucket", spendBucketForKey("forum-memory-embedding:test")),
        )
        .unique();
      expect(spend).toMatchObject({
        spentMicroUsd: estimatedModelCostMicroUsd(
          OPENROUTER_EMBEDDING_MODEL,
          80,
          0,
        ),
        requests: 1,
        inputTokens: 80,
        outputTokens: 0,
      });
    });
  });
});
