/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import {
  assertCronTargetSucceeded,
  executeActionTarget,
  executeMutationTarget,
} from "./cronWatchdog";
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
  actionJob: makeFunctionReference<"action", any, any>(
    "cronWatchdog:runActionJob",
  ),
  mutationJob: makeFunctionReference<"action", any, any>(
    "cronWatchdog:runMutationJob",
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
      unhealthy: 17,
    });
    await expect(t.query(watchdog.summary, {})).rejects.toThrow(/sign in/i);
  });

  test("runs unmonitored action and mutation targets once without heartbeat records", async () => {
    const t = setup();
    await expect(
      t.action(watchdog.actionJob, { jobKey: "evidence-first-party" }),
    ).resolves.toEqual({ executed: true, monitored: false });
    await expect(
      t.action(watchdog.mutationJob, { jobKey: "web-vitals-slo" }),
    ).resolves.toEqual({ executed: true, monitored: false });
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("evidenceSources")
          .withIndex("by_sourceKey", (q) =>
            q.eq("sourceKey", "symbaiex-first-party-research"),
          )
          .unique(),
      ).not.toBeNull();
      expect(await ctx.db.query("cronJobHeartbeats").take(1)).toEqual([]);
      expect(await ctx.db.query("cronJobRunSummaries").take(1)).toEqual([]);
    });
  });

  test("dispatches each target once and propagates target failures", async () => {
    const action = vi.fn().mockResolvedValue(null);
    await executeActionTarget(
      { runAction: action } as unknown as Pick<ActionCtx, "runAction">,
      "evidence-first-party",
    );
    await executeActionTarget(
      { runAction: action } as unknown as Pick<ActionCtx, "runAction">,
      "newsletter-schedule",
    );
    expect(action).toHaveBeenCalledTimes(2);

    const mutation = vi.fn().mockResolvedValue(null);
    await executeMutationTarget(
      { runMutation: mutation } as unknown as Pick<ActionCtx, "runMutation">,
      "web-vitals-slo",
    );
    await executeMutationTarget(
      { runMutation: mutation } as unknown as Pick<ActionCtx, "runMutation">,
      "evidence-webhook-recovery",
    );
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), { limit: 50 });

    const actionFailure = vi.fn().mockRejectedValue(new Error("target failed"));
    await expect(
      executeActionTarget(
        { runAction: actionFailure } as unknown as Pick<ActionCtx, "runAction">,
        "evidence-first-party",
      ),
    ).rejects.toThrow("target failed");
    expect(actionFailure).toHaveBeenCalledTimes(1);

    const mutationFailure = vi
      .fn()
      .mockRejectedValue(new Error("target failed"));
    await expect(
      executeMutationTarget(
        {
          runMutation: mutationFailure,
        } as unknown as Pick<ActionCtx, "runMutation">,
        "web-vitals-slo",
      ),
    ).rejects.toThrow("target failed");
    expect(mutationFailure).toHaveBeenCalledTimes(1);
  });

  test("fails resolved targets that report an unhealthy domain result", () => {
    expect(() => assertCronTargetSucceeded({ ok: false })).toThrowError(
      expect.objectContaining({ name: "CronTargetReportedFailure" }),
    );
    expect(() => assertCronTargetSucceeded({ healthy: false })).toThrowError(
      expect.objectContaining({ name: "CronTargetReportedFailure" }),
    );
    expect(() =>
      assertCronTargetSucceeded({ status: "degraded" }),
    ).toThrowError(
      expect.objectContaining({ name: "CronTargetReportedFailure" }),
    );
    expect(() => assertCronTargetSucceeded({ enabled: false })).not.toThrow();
    expect(() => assertCronTargetSucceeded({ ok: true })).not.toThrow();
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
    ).resolves.toMatchObject({ unhealthy: 17 });
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

  test("uses cadence-appropriate stale windows for newsletter scheduling and webhook recovery", async () => {
    vi.stubEnv("CRON_WATCHDOG_ENABLED", "true");
    const t = setup();
    const now = 1_800_000_000_000;
    for (const jobKey of [
      "newsletter-schedule",
      "evidence-webhook-recovery",
    ] as const) {
      const run = await t.mutation(watchdog.start, { jobKey, now });
      await t.mutation(watchdog.complete, {
        jobKey,
        runId: run.runId,
        succeeded: true,
        startedAt: run.startedAt,
        now: now + 10,
      });
    }

    await expect(
      t.mutation(watchdog.evaluate, { now: now + 15 * 60 * 1_000 }),
    ).resolves.toMatchObject({
      states: expect.arrayContaining([
        expect.objectContaining({
          jobKey: "newsletter-schedule",
          status: "healthy",
        }),
        expect.objectContaining({
          jobKey: "evidence-webhook-recovery",
          status: "healthy",
        }),
      ]),
    });
    await expect(
      t.mutation(watchdog.evaluate, { now: now + 15 * 60 * 1_000 + 11 }),
    ).resolves.toMatchObject({
      states: expect.arrayContaining([
        expect.objectContaining({
          jobKey: "newsletter-schedule",
          status: "healthy",
        }),
        expect.objectContaining({
          jobKey: "evidence-webhook-recovery",
          status: "stale",
        }),
      ]),
    });
    await expect(
      t.mutation(watchdog.evaluate, { now: now + 30 * 60 * 1_000 + 11 }),
    ).resolves.toMatchObject({
      states: expect.arrayContaining([
        expect.objectContaining({
          jobKey: "newsletter-schedule",
          status: "stale",
        }),
      ]),
    });
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
