import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  estimatedModelCostMicroUsd,
  hasModelPrice,
  openRouterReservationModel,
  spendBucketForKey,
} from "../lib/ai-model-costs";

export const STRUCTURED_CANARY_KEY = "forum-agent-structured-canary";
export const EMBEDDING_HEALTH_KEY = "forum-agent-embedding";
// The eight editorial shards and semantic retrieval's dedicated reservation
// bucket are the entire OpenRouter accounting namespace.
export const OPENROUTER_SPEND_BUCKETS = [...Array(8).keys(), 15] as const;

export function isKnownOpenRouterSpendBucket(bucket: number) {
  return OPENROUTER_SPEND_BUCKETS.includes(
    bucket as (typeof OPENROUTER_SPEND_BUCKETS)[number],
  );
}

const FREE_QUOTA_RETRY_MS = 60 * 60 * 1_000;
const GENERAL_CIRCUIT_MS = 15 * 60 * 1_000;
const FAILURE_WINDOW_MS = 30 * 60 * 1_000;
const OPERATIONAL_STATE_WRITE_MIN_INTERVAL_MS = 30 * 1_000;

type CircuitEvent = {
  model: string;
  outcome: "completed" | "failed";
  errorMessage?: string;
  now?: number;
};

export async function applyRouteCircuitEvent(
  ctx: MutationCtx,
  event: CircuitEvent,
) {
  const now = event.now ?? Date.now();
  const existing = await ctx.db
    .query("aiProviderCircuits")
    .withIndex("by_model", (q) => q.eq("model", event.model))
    .unique();

  if (event.outcome === "completed") {
    if (
      existing !== null &&
      (existing.consecutiveFailures > 0 || existing.disabledUntil > now)
    ) {
      await ctx.db.patch("aiProviderCircuits", existing._id, {
        consecutiveFailures: 0,
        reason: undefined,
        disabledUntil: 0,
        lastSuccessAt: now,
        updatedAt: now,
      });
    }
    return;
  }

  const message = event.errorMessage?.replace(/\s+/g, " ").slice(0, 240);
  const quotaFailure =
    openRouterReservationModel(event.model) !== event.model &&
    /free-models|rate limit|quota/i.test(message ?? "");
  const consecutiveFailures =
    existing?.lastFailureAt !== undefined &&
    now - existing.lastFailureAt <= FAILURE_WINDOW_MS
      ? existing.consecutiveFailures + 1
      : 1;
  const disabledUntil = quotaFailure
    ? now + FREE_QUOTA_RETRY_MS
    : consecutiveFailures >= 3
      ? now + GENERAL_CIRCUIT_MS
      : Math.max(0, existing?.disabledUntil ?? 0);
  const value = {
    model: event.model,
    consecutiveFailures,
    reason: message,
    disabledUntil,
    lastFailureAt: now,
    lastSuccessAt: existing?.lastSuccessAt,
    updatedAt: now,
  };
  if (existing === null) {
    await ctx.db.insert("aiProviderCircuits", value);
  } else {
    await ctx.db.patch("aiProviderCircuits", existing._id, value);
  }
}

