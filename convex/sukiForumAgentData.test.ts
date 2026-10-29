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

describe("forum agent run claims and feed caching", () => {
  test("reads and upserts bounded research-feed cache batches", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const cacheEntry = (
      cacheKey: string,
      payloadJson: string,
      expiresAt: number,
    ) => ({
      cacheKey,
      sourceName: "Test feed",
      feedUrl: "https://example.com/feed.xml",
      payloadJson,
      fetchedAt: now,
      expiresAt,
    });

    await expect(
      t.mutation(internal.sukiForumAgentData.writeResearchCaches, {
        entries: [
          cacheEntry("active", "first", now + 60_000),
          cacheEntry("expired", "old", now - 1),
        ],
      }),
    ).resolves.toEqual({ written: 2 });

    await expect(
      t.query(internal.sukiForumAgentData.readResearchCaches, {
        cacheKeys: ["active", "expired", "missing"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ cacheKey: "active", payloadJson: "first" }),
    ]);

    await t.mutation(internal.sukiForumAgentData.writeResearchCaches, {
      entries: [cacheEntry("active", "updated", now + 120_000)],
    });
    await expect(
      t.query(internal.sukiForumAgentData.readResearchCaches, {
        cacheKeys: ["active"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ cacheKey: "active", payloadJson: "updated" }),
    ]);
  });

  test("allows failures below the guard without consuming publication capacity", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.forum.ensureSukiForumInfrastructure, {});
    await seedFailedDailyRuns(t, 11);

    await expect(
      t.mutation(internal.sukiForumAgentData.claimRun, {
        attempt: 0,
        runDate,
        slot: 0,
      }),
    ).resolves.toMatchObject({
      claimed: true,
      runKey: `suki:${runDate}:0`,
    });
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("forumAgentRuns")
          .withIndex("by_runDate", (q) => q.eq("runDate", runDate))
          .collect(),
      ).toHaveLength(12);
    });
  });

  test("opens a bounded circuit after repeated failed routes", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.forum.ensureSukiForumInfrastructure, {});
    await seedFailedDailyRuns(t, 12);

    await expect(
      t.mutation(internal.sukiForumAgentData.claimRun, {
        attempt: 0,
        runDate,
        slot: 0,
      }),
    ).resolves.toMatchObject({
      claimed: false,
      reason: "global-failure-circuit",
    });
  });

  test("recovers an already-counted stale run after the daily limit is reached", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.forum.ensureSukiForumInfrastructure, {});
    await seedFailedDailyRuns(t, 11);
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

test.each(["skipped", "failed", "running"] as const)(
  "preserves a previous alpha %s without replay or metadata changes",
  async (status) => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.forum.ensureSukiForumInfrastructure, {});
    const id = await t.run((ctx) =>
      ctx.db.insert("forumAgentRuns", {
        runKey: `suki:${runDate}:0`,
        agentSlug: "suki",
        runDate,
        slot: 0,
        attempt: 0,
        status,
        model: "test/model",
        sourceUrls: [],
        promptVersion: "roster:alpha-v1:brief-v2:suki",
        errorMessage: "Existing review or execution hold",
        startedAt: 1,
        updatedAt: 1,
      }),
    );
    const before = await t.run((ctx) => ctx.db.get("forumAgentRuns", id));
    await expect(
      t.mutation(internal.sukiForumAgentData.claimRun, {
        runDate,
        slot: 0,
        attempt: 1,
      }),
    ).resolves.toMatchObject({
      claimed: false,
      reason: "alpha-already-attempted",
    });
    expect(await t.run((ctx) => ctx.db.get("forumAgentRuns", id))).toEqual(
      before,
    );
  },
);
