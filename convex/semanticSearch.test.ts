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
});
