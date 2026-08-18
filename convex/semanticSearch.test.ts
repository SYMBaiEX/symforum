import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { OPENROUTER_EMBEDDING_MODEL } from "../lib/ai-models";
import schema from "./schema";
import {
  dayKey,
  isCircuitAvailable,
  isCurrentFingerprint,
  semanticSearchConfig,
  settlementDelta,
  settlementLocation,
} from "./semanticSearch";

const modules = { ...import.meta.glob("./**/*.ts"), ...import.meta.glob("./**/*.tsx") };
const setup = () => convexTest(schema, modules);
const cleanupOperationsRef = makeFunctionReference<
  "mutation",
  { now?: number },
  { refunded: number; deleted: number; hasMore: boolean }
>("semanticSearch:cleanupExpiredOperations");
const reserveUsageRef = makeFunctionReference<
  "mutation",
  {
    operationKey: string;
    kind: "index" | "query";
    fingerprint: string;
    holder: string;
    estimatedMicroUsd: number;
    inputTokens: number;
    model: string;
    dailyBudgetMicroUsd: number;
    globalDailyBudgetMicroUsd: number;
  },
  { accepted: boolean; replay: boolean }
>("semanticSearch:reserveUsage");
const recordUsageRef = makeFunctionReference<
  "mutation",
  {
    operationKey: string;
    inputTokens: number;
    settledMicroUsd: number;
    model: string;
    outcome: "completed" | "failed";
    detail: string;
  },
  null
>("semanticSearch:recordUsage");

function reservationArgs(
  operationKey: string,
  overrides: Partial<{
    estimatedMicroUsd: number;
    dailyBudgetMicroUsd: number;
    globalDailyBudgetMicroUsd: number;
  }> = {},
) {
  return {
    operationKey,
    kind: "query" as const,
    fingerprint: operationKey,
    holder: `${operationKey}:holder`,
    estimatedMicroUsd: 10,
    inputTokens: 10,
    model: OPENROUTER_EMBEDDING_MODEL,
    dailyBudgetMicroUsd: 1_000,
    globalDailyBudgetMicroUsd: 1_000,
    ...overrides,
  };
}

