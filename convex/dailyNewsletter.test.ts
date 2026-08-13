/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

describe("daily newsletter retry budget", () => {
  test("spaces automatic retries and stops after three attempts", async () => {
    const t = setup();
    const runDate = "2026-08-04";
    const firstStartedAt = 1_800_000_000_000;
    const args = {
      runDate,
      mode: "cron" as const,
      sendEnabled: true,
      force: false,
    };

    const first = await t.mutation(internal.dailyNewsletter.startDailyRun, {
      ...args,
      startedAt: firstStartedAt,
    });
    expect(first.skipped).toBe(false);

    await markRunFailed(t, runDate, firstStartedAt + 60_000);
    const coolingDown = await t.mutation(
      internal.dailyNewsletter.startDailyRun,
      {
        ...args,
        startedAt: firstStartedAt + 30 * 60_000,
      },
    );
    expect(coolingDown).toMatchObject({
      skipped: true,
      reason: "Daily newsletter retry is cooling down",
    });

    const secondStartedAt = firstStartedAt + 2 * 60 * 60_000 + 60_001;
    const second = await t.mutation(internal.dailyNewsletter.startDailyRun, {
      ...args,
      startedAt: secondStartedAt,
    });
    expect(second.skipped).toBe(false);

    await markRunFailed(t, runDate, secondStartedAt + 60_000);
    const thirdStartedAt = secondStartedAt + 2 * 60 * 60_000 + 60_001;
    const third = await t.mutation(internal.dailyNewsletter.startDailyRun, {
      ...args,
      startedAt: thirdStartedAt,
    });
    expect(third.skipped).toBe(false);

    await markRunFailed(t, runDate, thirdStartedAt + 60_000);
    const exhausted = await t.mutation(internal.dailyNewsletter.startDailyRun, {
      ...args,
      startedAt: thirdStartedAt + 2 * 60 * 60_000 + 60_001,
    });
    expect(exhausted).toMatchObject({
      skipped: true,
      reason: "Daily newsletter reached its 3-attempt retry limit",
    });

    const stored = await readRun(t, runDate);
    expect(stored?.attemptCount).toBe(3);
  });

  test("allows an explicit manual retry after the automatic budget", async () => {
    const t = setup();
    const runDate = "2026-08-03";
    const startedAt = 1_800_000_000_000;

    await t.run(async (ctx) => {
      await ctx.db.insert("dailyNewsletterRuns", {
        runDate,
        status: "failed",
        mode: "cron",
        sendEnabled: true,
        startedAt,
        completedAt: startedAt + 60_000,
        attemptCount: 3,
        storyCount: 0,
        topStoryIds: [],
        errorMessage: "Generation failed",
        updatedAt: startedAt + 60_000,
      });
    });

    const manual = await t.mutation(internal.dailyNewsletter.startDailyRun, {
      runDate,
      mode: "manual",
      sendEnabled: true,
      startedAt: startedAt + 3 * 60 * 60_000,
      force: true,
    });
    expect(manual.skipped).toBe(false);

    const stored = await readRun(t, runDate);
    expect(stored).toMatchObject({
      attemptCount: 4,
      mode: "manual",
      status: "running",
    });
  });
});

type TestBackend = ReturnType<typeof setup>;

async function markRunFailed(
  t: TestBackend,
  runDate: string,
  completedAt: number,
) {
  await t.run(async (ctx) => {
    const run = await ctx.db
      .query("dailyNewsletterRuns")
      .withIndex("by_runDate", (q) => q.eq("runDate", runDate))
      .unique();
    if (run === null) {
      throw new Error("Expected a daily newsletter run");
    }
    await ctx.db.patch("dailyNewsletterRuns", run._id, {
      status: "failed",
      completedAt,
      updatedAt: completedAt,
    });
  });
}

async function readRun(t: TestBackend, runDate: string) {
  return await t.run(
    async (ctx) =>
      await ctx.db
        .query("dailyNewsletterRuns")
        .withIndex("by_runDate", (q) => q.eq("runDate", runDate))
        .unique(),
  );
}
