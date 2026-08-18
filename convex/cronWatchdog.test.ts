/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const watchdog = {
  start: makeFunctionReference<"mutation", any, any>("cronWatchdog:startRun"),
  complete: makeFunctionReference<"mutation", any, any>(
    "cronWatchdog:completeRun",
  ),
  evaluate: makeFunctionReference<"mutation", any, any>(
    "cronWatchdog:evaluate",
  ),
  summary: makeFunctionReference<"query", Record<string, never>, any>(
    "cronWatchdog:summaryAdmin",
  ),
} as const;

afterEach(() => vi.unstubAllEnvs());

function setup() {
  return convexTest(schema, modules);
}

async function succeedCisa(
  t: ReturnType<typeof setup>,
  startedAt: number,
  completedAt = startedAt + 10,
) {
  const run = await t.mutation(watchdog.start, {
    jobKey: "evidence-cisa-kev",
    now: startedAt,
  });
  await t.mutation(watchdog.complete, {
    jobKey: "evidence-cisa-kev",
    runId: run.runId,
    succeeded: true,
    startedAt: run.startedAt,
    now: completedAt,
  });
}

describe("critical cron watchdog", () => {
  test("fails closed when disabled and keeps its admin summary restricted", async () => {
    const t = setup();
    await expect(
      t.mutation(watchdog.evaluate, { now: 1_800_000_000_000 }),
    ).resolves.toMatchObject({
      enabled: false,
      healthy: 0,
      unhealthy: 15,
    });
    await expect(t.query(watchdog.summary, {})).rejects.toThrow(/sign in/i);
  });

  test("records healthy, stale, failed, recovered, and deduplicated operational states", async () => {
    vi.stubEnv("CRON_WATCHDOG_ENABLED", "true");
    const t = setup();
    const now = 1_800_000_000_000;
    await t.mutation(watchdog.evaluate, { now });
    await succeedCisa(t, now);

    await expect(
      t.mutation(watchdog.evaluate, { now: now + 20 }),
    ).resolves.toMatchObject({
      enabled: true,
      healthy: 1,
    });
    await expect(
      t.mutation(watchdog.evaluate, { now: now + 3 * 60 * 60 * 1_000 + 20 }),
    ).resolves.toMatchObject({ unhealthy: 15 });
    await t.mutation(watchdog.evaluate, {
      now: now + 3 * 60 * 60 * 1_000 + 30,
    });

    const failedRun = await t.mutation(watchdog.start, {
      jobKey: "evidence-cisa-kev",
      now: now + 3 * 60 * 60 * 1_000 + 40,
    });
    await t.mutation(watchdog.complete, {
      jobKey: "evidence-cisa-kev",
      runId: failedRun.runId,
      succeeded: false,
      startedAt: failedRun.startedAt,
      failureClass: "TimeoutError",
      now: now + 3 * 60 * 60 * 1_000 + 50,
    });
    await expect(
      t.mutation(watchdog.evaluate, { now: now + 3 * 60 * 60 * 1_000 + 60 }),
    ).resolves.toMatchObject({
      states: expect.arrayContaining([
        expect.objectContaining({
          jobKey: "evidence-cisa-kev",
          status: "failed",
          consecutiveFailures: 1,
        }),
      ]),
    });

    await succeedCisa(
      t,
      now + 3 * 60 * 60 * 1_000 + 70,
      now + 3 * 60 * 60 * 1_000 + 80,
    );
    await expect(
      t.mutation(watchdog.evaluate, { now: now + 3 * 60 * 60 * 1_000 + 90 }),
    ).resolves.toMatchObject({
      states: expect.arrayContaining([
        expect.objectContaining({
          jobKey: "evidence-cisa-kev",
          status: "healthy",
          consecutiveFailures: 0,
        }),
      ]),
    });

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("systemLogs")
        .withIndex("by_fingerprint_and_createdAt", (q) =>
          q.eq("fingerprint", "cron-watchdog:evidence-cisa-kev:unhealthy"),
        )
        .collect();
      expect(logs).toHaveLength(2);
      expect(logs.every((log) => log.status === "resolved")).toBe(true);
      expect(logs.find((log) => log.occurrences === 3)).toBeDefined();
      expect(logs.every((log) => !log.message.includes("TimeoutError"))).toBe(
        true,
      );
      const runs = await ctx.db
        .query("cronJobRunSummaries")
        .withIndex("by_jobKey_and_startedAt", (q) =>
          q.eq("jobKey", "evidence-cisa-kev"),
        )
        .collect();
      expect(runs).toHaveLength(3);
      expect(runs.find((run) => run.outcome === "failed")).toMatchObject({
        failureClass: "TimeoutError",
      });
    });
  });

  test("lets site admins read only the bounded summary", async () => {
    vi.stubEnv("CRON_WATCHDOG_ENABLED", "true");
    const t = setup();
    const owner = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Owner",
        username: "owner",
        usernameNormalized: "owner",
        role: "owner",
      }),
    );
    await expect(
      t.withIdentity({ subject: owner }).query(watchdog.summary, {}),
    ).resolves.toMatchObject({
      enabled: true,
      jobs: expect.any(Array),
    });
  });

  test("materializes stale status in the evaluator instead of reading wall-clock time in the query", async () => {
    vi.stubEnv("CRON_WATCHDOG_ENABLED", "true");
    const t = setup();
    const now = 1_800_000_000_000;
    const owner = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Owner",
        username: "watchdog-owner",
        usernameNormalized: "watchdog-owner",
        role: "owner",
      }),
    );
    const admin = t.withIdentity({ subject: owner });
    await succeedCisa(t, now);
    await t.mutation(watchdog.evaluate, { now: now + 20 });
    await expect(admin.query(watchdog.summary, {})).resolves.toMatchObject({
      jobs: expect.arrayContaining([
        expect.objectContaining({
          jobKey: "evidence-cisa-kev",
          status: "healthy",
          lastEvaluatedAt: now + 20,
        }),
      ]),
    });
    const staleAt = now + 3 * 60 * 60 * 1_000 + 20;
    await t.mutation(watchdog.evaluate, { now: staleAt });
    await expect(admin.query(watchdog.summary, {})).resolves.toMatchObject({
      jobs: expect.arrayContaining([
        expect.objectContaining({
          jobKey: "evidence-cisa-kev",
          status: "stale",
          lastEvaluatedAt: staleAt,
        }),
      ]),
    });
    const source = readFileSync(
      new URL("./cronWatchdog.ts", import.meta.url),
      "utf8",
    );
    const summarySource = source.slice(
      source.indexOf("export const summaryAdmin"),
    );
    expect(summarySource).not.toContain("Date.now");
  });

  test("keeps a newer failed run authoritative when an older run succeeds late", async () => {
    vi.stubEnv("CRON_WATCHDOG_ENABLED", "true");
    const t = setup();
    const now = 1_800_000_000_000;
    const older = await t.mutation(watchdog.start, {
      jobKey: "evidence-cisa-kev",
      now,
    });
    const newer = await t.mutation(watchdog.start, {
      jobKey: "evidence-cisa-kev",
      now: now + 1,
    });
    await t.mutation(watchdog.complete, {
      jobKey: "evidence-cisa-kev",
      runId: newer.runId,
      startedAt: newer.startedAt,
      succeeded: false,
      failureClass: "TimeoutError",
      now: now + 2,
    });
    await t.mutation(watchdog.complete, {
      jobKey: "evidence-cisa-kev",
      runId: older.runId,
      startedAt: older.startedAt,
      succeeded: true,
      now: now + 3,
    });
    await expect(
      t.mutation(watchdog.evaluate, { now: now + 4 }),
    ).resolves.toMatchObject({
      states: expect.arrayContaining([
        expect.objectContaining({
          jobKey: "evidence-cisa-kev",
          status: "failed",
          consecutiveFailures: 1,
        }),
      ]),
    });
    await t.run(async (ctx) => {
      const heartbeat = await ctx.db
        .query("cronJobHeartbeats")
        .withIndex("by_jobKey", (q) => q.eq("jobKey", "evidence-cisa-kev"))
        .unique();
      expect(heartbeat).toMatchObject({
        currentRunId: newer.runId,
        status: "failed",
        consecutiveFailures: 1,
      });
      const runs = await ctx.db
        .query("cronJobRunSummaries")
        .withIndex("by_jobKey_and_startedAt", (q) =>
          q.eq("jobKey", "evidence-cisa-kev"),
        )
        .collect();
      expect(runs.find((run) => run._id === older.runId)?.outcome).toBe(
        "succeeded",
      );
    });
  });

  test("keeps a newer successful run authoritative when an older run fails late", async () => {
    vi.stubEnv("CRON_WATCHDOG_ENABLED", "true");
    const t = setup();
    const now = 1_800_000_000_000;
    const older = await t.mutation(watchdog.start, {
      jobKey: "evidence-cisa-kev",
      now,
    });
    const newer = await t.mutation(watchdog.start, {
      jobKey: "evidence-cisa-kev",
      now: now + 1,
    });
    await t.mutation(watchdog.complete, {
      jobKey: "evidence-cisa-kev",
      runId: newer.runId,
      startedAt: newer.startedAt,
      succeeded: true,
      now: now + 2,
    });
    await t.mutation(watchdog.complete, {
      jobKey: "evidence-cisa-kev",
      runId: older.runId,
      startedAt: older.startedAt,
      succeeded: false,
      failureClass: "TimeoutError",
      now: now + 3,
    });
    await expect(
      t.mutation(watchdog.evaluate, { now: now + 4 }),
    ).resolves.toMatchObject({
      states: expect.arrayContaining([
        expect.objectContaining({
          jobKey: "evidence-cisa-kev",
          status: "healthy",
          consecutiveFailures: 0,
        }),
      ]),
    });
    await t.run(async (ctx) => {
      const heartbeat = await ctx.db
        .query("cronJobHeartbeats")
        .withIndex("by_jobKey", (q) => q.eq("jobKey", "evidence-cisa-kev"))
        .unique();
      expect(heartbeat).toMatchObject({
        currentRunId: newer.runId,
        status: "healthy",
        consecutiveFailures: 0,
      });
      const logs = await ctx.db
        .query("systemLogs")
        .withIndex("by_fingerprint_and_createdAt", (q) =>
          q.eq("fingerprint", "cron-watchdog:evidence-cisa-kev:unhealthy"),
        )
        .collect();
      expect(logs).toEqual([]);
    });
  });
});