describe("semantic search safety controls", () => {
  test("is disabled unless the explicit feature switch is true", () => {
    expect(semanticSearchConfig({}).enabled).toBe(false);
    expect(semanticSearchConfig({ enabled: "false" }).reason).toMatch(/not true/i);
  });

  test("uses the bounded approved OpenRouter embedding profile", () => {
    const value = semanticSearchConfig({ enabled: "true" });
    expect(value).toMatchObject({
      enabled: true,
      model: OPENROUTER_EMBEDDING_MODEL,
      dailyBudgetMicroUsd: 50_000,
    });
  });

  test("fails closed for an unpriced model or invalid budget", () => {
    expect(
      semanticSearchConfig({ enabled: "true", embeddingModel: "vendor/unpriced" }).enabled,
    ).toBe(false);
    expect(
      semanticSearchConfig({ enabled: "true", dailyBudgetUsd: "99" }).enabled,
    ).toBe(false);
  });

  test("reconciles a conservative reservation to actual provider usage", () => {
    expect(settlementDelta(100, 60)).toBe(-40);
    expect(settlementDelta(100, 100)).toBe(0);
    expect(settlementDelta(100, 140)).toBe(40);
  });

  test("failure settlement refunds the whole reservation exactly once", () => {
    // The durable operation becomes `refunded`; a replay observes a terminal
    // state and never applies this delta a second time.
    expect(settlementDelta(125, 0)).toBe(-125);
  });

  test("rejects a vector whose public document or source changed", () => {
    expect(isCurrentFingerprint("10:20", 10, 20)).toBe(true);
    expect(isCurrentFingerprint("10:20", 11, 20)).toBe(false);
    expect(isCurrentFingerprint("10:20", 10, 21)).toBe(false);
  });

  test("settles against the original UTC spend bucket across midnight", () => {
    expect(dayKey(Date.UTC(2026, 7, 18, 23, 59))).toBe("2026-08-18");
    expect(dayKey(Date.UTC(2026, 7, 19, 0, 1))).toBe("2026-08-19");
    expect(
      settlementLocation({ reservationDayKey: "2026-08-18", reservationBucket: 15 }),
    ).toEqual({ dayKey: "2026-08-18", bucket: 15 });
  });

  test("does not call the provider while the semantic circuit is paused", () => {
    expect(isCircuitAvailable(1_001, 1_000)).toBe(false);
    expect(isCircuitAvailable(1_000, 1_000)).toBe(true);
  });

  test("rejects a semantic reservation when total OpenRouter spend leaves less than its cost", async () => {
    const t = setup();
    const today = dayKey();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiSpendBuckets", {
        dayKey: today,
        provider: "openrouter",
        bucket: 3,
        spentMicroUsd: 999,
        requests: 1,
        inputTokens: 1,
        outputTokens: 0,
        updatedAt: 1,
      });
    });

    await expect(
      t.mutation(
        reserveUsageRef,
        reservationArgs("semantic:query:global-cap-rejected", {
          estimatedMicroUsd: 2,
          globalDailyBudgetMicroUsd: 1_000,
        }),
      ),
    ).resolves.toEqual({ accepted: false, replay: false });
  });

  test("accepts a semantic reservation that exactly reaches the global remaining budget", async () => {
    const t = setup();
    const today = dayKey();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiSpendBuckets", {
        dayKey: today,
        provider: "openrouter",
        bucket: 4,
        spentMicroUsd: 990,
        requests: 1,
        inputTokens: 1,
        outputTokens: 0,
        updatedAt: 1,
      });
    });

    await expect(
      t.mutation(
        reserveUsageRef,
        reservationArgs("semantic:query:global-cap-exact"),
      ),
    ).resolves.toEqual({ accepted: true, replay: false });
    await t.run(async (ctx) => {
      const semanticSpend = await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q.eq("dayKey", today).eq("provider", "openrouter").eq("bucket", 15),
        )
        .unique();
      expect(semanticSpend?.spentMicroUsd).toBe(10);
    });
  });

  test("honors the lower semantic cap even when global OpenRouter budget has room", async () => {
    const t = setup();
    const today = dayKey();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiSpendBuckets", {
        dayKey: today,
        provider: "openrouter",
        bucket: 15,
        spentMicroUsd: 45,
        requests: 1,
        inputTokens: 45,
        outputTokens: 0,
        updatedAt: 1,
      });
    });

    await expect(
      t.mutation(
        reserveUsageRef,
        reservationArgs("semantic:query:semantic-cap-rejected", {
          estimatedMicroUsd: 6,
          dailyBudgetMicroUsd: 50,
          globalDailyBudgetMicroUsd: 1_000,
        }),
      ),
    ).resolves.toEqual({ accepted: false, replay: false });
  });

  test("concurrent semantic reservations cannot exceed the effective global cap", async () => {
    const t = setup();
    const reservations = await Promise.all([
      t.mutation(reserveUsageRef, reservationArgs("semantic:query:concurrent-a", { estimatedMicroUsd: 60, globalDailyBudgetMicroUsd: 100 })),
      t.mutation(reserveUsageRef, reservationArgs("semantic:query:concurrent-b", { estimatedMicroUsd: 60, globalDailyBudgetMicroUsd: 100 })),
    ]);
    expect(reservations.filter((reservation) => reservation.accepted)).toHaveLength(1);
  });

  test("settlement and failure refund reconcile the original semantic bucket once", async () => {
    const t = setup();
    const completedOperation = "semantic:query:settlement";
    const failedOperation = "semantic:query:refund";
    await t.mutation(reserveUsageRef, reservationArgs(completedOperation));
    await t.mutation(reserveUsageRef, reservationArgs(failedOperation));

    await t.mutation(recordUsageRef, { operationKey: completedOperation, inputTokens: 4, settledMicroUsd: 4, model: OPENROUTER_EMBEDDING_MODEL, outcome: "completed", detail: "completed" });
    await t.mutation(recordUsageRef, { operationKey: failedOperation, inputTokens: 0, settledMicroUsd: 0, model: OPENROUTER_EMBEDDING_MODEL, outcome: "failed", detail: "failed" });
    await t.mutation(recordUsageRef, { operationKey: failedOperation, inputTokens: 0, settledMicroUsd: 0, model: OPENROUTER_EMBEDDING_MODEL, outcome: "failed", detail: "replayed" });

    await t.run(async (ctx) => {
      const spend = await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q.eq("dayKey", dayKey()).eq("provider", "openrouter").eq("bucket", 15),
        )
        .unique();
      expect(spend).toMatchObject({ spentMicroUsd: 4, inputTokens: 4, requests: 2 });
    });
  });

  test("refunds a crashed reservation only once", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiSpendBuckets", { dayKey: "2026-08-18", provider: "openrouter", bucket: 15, spentMicroUsd: 100, requests: 1, inputTokens: 50, outputTokens: 0, updatedAt: 1 });
      await ctx.db.insert("semanticSearchOperations", { operationKey: "semantic:query:test", kind: "query", fingerprint: "test", model: OPENROUTER_EMBEDDING_MODEL, status: "leased", holder: "worker", leaseExpiresAt: 10, reservationDayKey: "2026-08-18", reservationBucket: 15, reservedMicroUsd: 100, reservedInputTokens: 50, createdAt: 1, updatedAt: 1 });
    });
    expect((await t.mutation(cleanupOperationsRef, { now: 11 })).refunded).toBe(1);
    expect((await t.mutation(cleanupOperationsRef, { now: 12 })).refunded).toBe(0);
    await t.run(async (ctx) => {
      expect((await ctx.db.query("aiSpendBuckets").unique())?.spentMicroUsd).toBe(0);
      expect((await ctx.db.query("semanticSearchOperations").unique())?.status).toBe("refunded");
    });
  });

  test("reports continuation for a full expired lease batch", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 100; index += 1) {
        await ctx.db.insert("semanticSearchOperations", { operationKey: `semantic:query:${index}`, kind: "query", fingerprint: "x", model: OPENROUTER_EMBEDDING_MODEL, status: "leased", holder: `worker-${index}`, leaseExpiresAt: 10, reservationDayKey: "2026-08-18", reservationBucket: 15, reservedMicroUsd: 1, reservedInputTokens: 1, createdAt: 1, updatedAt: 1 });
      }
    });
    expect(await t.mutation(cleanupOperationsRef, { now: 11 })).toMatchObject({ refunded: 100, hasMore: true });
  });

  test("completed index records cannot starve an expired lease", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) await ctx.db.insert("semanticSearchOperations", { operationKey: `semantic:index:${index}`, kind: "index", fingerprint: "done", model: OPENROUTER_EMBEDDING_MODEL, status: "completed", holder: "worker", reservationDayKey: "2026-08-18", reservationBucket: 15, reservedMicroUsd: 1, reservedInputTokens: 1, settledMicroUsd: 1, settledInputTokens: 1, createdAt: 1, updatedAt: 1, completedAt: 1 });
      await ctx.db.insert("semanticSearchOperations", { operationKey: "semantic:query:leased", kind: "query", fingerprint: "x", model: OPENROUTER_EMBEDDING_MODEL, status: "leased", holder: "worker", leaseExpiresAt: 10, reservationDayKey: "2026-08-18", reservationBucket: 15, reservedMicroUsd: 1, reservedInputTokens: 1, createdAt: 1, updatedAt: 1 });
    });
    expect(await t.mutation(cleanupOperationsRef, { now: 11 })).toMatchObject({ refunded: 1, hasMore: false });
  });

  test("terminal query pruning bypasses durable index history", async () => {
    const t = setup();
    const now = 1_000_000;
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) await ctx.db.insert("semanticSearchOperations", { operationKey: `semantic:index:terminal:${index}`, kind: "index", fingerprint: "done", model: OPENROUTER_EMBEDDING_MODEL, status: "completed", holder: "worker", reservationDayKey: "2026-08-18", reservationBucket: 15, reservedMicroUsd: 1, reservedInputTokens: 1, settledMicroUsd: 1, settledInputTokens: 1, createdAt: 1, updatedAt: 1, completedAt: 1 });
      for (let index = 0; index < 2; index += 1) await ctx.db.insert("semanticSearchOperations", { operationKey: `semantic:query:terminal:${index}`, kind: "query", fingerprint: "done", model: OPENROUTER_EMBEDDING_MODEL, status: "completed", holder: "worker", reservationDayKey: "2026-08-18", reservationBucket: 15, reservedMicroUsd: 1, reservedInputTokens: 1, settledMicroUsd: 1, settledInputTokens: 1, createdAt: 1, updatedAt: 1, completedAt: 1 });
    });
    expect(await t.mutation(cleanupOperationsRef, { now })).toMatchObject({ deleted: 2, hasMore: false });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("semanticSearchOperations").collect();
      expect(rows.filter((row) => row.kind === "query")).toHaveLength(0);
      expect(rows.filter((row) => row.kind === "index")).toHaveLength(101);
    });
  });
});
