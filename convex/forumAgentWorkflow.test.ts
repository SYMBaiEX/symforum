/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import { adaptivePublicationSlot } from "../lib/forum-agent-cadence";
import {
  resolveExistingRunFromAgentDayRange,
  structuredCanaryBlockReason,
} from "./forumAgentWorkflow";
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

  test("reuses the complete per-agent/day range instead of point-reading the run key", async () => {
    const existing = { runKey: "suki:2026-08-17:0", status: "published" };
    const loadByRunKey = vi.fn(async () => null);

    await expect(
      resolveExistingRunFromAgentDayRange(
        [existing],
        existing.runKey,
        loadByRunKey,
      ),
    ).resolves.toBe(existing);
    expect(loadByRunKey).not.toHaveBeenCalled();

    const noMatchLookup = vi.fn(async () => null);
    await expect(
      resolveExistingRunFromAgentDayRange(
        [],
        "suki:2026-08-17:1",
        noMatchLookup,
      ),
    ).resolves.toBeNull();
    expect(noMatchLookup).not.toHaveBeenCalled();
  });

  test("preserves the exact lookup when the bounded range is saturated or ambiguous", async () => {
    const target = { runKey: "suki:2026-08-17:0", status: "published" };
    const saturatedRange = Array.from({ length: 40 }, (_, index) => ({
      runKey: `suki:2026-08-17:${index + 1}`,
    }));
    const loadSaturated = vi.fn(async () => target);
    await expect(
      resolveExistingRunFromAgentDayRange(
        saturatedRange,
        target.runKey,
        loadSaturated,
      ),
    ).resolves.toBe(target);
    expect(loadSaturated).toHaveBeenCalledOnce();

    const duplicate = { runKey: target.runKey };
    const loadAmbiguous = vi.fn(async () => target);
    await expect(
      resolveExistingRunFromAgentDayRange(
        [duplicate, duplicate],
        target.runKey,
        loadAmbiguous,
      ),
    ).resolves.toBe(target);
    expect(loadAmbiguous).toHaveBeenCalledOnce();
  });

  test("skips dormant roster slots before reading the shared AI canary", async () => {
    const t = convexTest(schema, modules);
    const agentSlug = "dormant-roster-agent";

    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Dormant Roster Agent",
        username: agentSlug,
        usernameNormalized: agentSlug,
      });
      await ctx.db.insert("forumAgents", {
        slug: agentSlug,
        name: "Dormant Roster Agent",
        userId,
        persona: "Test agent",
        model: "unassigned",
        dailyPostTarget: 0,
        enabled: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(internal.forumAgentWorkflow.queuePublication, {
        agentSlug,
        slot: 0,
        runDate: "2026-10-02",
      }),
    ).resolves.toEqual({ queued: false, reason: "agent-disabled" });
  });

  test("opens a bounded failure circuit before failed routes can consume all slots", async () => {
    const t = convexTest(schema, modules);
    const runDate = "2026-08-17";
    const agentSlug = "attempt-capped-agent";
    const slot = Array.from({ length: 37 }, (_, candidate) => candidate).find(
      (candidate) =>
        adaptivePublicationSlot({
          agentSlug,
          runDate,
          slot: candidate,
          dailyLimit: 18,
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
