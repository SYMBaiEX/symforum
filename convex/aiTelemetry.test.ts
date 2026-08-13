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
      provider: "gateway",
      model: "openai/text-embedding-3-small",
      detail: "Embedding search is available; 4 entries available.",
    };

    await t.mutation(internal.aiRoutingControlData.recordOperationalState, input);
    const first = await t.run(async (ctx) =>
      await ctx.db
        .query("aiOperationalStates")
        .withIndex("by_key", (q) => q.eq("key", input.key))
        .unique(),
    );
    await t.mutation(internal.aiRoutingControlData.recordOperationalState, input);
    const second = await t.run(async (ctx) =>
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
        model: "muse/Muse-Glimmer-30B",
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
        model: "muse/Muse-Glimmer-30B",
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
      provider: "muse",
      model: "muse/Muse-Glimmer-30B",
      outcome: "completed",
      fallback: false,
      durationMs: 1_100,
    });

    const owner = t.withIdentity({ subject: ownerId, name: "Owner" });
    const result = await owner.query(api.aiTelemetry.snapshotAdmin, {
      hours: 24,
    });

    expect(result.totals).toMatchObject({
      routeAttempts: 1,
      routeFailures: 0,
      agentRuns: 1,
      published: 1,
      inputTokens: 120,
      outputTokens: 360,
      averageQuality: 8.6,
    });
    expect(result.models).toEqual([
      expect.objectContaining({
        model: "muse/Muse-Glimmer-30B",
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

    await expect(t.query(api.aiTelemetry.snapshotAdmin, {})).rejects.toThrow(
      /sign in to continue/i,
    );
    await expect(
      reader.query(api.aiTelemetry.snapshotAdmin, {}),
    ).rejects.toThrow(/owner access/i);
  });
});
