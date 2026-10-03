import {
  OPENROUTER_FREE_GENERATION_MODELS,
  OPENROUTER_PAID_FALLBACK_MODEL,
} from "../lib/ai-models";
import { ownerConsoleSettlementPayload } from "../lib/ai-usage-settlement";
import {
  estimatedModelCostMicroUsd,
  forumDayKey,
  openRouterSettlementRoute,
  openRouterDailyBudgetMicroUsd,
} from "../lib/ai-model-costs";
import { OWNER_ADMIN_AI_MAX_OUTPUT_TOKENS } from "../lib/ai-telemetry";
import { mutation, env } from "./_generated/server";
import {
  reserveModelCallImpl,
  reserveModelCallReturns,
  settleModelCallReservation,
} from "./aiRoutingControlData";
import { requireOwner } from "./authz";
import { v } from "convex/values";

function signatureBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function verifiesOwnerConsoleSettlement(args: {
  reservationKey: string;
  runKey: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  servedRoute: "free" | "paid";
  servedModel: string;
  providerReportedCostMicroUsd?: number;
  settlementSignature?: string;
}) {
  const secret = env.AI_USAGE_SETTLEMENT_SECRET?.trim();
  const signature = args.settlementSignature;
  if (!secret || secret.length < 32 || signature === undefined) return false;
  const signatureData = signatureBytes(signature);
  if (signatureData === null) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      signatureData,
      new TextEncoder().encode(
        ownerConsoleSettlementPayload({
          reservationKey: args.reservationKey,
          runKey: args.runKey,
          inputTokens: args.inputTokens,
          outputTokens: args.outputTokens,
          durationMs: args.durationMs,
          servedRoute: args.servedRoute,
          servedModel: args.servedModel,
          ...(args.providerReportedCostMicroUsd === undefined
            ? {}
            : {
                providerReportedCostMicroUsd: args.providerReportedCostMicroUsd,
              }),
        }),
      ),
    );
  } catch {
    return false;
  }
}

/**
 * Reserve one owner-console streamed model step against the shared daily cap.
 * The stream's configured fallbacks are the free router and the priced paid
 * rescue model, so reserve against the paid model before every step.
 */
export const reserveOwnerConsoleStep = mutation({
  args: {
    reservationKey: v.string(),
    estimatedInputTokens: v.number(),
  },
  returns: reserveModelCallReturns,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (
      !args.reservationKey.startsWith("admin-ai:") ||
      args.reservationKey.length > 240 ||
      !Number.isSafeInteger(args.estimatedInputTokens) ||
      args.estimatedInputTokens <= 0 ||
      args.estimatedInputTokens > 1_000_000
    ) {
      return { accepted: false as const, reason: "invalid-cost-estimate" };
    }
    return reserveModelCallImpl(ctx, {
      reservationKey: args.reservationKey,
      model: OPENROUTER_PAID_FALLBACK_MODEL,
      dayKey: forumDayKey(),
      estimatedInputTokens: args.estimatedInputTokens,
      estimatedOutputTokens: OWNER_ADMIN_AI_MAX_OUTPUT_TOKENS,
      budgetLimitMicroUsd: openRouterDailyBudgetMicroUsd(
        env.OPENROUTER_DAILY_BUDGET_USD,
      ),
    });
  },
});

/** Reconcile actual usage for a completed owner-console model step. */
export const settleOwnerConsoleStep = mutation({
  args: {
    reservationKey: v.string(),
    runKey: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    durationMs: v.number(),
    servedRoute: v.union(v.literal("free"), v.literal("paid")),
    servedModel: v.string(),
    providerReportedCostMicroUsd: v.optional(v.number()),
    settlementSignature: v.optional(v.string()),
  },
  returns: v.object({ settled: v.boolean() }),
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (
      !args.reservationKey.startsWith("admin-ai:") ||
      args.reservationKey.length > 240 ||
      !args.runKey.startsWith("admin-ai:") ||
      args.runKey.length > 240 ||
      !Number.isSafeInteger(args.inputTokens) ||
      args.inputTokens < 0 ||
      args.inputTokens > 1_000_000 ||
      !Number.isSafeInteger(args.outputTokens) ||
      args.outputTokens < 0 ||
      args.outputTokens > 1_000_000 ||
      !Number.isSafeInteger(args.durationMs) ||
      args.durationMs < 0 ||
      args.durationMs > 300_000 ||
      args.servedModel.trim().length === 0 ||
      args.servedModel.length > 256 ||
      (args.providerReportedCostMicroUsd !== undefined &&
        (!Number.isSafeInteger(args.providerReportedCostMicroUsd) ||
          args.providerReportedCostMicroUsd < 0)) ||
      (args.settlementSignature !== undefined &&
        args.settlementSignature.length > 128)
    ) {
      return { settled: false };
    }

    if (
      openRouterSettlementRoute(args.servedModel) !== args.servedRoute ||
      !(await verifiesOwnerConsoleSettlement(args))
    ) {
      return { settled: false };
    }
    const model = OPENROUTER_PAID_FALLBACK_MODEL;
    const settlementModel =
      args.servedRoute === "free"
        ? OPENROUTER_FREE_GENERATION_MODELS[0]
        : model;
    const settlement = await settleModelCallReservation(ctx, {
      reservationKey: args.reservationKey,
      model,
      settlementModel,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      providerReportedCostMicroUsd: args.providerReportedCostMicroUsd,
    });
    if (!settlement.settled) return { settled: false };
    await ctx.db.insert("forumAgentUsageEvents", {
      runKey: args.runKey,
      agentSlug: "owner-console",
      stage: "owner-console",
      model: settlementModel,
      servedModel: args.servedModel,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      estimatedCostMicroUsd: estimatedModelCostMicroUsd(
        settlementModel,
        args.inputTokens,
        args.outputTokens,
      ),
      ...(args.providerReportedCostMicroUsd === undefined
        ? {}
        : {
            providerReportedCostMicroUsd: args.providerReportedCostMicroUsd,
          }),
      durationMs: args.durationMs,
      createdAt: Date.now(),
    });
    return { settled: true };
  },
});
