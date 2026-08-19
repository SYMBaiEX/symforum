/// <reference types="vite/client" />

import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

const runDate = "2026-08-17";
const now = 1_800_000_000_000;

type ClaimResult = { claimed: boolean; reason?: string };

async function seedFailedDailyRuns(
  t: TestConvex<typeof schema>,
  count: number,
) {
  await t.run(async (ctx) => {
    for (let slot = 0; slot < count; slot += 1) {
      await ctx.db.insert("forumAgentRuns", {
        runKey: `failed-agent:${runDate}:${slot}`,
        agentSlug: "failed-agent",
        runDate,
        slot,
        attempt: 1,
        status: "failed",
        model: "test/model",
        sourceUrls: [],
        startedAt: now,
        completedAt: now,
        updatedAt: now,
      });
    }
  });
}

describe("forum agent run claims", () => {
  test("does not create a 43rd run when failed attempts exhaust the daily limit", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.forum.ensureSukiForumInfrastructure, {});
    await seedFailedDailyRuns(t, 42);

    await expect(
      t.mutation(internal.sukiForumAgentData.claimRun, {
        attempt: 0,
        runDate,
        slot: 0,
      }),
    ).resolves.toMatchObject({
      claimed: false,
      reason: "global-daily-attempt-limit",
      runKey: `suki:${runDate}:0`,
    });
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("forumAgentRuns")
          .withIndex("by_runDate", (q) => q.eq("runDate", runDate))
          .collect(),
      ).toHaveLength(42);
    });
  });

  test("allows only one of two concurrent distinct claims into the final daily slot", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.forum.ensureSukiForumInfrastructure, {});
    await seedFailedDailyRuns(t, 41);

    const results = await Promise.all([
      t.mutation(internal.sukiForumAgentData.claimRun, {
        attempt: 0,
        runDate,
        slot: 0,
      }),
      t.mutation(internal.sukiForumAgentData.claimRun, {
        attempt: 0,
        runDate,
        slot: 1,
      }),
    ]);

    expect(results.filter((result: ClaimResult) => result.claimed)).toHaveLength(1);
    expect(results.filter((result: ClaimResult) => !result.claimed)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "global-daily-attempt-limit" }),
      ]),
    );
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("forumAgentRuns")
          .withIndex("by_runDate", (q) => q.eq("runDate", runDate))
          .collect(),
      ).toHaveLength(42);
    });
  });

  test("recovers an already-counted stale run after the daily limit is reached", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.forum.ensureSukiForumInfrastructure, {});
    await seedFailedDailyRuns(t, 41);
    await t.run(async (ctx) => {
      await ctx.db.insert("forumAgentRuns", {
        runKey: `suki:${runDate}:0`,
        agentSlug: "suki",
        runDate,
        slot: 0,
        attempt: 0,
        status: "running",
        model: "test/model",
        sourceUrls: [],
        startedAt: 0,
        updatedAt: 0,
      });
    });

    await expect(
      t.mutation(internal.sukiForumAgentData.claimRun, {
        attempt: 1,
        runDate,
        slot: 0,
      }),
    ).resolves.toMatchObject({ claimed: true, runKey: `suki:${runDate}:0` });
  });
});
