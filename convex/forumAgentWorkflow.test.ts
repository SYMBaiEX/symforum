/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import { adaptivePublicationSlot } from "../lib/forum-agent-cadence";
import { structuredCanaryBlockReason } from "./forumAgentWorkflow";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

describe("forum agent publication workflow", () => {
  test("fails closed for missing, unhealthy, and stale structured canaries", () => {
    const now = 1_800_000_000_000;
    expect(structuredCanaryBlockReason(null, now)).toBe(
      "structured-canary-missing",
    );
    expect(
      structuredCanaryBlockReason({ healthy: false, checkedAt: now }, now),
    ).toBe("structured-canary-unhealthy");
    expect(
      structuredCanaryBlockReason(
        { healthy: true, checkedAt: now - 2 * 60 * 60 * 1_000 - 1 },
        now,
      ),
    ).toBe("structured-canary-stale");
    expect(
      structuredCanaryBlockReason({ healthy: true, checkedAt: now }, now),
    ).toBeNull();
  });

  test("opens a bounded failure circuit before failed routes can consume all slots", async () => {
    const t = convexTest(schema, modules);
    const runDate = "2026-08-17";
    const agentSlug = "attempt-capped-agent";
    const slot = Array.from({ length: 91 }, (_, candidate) => candidate).find(
      (candidate) =>
        adaptivePublicationSlot({
          agentSlug,
          runDate,
          slot: candidate,
          dailyLimit: 42,
        }),
    );
    expect(slot).toBeTypeOf("number");

    await t.run(async (ctx) => {
      await ctx.db.insert("aiOperationalStates", {
        key: "forum-agent-structured-canary",
        healthy: true,
        checkedAt: Date.now(),
        pauseUntil: 0,
        updatedAt: Date.now(),
      });
      const userId = await ctx.db.insert("users", {
        name: "Attempt Capped Agent",
        username: agentSlug,
        usernameNormalized: agentSlug,
      });
      await ctx.db.insert("forumAgents", {
        slug: agentSlug,
        name: "Attempt Capped Agent",
        userId,
        persona: "Test agent",
        model: "test/model",
        dailyPostTarget: 42,
        enabled: true,
        createdAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
      });
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await ctx.db.insert("forumAgentRuns", {
          runKey: `other-agent:${runDate}:${attempt}`,
          agentSlug: "other-agent",
          runDate,
          slot: attempt,
          attempt: 1,
          status: "failed",
          model: "test/model",
          sourceUrls: [],
          startedAt: 1_800_000_000_000,
          completedAt: 1_800_000_000_000,
          updatedAt: 1_800_000_000_000,
        });
      }
    });

    await expect(
      t.mutation(internal.forumAgentWorkflow.queuePublication, {
        agentSlug,
        slot: slot!,
        runDate,
      }),
    ).resolves.toEqual({ queued: false, reason: "global-failure-circuit" });
  });
});
