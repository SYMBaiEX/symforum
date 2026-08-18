import { ConvexError, v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";

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
    event.model.endsWith(":free") &&
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
    dayKey: v.string(),
    budgetLimitMicroUsd: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const [circuits, spendBuckets, canary] = await Promise.all([
      ctx.db
        .query("aiProviderCircuits")
        .withIndex("by_disabledUntil", (q) => q.gt("disabledUntil", args.now))
        .take(20),
      ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q.eq("dayKey", args.dayKey).eq("provider", "openrouter"),
        )
        .take(16),
      ctx.db
        .query("aiOperationalStates")
        .withIndex("by_key", (q) => q.eq("key", STRUCTURED_CANARY_KEY))
        .unique(),
    ]);
    const spentMicroUsd = spendBuckets.reduce(
      (total, bucket) => total + bucket.spentMicroUsd,
      0,
    );
    return {
      disabledModelIds: circuits.map((circuit) => circuit.model),
      spentMicroUsd,
      budgetLimitMicroUsd: args.budgetLimitMicroUsd,
      paidBudgetExceeded: spentMicroUsd >= args.budgetLimitMicroUsd,
      canary:
        canary === null
          ? null
          : {
              healthy: canary.healthy,
              provider: canary.provider,
              model: canary.model,
              detail: canary.detail,
              checkedAt: canary.checkedAt,
              pauseUntil: canary.pauseUntil,
            },
    };
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