export async function recordSpendBucket(
  ctx: MutationCtx,
  args: {
    dayKey: string;
    provider: string;
    bucket: number;
    spentMicroUsd: number;
    inputTokens: number;
    outputTokens: number;
    now?: number;
  },
) {
  if (args.spentMicroUsd <= 0) return;
  if (
    args.provider === "openrouter" &&
    !isKnownOpenRouterSpendBucket(args.bucket)
  ) {
    throw new ConvexError({
      code: "INVALID_OPENROUTER_SPEND_BUCKET",
      message: "OpenRouter spend bucket is not registered.",
    });
  }
  const now = args.now ?? Date.now();
  const existing = await ctx.db
    .query("aiSpendBuckets")
    .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
      q
        .eq("dayKey", args.dayKey)
        .eq("provider", args.provider)
        .eq("bucket", args.bucket),
    )
    .unique();
  if (existing === null) {
    await ctx.db.insert("aiSpendBuckets", {
      dayKey: args.dayKey,
      provider: args.provider,
      bucket: args.bucket,
      spentMicroUsd: args.spentMicroUsd,
      requests: 1,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.patch("aiSpendBuckets", existing._id, {
    spentMicroUsd: existing.spentMicroUsd + args.spentMicroUsd,
    requests: existing.requests + 1,
    inputTokens: existing.inputTokens + args.inputTokens,
    outputTokens: existing.outputTokens + args.outputTokens,
    updatedAt: now,
  });
}

export const readRoutingControl = internalQuery({
  args: {
    now: v.number(),
  },
  handler: async (ctx, args) => await readRoutingControlImpl(ctx, args.now),
});

export async function readRoutingControlImpl(ctx: QueryCtx, now: number) {
  const circuits = await ctx.db
    .query("aiProviderCircuits")
    .withIndex("by_disabledUntil", (q) => q.gt("disabledUntil", now))
    .take(20);
  return {
    disabledModelIds: circuits.map((circuit) => circuit.model),
  };
}

export const reserveModelCallArgs = {
  reservationKey: v.string(),
  model: v.string(),
  dayKey: v.string(),
  estimatedInputTokens: v.number(),
  estimatedOutputTokens: v.number(),
  budgetLimitMicroUsd: v.number(),
};

export const reserveModelCallReturns = v.union(
  v.object({ accepted: v.literal(false), reason: v.string() }),
  v.object({
    accepted: v.literal(true),
    reservationKey: v.string(),
    estimatedMicroUsd: v.number(),
  }),
);

export type ReserveModelCallArgs = {
  reservationKey: string;
  model: string;
  dayKey: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  budgetLimitMicroUsd: number;
};

/** Shared transaction logic for server-owned model budget entry points. */
export async function reserveModelCallImpl(
  ctx: MutationCtx,
  args: ReserveModelCallArgs,
) {
  if (!hasModelPrice(args.model))
    return { accepted: false as const, reason: "missing-model-price" };
  if (
    !Number.isSafeInteger(args.estimatedInputTokens) ||
    args.estimatedInputTokens <= 0 ||
    !Number.isSafeInteger(args.estimatedOutputTokens) ||
    args.estimatedOutputTokens < 0 ||
    !Number.isSafeInteger(args.budgetLimitMicroUsd) ||
    args.budgetLimitMicroUsd <= 0
  ) {
    return { accepted: false as const, reason: "invalid-cost-estimate" };
  }
  const estimatedMicroUsd = estimatedModelCostMicroUsd(
    args.model,
    args.estimatedInputTokens,
    args.estimatedOutputTokens,
  );
  if (!Number.isSafeInteger(estimatedMicroUsd) || estimatedMicroUsd <= 0)
    return { accepted: false as const, reason: "invalid-cost-estimate" };

  const existingReservation = await ctx.db
    .query("aiModelCallReservations")
    .withIndex("by_reservationKey", (q) =>
      q.eq("reservationKey", args.reservationKey),
    )
    .unique();
  if (existingReservation !== null)
    return { accepted: false as const, reason: "duplicate-reservation" };

  const spendBuckets = await ctx.db
    .query("aiSpendBuckets")
    .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
      q.eq("dayKey", args.dayKey).eq("provider", "openrouter"),
    )
    .take(16);
  // OpenRouter has eight editorial shards plus its semantic-search bucket.
  // Fail closed if the ledger ever exceeds its bounded expected footprint.
  if (spendBuckets.length > OPENROUTER_SPEND_BUCKETS.length)
    return { accepted: false as const, reason: "spend-ledger-overflow" };
  const spentMicroUsd = spendBuckets.reduce(
    (total, bucket) => total + bucket.spentMicroUsd,
    0,
  );
  const nextTotal = spentMicroUsd + estimatedMicroUsd;
  if (
    !Number.isSafeInteger(spentMicroUsd) ||
    !Number.isSafeInteger(nextTotal) ||
    nextTotal > args.budgetLimitMicroUsd
  ) {
    return { accepted: false as const, reason: "daily-budget" };
  }

  const now = Date.now();
  const bucket = spendBucketForKey(args.reservationKey);
  const spend = spendBuckets.find((row) => row.bucket === bucket);
  if (spend === undefined) {
    await ctx.db.insert("aiSpendBuckets", {
      dayKey: args.dayKey,
      provider: "openrouter",
      bucket,
      spentMicroUsd: estimatedMicroUsd,
      requests: 1,
      inputTokens: args.estimatedInputTokens,
      outputTokens: args.estimatedOutputTokens,
      updatedAt: now,
    });
  } else {
    await ctx.db.patch("aiSpendBuckets", spend._id, {
      spentMicroUsd: spend.spentMicroUsd + estimatedMicroUsd,
      requests: spend.requests + 1,
      inputTokens: spend.inputTokens + args.estimatedInputTokens,
      outputTokens: spend.outputTokens + args.estimatedOutputTokens,
      updatedAt: now,
    });
  }
  await ctx.db.insert("aiModelCallReservations", {
    reservationKey: args.reservationKey,
    model: args.model,
    dayKey: args.dayKey,
    bucket,
    estimatedMicroUsd,
    estimatedInputTokens: args.estimatedInputTokens,
    estimatedOutputTokens: args.estimatedOutputTokens,
    status: "reserved",
    createdAt: now,
    updatedAt: now,
  });
  return {
    accepted: true as const,
    reservationKey: args.reservationKey,
    estimatedMicroUsd,
  };
}

/** Settle one completed provider call while retaining its reservation's day and shard. */
export async function settleModelCallReservation(
  ctx: MutationCtx,
  args: {
    reservationKey: string;
    model: string;
    settlementModel?: string;
    inputTokens: number;
    outputTokens: number;
    providerReportedCostMicroUsd?: number;
    now?: number;
  },
) {
  const reservation = await ctx.db
    .query("aiModelCallReservations")
    .withIndex("by_reservationKey", (q) =>
      q.eq("reservationKey", args.reservationKey),
    )
    .unique();
  if (reservation === null) {
    throw new ConvexError({
      code: "AI_USAGE_RESERVATION_MISSING",
      message: "The AI usage reservation no longer exists.",
    });
  }
  if (reservation.model !== args.model) {
    throw new ConvexError({
      code: "AI_USAGE_RESERVATION_MODEL_MISMATCH",
      message: "AI usage must settle against the reserved model.",
    });
  }
  if (reservation.status === "settled")
    return { settled: false as const, estimatedCostMicroUsd: 0 };

  if (
    args.providerReportedCostMicroUsd !== undefined &&
    (!Number.isSafeInteger(args.providerReportedCostMicroUsd) ||
      args.providerReportedCostMicroUsd < 0)
  ) {
    throw new ConvexError({
      code: "AI_USAGE_PROVIDER_COST_INVALID",
      message:
        "Provider-reported AI cost must be a non-negative microdollar integer.",
    });
  }

  const settlementModel = args.settlementModel ?? args.model;
  if (
    args.providerReportedCostMicroUsd === undefined &&
    !hasModelPrice(settlementModel)
  ) {
    throw new ConvexError({
      code: "AI_USAGE_SETTLEMENT_MODEL_UNPRICED",
      message: "AI usage cannot settle against an unpriced model.",
    });
  }

  const now = args.now ?? Date.now();
  const estimatedCostMicroUsd =
    args.providerReportedCostMicroUsd ??
    estimatedModelCostMicroUsd(
      settlementModel,
      args.inputTokens,
      args.outputTokens,
    );
  const spend = await ctx.db
    .query("aiSpendBuckets")
    .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
      q
        .eq("dayKey", reservation.dayKey)
        .eq("provider", "openrouter")
        .eq("bucket", reservation.bucket),
    )
    .unique();
  if (spend === null) {
    throw new ConvexError({
      code: "AI_USAGE_RESERVATION_BUCKET_MISSING",
      message: "The AI usage reservation bucket no longer exists.",
    });
  }
  await ctx.db.patch("aiSpendBuckets", spend._id, {
    spentMicroUsd: Math.max(
      0,
      spend.spentMicroUsd -
        reservation.estimatedMicroUsd +
        estimatedCostMicroUsd,
    ),
    inputTokens: Math.max(
      0,
      spend.inputTokens - reservation.estimatedInputTokens + args.inputTokens,
    ),
    outputTokens: Math.max(
      0,
      spend.outputTokens -
        reservation.estimatedOutputTokens +
        args.outputTokens,
    ),
    updatedAt: now,
  });
  await ctx.db.patch("aiModelCallReservations", reservation._id, {
    status: "settled",
    settledMicroUsd: estimatedCostMicroUsd,
    settledInputTokens: args.inputTokens,
    settledOutputTokens: args.outputTokens,
    updatedAt: now,
  });
  return {
    settled: true as const,
    estimatedCostMicroUsd,
    usageEventId: reservation.usageEventId,
  };
}

