/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ownerConsoleSettlementPayload } from "../lib/ai-usage-settlement";
import {
  estimatedModelCostMicroUsd,
  forumDayKey,
  hasModelPrice,
  openRouterDailyBudgetMicroUsd,
} from "../lib/ai-model-costs";
import {
  OPENROUTER_FREE_GENERATION_MODELS,
  OPENROUTER_IDEATION_MODELS,
  OPENROUTER_PAID_FALLBACK_MODEL,
} from "../lib/ai-models";
import schema from "./schema";
import type { QueryCtx } from "./_generated/server";

const modules = import.meta.glob("./**/*.ts");

const reserveOwnerConsoleStep = makeFunctionReference<
  "mutation",
  { reservationKey: string; estimatedInputTokens: number },
  | { accepted: false; reason: string }
  | {
      accepted: true;
      reservationKey: string;
      estimatedMicroUsd: number;
    }
>("adminAiBudget:reserveOwnerConsoleStep");
const settleOwnerConsoleStep = makeFunctionReference<
  "mutation",
  {
    reservationKey: string;
    runKey: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    servedRoute: "free" | "paid";
    servedModel: string;
    settlementSignature?: string;
  },
  { settled: boolean }
>("adminAiBudget:settleOwnerConsoleStep");

function setup() {
  return convexTest(schema, modules);
}

async function usageEventsForRun(ctx: QueryCtx, runKey: string) {
  const recent = await ctx.db
    .query("forumAgentUsageEvents")
    .withIndex("by_createdAt")
    .order("desc")
    .take(100);
  return recent.filter((event) => event.runKey === runKey);
}

afterEach(() => vi.unstubAllEnvs());

async function seedOwnerAndReader(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      name: "Owner",
      username: "owner",
      usernameNormalized: "owner",
      role: "owner",
    });
    const readerId = await ctx.db.insert("users", {
      name: "Reader",
      username: "reader",
      usernameNormalized: "reader",
      role: "reader",
    });
    return { ownerId, readerId };
  });
}

