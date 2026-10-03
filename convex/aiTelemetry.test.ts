/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

describe("AI telemetry", () => {
  test("deduplicates healthy operational heartbeats within the write window", async () => {
    const t = setup();
    const input = {
      key: "forum-agent-embedding",
      healthy: true,
      provider: "openrouter",
      model: "openai/text-embedding-3-small",
      detail: "Embedding search is available; 4 entries available.",
    };

    await t.mutation(
      internal.aiRoutingControlData.recordOperationalState,
      input,
    );
    const first = await t.run(
      async (ctx) =>
        await ctx.db
          .query("aiOperationalStates")
          .withIndex("by_key", (q) => q.eq("key", input.key))
          .unique(),
    );
    await t.mutation(
      internal.aiRoutingControlData.recordOperationalState,
      input,
    );
    const second = await t.run(
      async (ctx) =>
        await ctx.db
          .query("aiOperationalStates")
          .withIndex("by_key", (q) => q.eq("key", input.key))
          .unique(),
    );

    expect(first?.updatedAt).toBe(second?.updatedAt);
  });

  test("aggregates route, agent, and usage history for the owner", async () => {
    const t = setup();
    const now = Date.now();
    const ownerId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Owner",
        username: "owner",
        usernameNormalized: "owner",
        role: "owner",
      });
      await ctx.db.insert("forumAgentRuns", {
        runKey: "suki:2026-08-11:1",
        agentSlug: "suki",
        runDate: "2026-08-11",
        slot: 1,
        attempt: 1,
        status: "published",
        model: "nvidia/nemotron-3-super-120b-a12b:free",
        sourceUrls: [],
        qualityScore: 8.6,
        startedAt: now - 2_000,
        completedAt: now - 500,
        updatedAt: now - 500,
      });
      await ctx.db.insert("forumAgentUsageEvents", {
        runKey: "suki:2026-08-11:1",
        agentSlug: "suki",
        stage: "draft",
        model: "openrouter/free",
        requestedModel: "openrouter/free",
        servedModel: "nvidia/nemotron-3-super-120b-a12b:free",
        inputTokens: 120,
        outputTokens: 360,
        durationMs: 1_200,
        createdAt: now - 1_000,
      });
      return userId;
    });

    await t.mutation(internal.aiTelemetry.recordRouteEvent, {
      correlationId: "forum:suki:2026-08-11:1",
      feature: "forum-agent",
      runKey: "suki:2026-08-11:1",
      agentSlug: "suki",
      stage: "draft",
      attempt: 1,
      provider: "openrouter",
      model: "openrouter/free",
      outcome: "completed",
      fallback: false,
      durationMs: 1_100,
    });

    const owner = t.withIdentity({ subject: ownerId, name: "Owner" });
    const result = await owner.query(api.aiTelemetry.snapshotAdmin, {
      hours: 24,
      now,
    });

    expect(result.generatedAt).toBe(now);
    expect(result.totals).toMatchObject({
      routeAttempts: 1,
      routeFailures: 0,
      agentRuns: 1,
      published: 1,
      inputTokens: 120,
      outputTokens: 360,
      averageQuality: 8.6,
      p50DurationMs: 1_200,
      revisionSamples: 0,
      revisionImprovementRate: 0,
    });
    expect(result.models).toEqual([
      expect.objectContaining({
        model: "openrouter/free",
        attempts: 1,
        inputTokens: 120,
        outputTokens: 360,
      }),
    ]);
    expect(result.agents).toEqual([
      expect.objectContaining({
        agentSlug: "suki",
        runs: 1,
        published: 1,
        averageQuality: 8.6,
      }),
    ]);
    expect(result.recent[0]).toMatchObject({
      agentSlug: "suki",
      correlationId: "forum:suki:2026-08-11:1",
    });
    expect(result.recent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "usage",
          requestedModel: "openrouter/free",
          servedModel: "nvidia/nemotron-3-super-120b-a12b:free",
          inputTokens: 120,
          outputTokens: 360,
          durationMs: 1_200,
        }),
      ]),
    );
  });

  test("keeps the telemetry snapshot owner-only", async () => {
    const t = setup();
    const readerId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Reader",
        username: "reader",
        usernameNormalized: "reader",
        role: "reader",
      }),
    );
    const reader = t.withIdentity({ subject: readerId, name: "Reader" });

    await expect(
      t.query(api.aiTelemetry.snapshotAdmin, { now: Date.now() }),
    ).rejects.toThrow(/sign in to continue/i);
    await expect(
      reader.query(api.aiTelemetry.snapshotAdmin, { now: Date.now() }),
    ).rejects.toThrow(/owner access/i);
  });

  test("reports revision lift with its sample size and improvement rate", async () => {
    const t = setup();
    const now = Date.now();
    const ownerId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Owner",
        username: "owner-revision-lift",
        usernameNormalized: "owner-revision-lift",
        role: "owner",
      });
      for (const runKey of ["run-1", "run-2"]) {
        await ctx.db.insert("forumAgentUsageEvents", {
          runKey,
          agentSlug: "suki",
          stage: "draft",
          model: "openrouter/free",
          durationMs: 1_000,
          createdAt: now,
        });
      }
      for (const revision of [
        { runKey: "run-1", qualityBefore: 70, qualityAfter: 82 },
        { runKey: "run-2", qualityBefore: 90, qualityAfter: 90 },
      ]) {
        await ctx.db.insert("forumAgentUsageEvents", {
          ...revision,
          agentSlug: "suki",
          stage: "revision",
          model: "openrouter/free",
          durationMs: 1_000,
          createdAt: now,
        });
      }
      return userId;
    });

    const owner = t.withIdentity({ subject: ownerId, name: "Owner" });
    const result = await owner.query(api.aiTelemetry.snapshotAdmin, {
      hours: 24,
      now,
    });

    expect(result.totals).toMatchObject({
      revisionRate: 100,
      averageRevisionGain: 6,
      revisionSamples: 2,
      revisionImprovementRate: 50,
    });
    expect(result.agents).toEqual([
      expect.objectContaining({
        agentSlug: "suki",
        averageRevisionGain: 6,
        revisionSamples: 2,
        revisionImprovementRate: 50,
      }),
    ]);
  });

  test("separates failed-attempt budget holds from settled model spend", async () => {
    const t = setup();
    const now = Date.now();
    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Owner",
        username: "owner-costs",
        usernameNormalized: "owner-costs",
        role: "owner",
      }),
    );
    await t.mutation(internal.aiTelemetry.recordRouteEvent, {
      correlationId: "suki:run:1",
      feature: "forum-agent",
      agentSlug: "suki",
      stage: "suki:forum-draft",
      attempt: 2,
      provider: "openrouter",
      model: "~deepseek/deepseek-v4-flash-latest",
      outcome: "failed",
      fallback: true,
      durationMs: 120_000,
      estimatedCostMicroUsd: 42_500,
      errorMessage: "timed out",
    });
    await t.mutation(internal.aiTelemetry.recordRouteEvent, {
      correlationId: "suki:run:3",
      feature: "forum-agent",
      agentSlug: "suki",
      stage: "suki:forum-draft",
      attempt: 2,
      provider: "openrouter",
      model: "~deepseek/deepseek-v4-flash-latest",
      outcome: "completed",
      fallback: true,
      durationMs: 2_000,
      estimatedCostMicroUsd: 900,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("forumAgentUsageEvents", {
        runKey: "suki:run:2",
        agentSlug: "suki",
        stage: "draft",
        model: "~deepseek/deepseek-v4-flash-latest",
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostMicroUsd: 13,
        durationMs: 2_000,
        createdAt: now,
      });
    });

    const owner = t.withIdentity({ subject: ownerId, name: "Owner" });
    const result = await owner.query(api.aiTelemetry.snapshotAdmin, {
      hours: 24,
      now,
    });

    expect(result.totals).toMatchObject({
      estimatedSpendUsd: 0.000013,
      failedAttemptReserveUsd: 0.0425,
    });
    expect(result.models).toEqual([
      expect.objectContaining({
        model: "~deepseek/deepseek-v4-flash-latest",
        estimatedCostMicroUsd: 13,
        failedAttemptReserveMicroUsd: 42_500,
        fallbacks: 2,
        fallbackFailures: 1,
      }),
    ]);
    expect(result.series).toEqual([
      expect.objectContaining({
        failures: 1,
        failedAttemptReserveMicroUsd: 42_500,
      }),
    ]);
  });

  test("reports missing price attribution without flagging explicit free models", async () => {
    const t = setup();
    const now = Date.now();
    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Owner",
        username: "owner-cost-coverage",
        usernameNormalized: "owner-cost-coverage",
        role: "owner",
      }),
    );
    await t.mutation(internal.aiTelemetry.recordRouteEvent, {
      correlationId: "canary-unpriced",
      feature: "model-route-canary",
      stage: "canary",
      attempt: 2,
      provider: "openrouter",
      model: "~deepseek/deepseek-v4-flash-latest",
      outcome: "completed",
      fallback: true,
      durationMs: 2_000,
      estimatedCostMicroUsd: 0,
    });
    await t.mutation(internal.aiTelemetry.recordRouteEvent, {
      correlationId: "canary-free",
      feature: "model-route-canary",
      stage: "canary",
      attempt: 1,
      provider: "openrouter",
      model: "openrouter/free",
      outcome: "completed",
      fallback: false,
      durationMs: 1_000,
      estimatedCostMicroUsd: 0,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("forumAgentUsageEvents", {
        runKey: "paid-usage-unpriced",
        agentSlug: "system",
        stage: "canary",
        model: "deepseek/deepseek-v4-flash-0731",
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostMicroUsd: 0,
        durationMs: 2_000,
        createdAt: now,
      });
      await ctx.db.insert("forumAgentUsageEvents", {
        runKey: "free-usage-known",
        agentSlug: "system",
        stage: "canary",
        model: "nvidia/nemotron-3-super-120b-a12b:free",
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostMicroUsd: 0,
        durationMs: 1_000,
        createdAt: now,
      });
    });

    const owner = t.withIdentity({ subject: ownerId, name: "Owner" });
    const result = await owner.query(api.aiTelemetry.snapshotAdmin, {
      hours: 24,
      now,
    });

    expect(result.costCoverage).toEqual({
      unpricedRouteAttempts: 1,
      unpricedUsageEvents: 1,
      providerReportedUsageEvents: 0,
    });
    expect(result.bounded).toEqual({
      routes: false,
      runs: false,
      replies: false,
      usage: false,
      newsletters: false,
    });
  });

  test("prefers provider-reported cost over model-rate estimates", async () => {
    const t = setup();
    const now = Date.now();
    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Owner",
        username: "owner-provider-cost",
        usernameNormalized: "owner-provider-cost",
        role: "owner",
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("forumAgentUsageEvents", {
        runKey: "provider-cost-receipt",
        agentSlug: "suki",
        stage: "draft",
        model: "vendor/unlisted-model",
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostMicroUsd: 900,
        providerReportedCostMicroUsd: 37,
        durationMs: 2_000,
        createdAt: now,
      });
    });

    const owner = t.withIdentity({ subject: ownerId, name: "Owner" });
    const result = await owner.query(api.aiTelemetry.snapshotAdmin, {
      hours: 24,
      now,
    });

    expect(result.totals).toMatchObject({
      estimatedSpendUsd: 0.000037,
      providerReportedSpendUsd: 0.000037,
    });
    expect(result.costCoverage).toEqual({
      unpricedRouteAttempts: 0,
      unpricedUsageEvents: 0,
      providerReportedUsageEvents: 1,
    });
    expect(result.models[0]?.estimatedCostMicroUsd).toBe(37);
    expect(result.agents[0]?.estimatedCostMicroUsd).toBe(37);
    expect(result.stages[0]?.estimatedCostMicroUsd).toBe(37);
    expect(result.series[0]?.estimatedCostMicroUsd).toBe(37);
    expect(result.recent[0]).toMatchObject({
      kind: "usage",
      providerReportedCostMicroUsd: 37,
    });
  });
});