/** Atomically reserve estimated spend before a paid OpenRouter request. */
export const reserveModelCall = internalMutation({
  args: reserveModelCallArgs,
  returns: reserveModelCallReturns,
  handler: reserveModelCallImpl,
});

/** Failed provider attempts retain their conservative reservation for the day. */
export const markModelCallFailed = internalMutation({
  args: { reservationKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reservation = await ctx.db
      .query("aiModelCallReservations")
      .withIndex("by_reservationKey", (q) =>
        q.eq("reservationKey", args.reservationKey),
      )
      .unique();
    if (reservation?.status === "reserved")
      await ctx.db.patch("aiModelCallReservations", reservation._id, {
        status: "failed",
        updatedAt: Date.now(),
      });
    return null;
  },
});

export const recordCanaryState = internalMutation({
  args: {
    healthy: v.boolean(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    detail: v.optional(v.string()),
    pauseUntil: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("aiOperationalStates")
      .withIndex("by_key", (q) => q.eq("key", STRUCTURED_CANARY_KEY))
      .unique();
    const value = {
      key: STRUCTURED_CANARY_KEY,
      healthy: args.healthy,
      provider: args.provider,
      model: args.model,
      detail: args.detail?.replace(/\s+/g, " ").slice(0, 240),
      checkedAt: now,
      pauseUntil: args.pauseUntil,
      updatedAt: now,
    };
    if (
      existing !== null &&
      now - existing.updatedAt < OPERATIONAL_STATE_WRITE_MIN_INTERVAL_MS &&
      existing.healthy === value.healthy &&
      existing.provider === value.provider &&
      existing.model === value.model &&
      existing.pauseUntil === value.pauseUntil
    ) {
      return value;
    }
    if (existing === null) await ctx.db.insert("aiOperationalStates", value);
    else await ctx.db.patch("aiOperationalStates", existing._id, value);
    return value;
  },
});

export const recordOperationalState = internalMutation({
  args: {
    key: v.string(),
    healthy: v.boolean(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    detail: v.optional(v.string()),
    pauseUntil: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("aiOperationalStates")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const value = {
      key: args.key,
      healthy: args.healthy,
      provider: args.provider,
      model: args.model,
      detail: args.detail?.replace(/\s+/g, " ").slice(0, 240),
      checkedAt: now,
      pauseUntil: args.pauseUntil ?? 0,
      updatedAt: now,
    };
    if (
      existing !== null &&
      now - existing.updatedAt < OPERATIONAL_STATE_WRITE_MIN_INTERVAL_MS &&
      existing.healthy === value.healthy &&
      existing.provider === value.provider &&
      existing.model === value.model &&
      existing.pauseUntil === value.pauseUntil
    ) {
      return value;
    }
    if (existing === null) await ctx.db.insert("aiOperationalStates", value);
    else await ctx.db.patch("aiOperationalStates", existing._id, value);
    return value;
  },
});

export const readOperationalState = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("aiOperationalStates")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique(),
});