describe("owner-console AI budget", () => {
  test("the reservation model covers every configured stream fallback", () => {
    const reservedCost = estimatedModelCostMicroUsd(
      OPENROUTER_PAID_FALLBACK_MODEL,
      1_000_000,
      1_000_000,
    );
    for (const model of OPENROUTER_IDEATION_MODELS) {
      expect(hasModelPrice(model)).toBe(true);
      expect(
        estimatedModelCostMicroUsd(model, 1_000_000, 1_000_000),
      ).toBeLessThanOrEqual(reservedCost);
    }
  });

  test("requires an owner and reserves the maximum configured stream cost", async () => {
    const t = setup();
    const { ownerId, readerId } = await seedOwnerAndReader(t);
    const owner = t.withIdentity({ subject: ownerId });
    const reader = t.withIdentity({ subject: readerId });
    const args = {
      reservationKey: "admin-ai:test:step:0:request-key",
      estimatedInputTokens: 2_000,
    };

    await expect(t.mutation(reserveOwnerConsoleStep, args)).rejects.toThrow(
      /sign in/i,
    );
    await expect(
      reader.mutation(reserveOwnerConsoleStep, args),
    ).rejects.toThrow(/owner access/i);

    const result = await owner.mutation(reserveOwnerConsoleStep, args);
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("expected budget reservation");

    const reservation = await t.run(async (ctx) =>
      ctx.db
        .query("aiModelCallReservations")
        .withIndex("by_reservationKey", (q) =>
          q.eq("reservationKey", args.reservationKey),
        )
        .unique(),
    );
    expect(reservation).toMatchObject({
      model: OPENROUTER_PAID_FALLBACK_MODEL,
      estimatedInputTokens: 2_000,
      estimatedOutputTokens: 1_200,
      status: "reserved",
    });
    expect(result.estimatedMicroUsd).toBeGreaterThan(0);
  });

  test("rejects owner-console steps when the shared daily cap is full", async () => {
    const t = setup();
    const { ownerId } = await seedOwnerAndReader(t);
    const owner = t.withIdentity({ subject: ownerId });
    const dayKey = forumDayKey();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiSpendBuckets", {
        dayKey,
        provider: "openrouter",
        bucket: 15,
        spentMicroUsd: openRouterDailyBudgetMicroUsd(undefined),
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        updatedAt: Date.now(),
      });
    });

    const result = await owner.mutation(reserveOwnerConsoleStep, {
      reservationKey: "admin-ai:test:step:0:budget-full",
      estimatedInputTokens: 2_000,
    });
    expect(result).toEqual({ accepted: false, reason: "daily-budget" });
  });

  test("rejects unbounded and malformed owner-console input estimates", async () => {
    const t = setup();
    const { ownerId } = await seedOwnerAndReader(t);
    const owner = t.withIdentity({ subject: ownerId });

    await expect(
      owner.mutation(reserveOwnerConsoleStep, {
        reservationKey: "not-an-admin-ai-reservation",
        estimatedInputTokens: 10,
      }),
    ).resolves.toEqual({ accepted: false, reason: "invalid-cost-estimate" });
    await expect(
      owner.mutation(reserveOwnerConsoleStep, {
        reservationKey: "admin-ai:test:too-large",
        estimatedInputTokens: 1_000_001,
      }),
    ).resolves.toEqual({ accepted: false, reason: "invalid-cost-estimate" });
  });

  test("settles server-attested paid stream usage idempotently", async () => {
    const t = setup();
    const { ownerId, readerId } = await seedOwnerAndReader(t);
    const owner = t.withIdentity({ subject: ownerId });
    const reader = t.withIdentity({ subject: readerId });
    const reservationKey = "admin-ai:settle-test:step:0:reservation";
    const runKey = "admin-ai:settle-test:step:0";
    const reserved = await owner.mutation(reserveOwnerConsoleStep, {
      reservationKey,
      estimatedInputTokens: 20_000,
    });
    expect(reserved.accepted).toBe(true);
    if (!reserved.accepted) throw new Error("expected budget reservation");

    const reservation = await t.run(async (ctx) =>
      ctx.db
        .query("aiModelCallReservations")
        .withIndex("by_reservationKey", (q) =>
          q.eq("reservationKey", reservationKey),
        )
        .unique(),
    );
    if (reservation === null) throw new Error("reservation was not stored");
    const actualCost = estimatedModelCostMicroUsd(
      OPENROUTER_PAID_FALLBACK_MODEL,
      1_000,
      120,
    );
    const settleArgs = {
      reservationKey,
      runKey,
      inputTokens: 1_000,
      outputTokens: 120,
      durationMs: 1_234,
      servedRoute: "paid" as const,
      servedModel: OPENROUTER_PAID_FALLBACK_MODEL,
    };
    const secret = "owner-console-settlement-test-secret-32chars";
    vi.stubEnv("AI_USAGE_SETTLEMENT_SECRET", secret);
    const settlementSignature = createHmac("sha256", secret)
      .update(ownerConsoleSettlementPayload(settleArgs))
      .digest("hex");

    await expect(
      reader.mutation(settleOwnerConsoleStep, settleArgs),
    ).rejects.toThrow(/owner access/i);
    await expect(
      owner.mutation(settleOwnerConsoleStep, {
        ...settleArgs,
        inputTokens: -1,
      }),
    ).resolves.toEqual({ settled: false });
    await expect(
      owner.mutation(settleOwnerConsoleStep, settleArgs),
    ).resolves.toEqual({ settled: false });
    await expect(
      owner.mutation(settleOwnerConsoleStep, {
        ...settleArgs,
        settlementSignature,
      }),
    ).resolves.toEqual({ settled: true });
    await expect(
      owner.mutation(settleOwnerConsoleStep, {
        ...settleArgs,
        settlementSignature,
      }),
    ).resolves.toEqual({ settled: false });

    await t.run(async (ctx) => {
      const settledReservation = await ctx.db.get(
        "aiModelCallReservations",
        reservation._id,
      );
      expect(settledReservation).toMatchObject({
        status: "settled",
        settledInputTokens: settleArgs.inputTokens,
        settledOutputTokens: settleArgs.outputTokens,
        settledMicroUsd: actualCost,
      });
      const spend = await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q
            .eq("dayKey", reservation.dayKey)
            .eq("provider", "openrouter")
            .eq("bucket", reservation.bucket),
        )
        .unique();
      expect(spend?.spentMicroUsd).toBe(actualCost);
      expect(spend?.inputTokens).toBe(settleArgs.inputTokens);
      expect(spend?.outputTokens).toBe(settleArgs.outputTokens);
      const usage = await usageEventsForRun(ctx, runKey);
      expect(usage).toHaveLength(1);
      expect(usage[0]).toMatchObject({
        agentSlug: "owner-console",
        stage: "owner-console",
        servedModel: settleArgs.servedModel,
        inputTokens: settleArgs.inputTokens,
        outputTokens: settleArgs.outputTokens,
        estimatedCostMicroUsd: actualCost,
      });
    });
  });

  test("reconciles a stream served by an explicit free model variant to zero cost", async () => {
    const t = setup();
    const { ownerId } = await seedOwnerAndReader(t);
    const owner = t.withIdentity({ subject: ownerId });
    const reservationKey = "admin-ai:free-settle:step:0:reservation";
    const runKey = "admin-ai:free-settle:step:0";
    const reserved = await owner.mutation(reserveOwnerConsoleStep, {
      reservationKey,
      estimatedInputTokens: 20_000,
    });
    expect(reserved.accepted).toBe(true);
    if (!reserved.accepted) throw new Error("expected budget reservation");

    const settleArgs = {
      reservationKey,
      runKey,
      inputTokens: 1_000,
      outputTokens: 120,
      durationMs: 1_234,
      servedRoute: "free" as const,
      servedModel: "provider/model:free",
    };
    const secret = "owner-console-settlement-test-secret-32chars";
    vi.stubEnv("AI_USAGE_SETTLEMENT_SECRET", secret);
    const settlementSignature = createHmac("sha256", secret)
      .update(ownerConsoleSettlementPayload(settleArgs))
      .digest("hex");
    await expect(
      owner.mutation(settleOwnerConsoleStep, {
        ...settleArgs,
        settlementSignature,
      }),
    ).resolves.toEqual({ settled: true });

    await t.run(async (ctx) => {
      const reservation = await ctx.db
        .query("aiModelCallReservations")
        .withIndex("by_reservationKey", (q) =>
          q.eq("reservationKey", reservationKey),
        )
        .unique();
      expect(reservation).toMatchObject({
        model: OPENROUTER_PAID_FALLBACK_MODEL,
        status: "settled",
        settledMicroUsd: 0,
        settledInputTokens: 1_000,
        settledOutputTokens: 120,
      });
      const spend = await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q
            .eq("dayKey", reservation!.dayKey)
            .eq("provider", "openrouter")
            .eq("bucket", reservation!.bucket),
        )
        .unique();
      expect(spend?.spentMicroUsd).toBe(0);
      const usage = (await usageEventsForRun(ctx, runKey))[0] ?? null;
      expect(usage).toMatchObject({
        model: OPENROUTER_FREE_GENERATION_MODELS[0],
        estimatedCostMicroUsd: 0,
        servedModel: settleArgs.servedModel,
        inputTokens: 1_000,
        outputTokens: 120,
      });
    });
  });

  test("rejects unsigned or tampered owner-console settlement data", async () => {
    const t = setup();
    const { ownerId } = await seedOwnerAndReader(t);
    const owner = t.withIdentity({ subject: ownerId });
    const reservationKey = "admin-ai:forged-free:step:0:reservation";
    const runKey = "admin-ai:forged-free:step:0";
    const reserved = await owner.mutation(reserveOwnerConsoleStep, {
      reservationKey,
      estimatedInputTokens: 20_000,
    });
    expect(reserved.accepted).toBe(true);
    if (!reserved.accepted) throw new Error("expected budget reservation");

    const settleArgs = {
      reservationKey,
      runKey,
      inputTokens: 1_000,
      outputTokens: 120,
      durationMs: 1_234,
      servedRoute: "free" as const,
      servedModel: "provider/model:free",
    };
    const secret = "owner-console-settlement-test-secret-32chars";
    vi.stubEnv("AI_USAGE_SETTLEMENT_SECRET", secret);
    const settlementSignature = createHmac("sha256", secret)
      .update(ownerConsoleSettlementPayload(settleArgs))
      .digest("hex");
    await expect(
      owner.mutation(settleOwnerConsoleStep, settleArgs),
    ).resolves.toEqual({ settled: false });
    await expect(
      owner.mutation(settleOwnerConsoleStep, {
        ...settleArgs,
        inputTokens: settleArgs.inputTokens + 1,
        settlementSignature,
      }),
    ).resolves.toEqual({ settled: false });

    await t.run(async (ctx) => {
      const reservation = await ctx.db
        .query("aiModelCallReservations")
        .withIndex("by_reservationKey", (q) =>
          q.eq("reservationKey", reservationKey),
        )
        .unique();
      if (reservation === null) throw new Error("reservation was not stored");
      expect(reservation.status).toBe("reserved");
      expect(await usageEventsForRun(ctx, runKey)).toHaveLength(0);
    });
  });
});
