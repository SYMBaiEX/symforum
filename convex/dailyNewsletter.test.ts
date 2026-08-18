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
  test("schedule state stops terminal runs without creating duplicate send logs", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    const runDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    await t.run(async (ctx) => {
      await ctx.db.insert("newsletterSettings", {
        key: "dailyNewsletter.sendTimeLocal",
        value: "00:00",
        updatedAt: now,
      });
      await ctx.db.insert("dailyNewsletterRuns", {
        runDate,
        status: "sent",
        mode: "cron",
        sendEnabled: true,
        startedAt: now - 60_000,
        sentAt: now - 30_000,
        storyCount: 8,
        topStoryIds: [],
        updatedAt: now - 30_000,
      });
    });
    expect(
      await t.query(internal.dailyNewsletter.readDailyScheduleState, { now }),
    ).toEqual({
      runDate,
      shouldRun: false,
      reason: "daily-newsletter-already-sent",
    });
    await t.mutation(internal.dailyNewsletter.startDailyRun, {
      runDate,
      mode: "cron",
      sendEnabled: true,
      startedAt: now,
      force: false,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("newsletterSendLogs").take(10)).toEqual([]);
    });
  });

  test("cleanup removes only the historical already-sent duplicate logs", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 3; index += 1) {
        await ctx.db.insert("newsletterSendLogs", {
          runDate: "2026-08-01",
          provider: "resend",
          status: "skipped",
          errorMessage: "Daily newsletter already sent",
          createdAt: index,
        });
      }
      await ctx.db.insert("newsletterSendLogs", {
        runDate: "2026-08-01",
        provider: "resend",
        status: "skipped",
        errorMessage: "Awaiting editorial review or sending disabled",
        createdAt: 10,
      });
    });
    expect(
      await t.mutation(
        internal.dailyNewsletter.cleanupDuplicateAlreadySentLogs,
        {},
      ),
    ).toMatchObject({ removed: 3, done: true });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("newsletterSendLogs").take(10);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.errorMessage).toMatch(/Awaiting editorial review/);
    });
  });

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
