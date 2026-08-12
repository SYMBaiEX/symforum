import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";

export const STRUCTURED_CANARY_KEY = "forum-agent-structured-canary";
export const EMBEDDING_HEALTH_KEY = "forum-agent-embedding";
export const MUSE_LEASE_KEY = "muse-generation";

const FREE_QUOTA_RETRY_MS = 60 * 60 * 1_000;
const GENERAL_CIRCUIT_MS = 15 * 60 * 1_000;
const FAILURE_WINDOW_MS = 30 * 60 * 1_000;

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
      await ctx.db.patch(existing._id, {
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
    await ctx.db.patch(existing._id, value);
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
  await ctx.db.patch(existing._id, {
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

export const acquireMuseLease = internalMutation({
  args: {
    holder: v.string(),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const leaseMs = Math.max(
      30_000,
      Math.min(300_000, Math.round(args.leaseMs ?? 180_000)),
    );
    const existing = await ctx.db
      .query("aiProviderLeases")
      .withIndex("by_key", (q) => q.eq("key", MUSE_LEASE_KEY))
      .unique();
    if (
      existing !== null &&
      existing.expiresAt > now &&
      existing.holder !== args.holder
    ) {
      return {
        acquired: false as const,
        retryAfterMs: existing.expiresAt - now,
      };
    }
    const value = {
      key: MUSE_LEASE_KEY,
      holder: args.holder,
      expiresAt: now + leaseMs,
      updatedAt: now,
    };
    if (existing === null) await ctx.db.insert("aiProviderLeases", value);
    else await ctx.db.patch(existing._id, value);
    return { acquired: true as const, retryAfterMs: 0 };
  },
});

export const releaseMuseLease = internalMutation({
  args: { holder: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiProviderLeases")
      .withIndex("by_key", (q) => q.eq("key", MUSE_LEASE_KEY))
      .unique();
    if (existing === null || existing.holder !== args.holder) {
      return { released: false as const };
    }
    await ctx.db.patch(existing._id, {
      expiresAt: 0,
      updatedAt: Date.now(),
    });
    return { released: true as const };
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
    if (existing === null) await ctx.db.insert("aiOperationalStates", value);
    else await ctx.db.patch(existing._id, value);
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
    if (existing === null) await ctx.db.insert("aiOperationalStates", value);
    else await ctx.db.patch(existing._id, value);
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
