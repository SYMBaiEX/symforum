import type { ForumPluginPrincipal } from "./forumPluginPrincipal";
import { FORUM_REQUEST_RATES } from "../lib/forum-usage-policy";
import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { makeFunctionReference } from "convex/server";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  hasSiteAdminAccess,
  isActiveAgentUser,
  requireAuthenticatedUser,
  getCurrentUser,
} from "./authz";
import { stableEventScope, usageEvent } from "../lib/usage-budget-events";

const usageWebhookRef = makeFunctionReference<
  "mutation",
  {
    eventKey: string;
    eventType:
      | "evidence.usage.threshold_reached"
      | "evidence.usage.budget_reached";
    payloadJson: string;
    ownerUserId: Id<"users">;
  },
  { eventId: Id<"apiWebhookEvents"> | null; enqueued: number }
>("evidenceWebhooks:enqueueEvent");

/** One unit is an app-defined bounded operation, not a payment or currency. */
export const FREE_MONTHLY_ALLOWANCE_UNITS = 100;
export const DEFAULT_HARD_CAP_UNITS = 1_000;
export const DEFAULT_PER_AGENT_MONTHLY_LIMIT_UNITS = 250;
export const DEFAULT_REQUEST_LIMIT_UNITS = 25;
export const MAX_QUOTA_UNITS = 1_000_000_000;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 160;
export const MAX_OPERATION_LENGTH = 80;
export const MAX_REQUEST_FINGERPRINT_LENGTH = 128;
export const DEFAULT_HARD_CAP_METADATA_JSON = JSON.stringify({
  source: "free-allowance",
  paymentProcessing: false,
  enforcement: "server-side",
});

const quotaRateLimiter = new RateLimiter(components.rateLimiter, {
  forumOwnerReads: {
    kind: "token bucket",
    rate: FORUM_REQUEST_RATES.read.ownerPerMinute,
    period: MINUTE,
    capacity: FORUM_REQUEST_RATES.read.ownerBurst,
    // Connected navigation fans out concurrently; preserve the aggregate
    // ceiling without serializing every page read on one owner bucket.
    shards: 4,
  },
  forumCredentialReads: {
    kind: "token bucket",
    rate: FORUM_REQUEST_RATES.read.credentialPerMinute,
    period: MINUTE,
    capacity: FORUM_REQUEST_RATES.read.credentialBurst,
    shards: 4,
  },
  forumOwnerWrites: {
    kind: "token bucket",
    rate: FORUM_REQUEST_RATES.write.ownerPerMinute,
    period: MINUTE,
    capacity: FORUM_REQUEST_RATES.write.ownerBurst,
  },
  forumCredentialWrites: {
    kind: "token bucket",
    rate: FORUM_REQUEST_RATES.write.credentialPerMinute,
    period: MINUTE,
    capacity: FORUM_REQUEST_RATES.write.credentialBurst,
  },
  agentQuotaRequests: {
    kind: "token bucket",
    rate: 60,
    period: MINUTE,
    capacity: 20,
  },
  agentOwnerQuotaRequests: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 10,
    // Every agent enrolled by one owner shares this budget. Two shards keep
    // concurrent fleet writes from contending on one limiter document while
    // preserving the same aggregate ceiling.
    shards: 2,
  },
});

type IdentityDoc = Doc<"agentIdentities">;

export type AgentQuotaConsumeResult = {
  accepted: boolean;
  idempotent: boolean;
  agentId: string;
  ownerUserId: Id<"users">;
  monthKey: string;
  units: number;
  usedUnits: number;
  remainingUnits: number;
  agentUsedUnits: number;
  agentRemainingUnits: number;
  freeAllowanceUnits: number;
  hardCapUnits: number;
  hardCapReached: boolean;
  hardCapReachedAt?: number;
  hardCapMetadataJson: string;
  reason?: "hard-cap" | "agent-limit" | "request-limit" | "rate-limited";
  retryAfter?: number;
  usageId?: Id<"agentQuotaUsage">;
};

type QuotaState = {
  agentId: string;
  ownerUserId: Id<"users">;
  monthKey: string;
  freeAllowanceUnits: number;
  hardCapUnits: number;
  usedUnits: number;
  remainingUnits: number;
  hardCapReached: boolean;
  hardCapReachedAt?: number;
  hardCapMetadataJson: string;
  monthlyLimitUnits: number;
  agentUsedUnits: number;
  agentRemainingUnits: number;
  requestLimitUnits: number;
};

const quotaStateFields = {
  agentId: v.string(),
  ownerUserId: v.id("users"),
  monthKey: v.string(),
  freeAllowanceUnits: v.number(),
  hardCapUnits: v.number(),
  usedUnits: v.number(),
  remainingUnits: v.number(),
  hardCapReached: v.boolean(),
  hardCapReachedAt: v.optional(v.number()),
  hardCapMetadataJson: v.string(),
  monthlyLimitUnits: v.number(),
  agentUsedUnits: v.number(),
  agentRemainingUnits: v.number(),
  requestLimitUnits: v.number(),
};

const quotaStateValidator = v.object(quotaStateFields);
const quotaConsumeResultValidator = v.object({
  accepted: v.boolean(),
  idempotent: v.boolean(),
  agentId: v.string(),
  ownerUserId: v.id("users"),
  monthKey: v.string(),
  units: v.number(),
  usedUnits: v.number(),
  remainingUnits: v.number(),
  agentUsedUnits: v.number(),
  agentRemainingUnits: v.number(),
  freeAllowanceUnits: v.number(),
  hardCapUnits: v.number(),
  hardCapReached: v.boolean(),
  hardCapReachedAt: v.optional(v.number()),
  hardCapMetadataJson: v.string(),
  reason: v.optional(
    v.union(
      v.literal("hard-cap"),
      v.literal("agent-limit"),
      v.literal("request-limit"),
      v.literal("rate-limited"),
    ),
  ),
  retryAfter: v.optional(v.number()),
  usageId: v.optional(v.id("agentQuotaUsage")),
});

function monthKeyForTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function normalizeAgentQuotaMonthKey(monthKey: string) {
  const value = monthKey.trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new ConvexError({
      code: "INVALID_QUOTA_MONTH",
      message: "monthKey must use YYYY-MM format.",
    });
  }
  return value;
}

function requireIntegerInRange(
  value: number,
  name: string,
  minimum = 0,
  maximum = MAX_QUOTA_UNITS,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ConvexError({
      code: "INVALID_QUOTA_VALUE",
      message: `${name} must be an integer between ${minimum} and ${maximum}.`,
    });
  }
  return value;
}

function normalizeIdempotencyKey(value: string) {
  const key = value.trim();
  if (
    key.length === 0 ||
    key.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)
  ) {
    throw new ConvexError({
      code: "INVALID_QUOTA_IDEMPOTENCY_KEY",
      message:
        "idempotencyKey must be 1-160 letters, numbers, dots, underscores, colons, or dashes.",
    });
  }
  return key;
}

function normalizeOperation(value: string) {
  const operation = value.trim();
  if (
    operation.length === 0 ||
    operation.length > MAX_OPERATION_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(operation)
  ) {
    throw new ConvexError({
      code: "INVALID_QUOTA_OPERATION",
      message:
        "operation must be a bounded identifier no longer than 80 characters.",
    });
  }
  return operation;
}

function normalizeRequestFingerprint(value: string | undefined) {
  if (value === undefined) return undefined;
  const fingerprint = value.trim();
  if (
    fingerprint.length === 0 ||
    fingerprint.length > MAX_REQUEST_FINGERPRINT_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(fingerprint)
  ) {
    throw new ConvexError({
      code: "INVALID_QUOTA_REQUEST_FINGERPRINT",
      message:
        "requestFingerprint must be a bounded hash or identifier no longer than 128 characters.",
    });
  }
  return fingerprint;
}

function normalizeMetadataJson(value: string | undefined) {
  if (value === undefined) return undefined;
  if (value.length > 4_096) {
    throw new ConvexError({
      code: "INVALID_QUOTA_METADATA",
      message: "metadataJson must be at most 4096 characters.",
    });
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("metadata must be an object");
    }
  } catch {
    throw new ConvexError({
      code: "INVALID_QUOTA_METADATA",
      message: "metadataJson must be a JSON object.",
    });
  }
  return value;
}

async function findIdentity(
  ctx: QueryCtx | MutationCtx,
  agentId: string,
): Promise<IdentityDoc | null> {
  return await ctx.db
    .query("agentIdentities")
    .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
    .unique();
}

async function findIdentityForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<IdentityDoc | null> {
  return await ctx.db
    .query("agentIdentities")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

async function requireQuotaManager(
  ctx: QueryCtx | MutationCtx,
  agentId: string,
) {
  const actor = await requireAuthenticatedUser(ctx);
  const identity = await findIdentity(ctx, agentId);
  if (identity === null) {
    throw new ConvexError({
      code: "AGENT_NOT_FOUND",
      message: "Agent not found.",
    });
  }
  if (!hasSiteAdminAccess(actor) && identity.ownerUserId !== actor._id) {
    throw new ConvexError({
      code: "AGENT_OWNER_REQUIRED",
      message: "Only the account owner can manage this agent quota.",
    });
  }
  if (identity.ownerUserId === undefined && !hasSiteAdminAccess(actor)) {
    throw new ConvexError({
      code: "AGENT_OWNER_REQUIRED",
      message: "This legacy agent has no quota owner.",
    });
  }
  return {
    actor,
    identity,
    ownerUserId: identity.ownerUserId ?? actor._id,
  };
}

async function ensureBudget(
  ctx: MutationCtx,
  ownerUserId: Id<"users">,
  monthKey: string,
  now: number,
) {
  const existing = await ctx.db
    .query("agentQuotaBudgets")
    .withIndex("by_ownerUserId_and_monthKey", (q) =>
      q.eq("ownerUserId", ownerUserId).eq("monthKey", monthKey),
    )
    .unique();
  if (existing !== null) return existing;
  const id = await ctx.db.insert("agentQuotaBudgets", {
    ownerUserId,
    monthKey,
    freeAllowanceUnits: FREE_MONTHLY_ALLOWANCE_UNITS,
    hardCapUnits: DEFAULT_HARD_CAP_UNITS,
    usedUnits: 0,
    hardCapMetadataJson: DEFAULT_HARD_CAP_METADATA_JSON,
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get("agentQuotaBudgets", id))!;
}

async function ensureCounter(
  ctx: MutationCtx,
  ownerUserId: Id<"users">,
  agentId: string,
  monthKey: string,
  now: number,
) {
  const existing = await ctx.db
    .query("agentQuotaUsageCounters")
    .withIndex("by_ownerUserId_and_agentId_and_monthKey", (q) =>
      q
        .eq("ownerUserId", ownerUserId)
        .eq("agentId", agentId)
        .eq("monthKey", monthKey),
    )
    .unique();
  if (existing !== null) return existing;
  const id = await ctx.db.insert("agentQuotaUsageCounters", {
    ownerUserId,
    agentId,
    monthKey,
    usedUnits: 0,
    updatedAt: now,
  });
  return (await ctx.db.get("agentQuotaUsageCounters", id))!;
}

async function findLimit(
  ctx: QueryCtx | MutationCtx,
  ownerUserId: Id<"users">,
  agentId: string,
) {
  return await ctx.db
    .query("agentQuotaLimits")
    .withIndex("by_ownerUserId_and_agentId", (q) =>
      q.eq("ownerUserId", ownerUserId).eq("agentId", agentId),
    )
    .unique();
}

async function readQuotaState(
  ctx: QueryCtx | MutationCtx,
  identity: IdentityDoc,
  ownerUserId: Id<"users">,
  monthKey: string,
  budget?: Doc<"agentQuotaBudgets">,
  counter?: Doc<"agentQuotaUsageCounters">,
): Promise<QuotaState> {
  const [storedBudget, storedLimit, storedCounter] = await Promise.all([
    budget ??
      ctx.db
        .query("agentQuotaBudgets")
        .withIndex("by_ownerUserId_and_monthKey", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("monthKey", monthKey),
        )
        .unique(),
    findLimit(ctx, ownerUserId, identity.agentId),
    counter ??
      ctx.db
        .query("agentQuotaUsageCounters")
        .withIndex("by_ownerUserId_and_agentId_and_monthKey", (q) =>
          q
            .eq("ownerUserId", ownerUserId)
            .eq("agentId", identity.agentId)
            .eq("monthKey", monthKey),
        )
        .unique(),
  ]);
  const hardCapUnits = storedBudget?.hardCapUnits ?? DEFAULT_HARD_CAP_UNITS;
  const usedUnits = storedBudget?.usedUnits ?? 0;
  const monthlyLimitUnits =
    storedLimit?.monthlyLimitUnits ?? DEFAULT_PER_AGENT_MONTHLY_LIMIT_UNITS;
  const agentUsedUnits = storedCounter?.usedUnits ?? 0;
  return {
    agentId: identity.agentId,
    ownerUserId,
    monthKey,
    freeAllowanceUnits:
      storedBudget?.freeAllowanceUnits ?? FREE_MONTHLY_ALLOWANCE_UNITS,
    hardCapUnits,
    usedUnits,
    remainingUnits: Math.max(0, hardCapUnits - usedUnits),
    hardCapReached:
      storedBudget?.hardCapReachedAt !== undefined || usedUnits >= hardCapUnits,
    hardCapReachedAt: storedBudget?.hardCapReachedAt,
    hardCapMetadataJson:
      storedBudget?.hardCapMetadataJson ?? DEFAULT_HARD_CAP_METADATA_JSON,
    monthlyLimitUnits,
    agentUsedUnits,
    agentRemainingUnits: Math.max(0, monthlyLimitUnits - agentUsedUnits),
    requestLimitUnits:
      storedLimit?.requestLimitUnits ?? DEFAULT_REQUEST_LIMIT_UNITS,
  };
}

function quotaResult(
  state: QuotaState,
  args: {
    accepted: boolean;
    idempotent: boolean;
    units: number;
    reason?: AgentQuotaConsumeResult["reason"];
    retryAfter?: number;
    usageId?: Id<"agentQuotaUsage">;
  },
): AgentQuotaConsumeResult {
  return {
    accepted: args.accepted,
    idempotent: args.idempotent,
    agentId: state.agentId,
    ownerUserId: state.ownerUserId,
    monthKey: state.monthKey,
    units: args.units,
    usedUnits: state.usedUnits,
    remainingUnits: state.remainingUnits,
    agentUsedUnits: state.agentUsedUnits,
    agentRemainingUnits: state.agentRemainingUnits,
    freeAllowanceUnits: state.freeAllowanceUnits,
    hardCapUnits: state.hardCapUnits,
    hardCapReached: state.hardCapReached,
    hardCapReachedAt: state.hardCapReachedAt,
    hardCapMetadataJson: state.hardCapMetadataJson,
    reason: args.reason,
    retryAfter: args.retryAfter,
    usageId: args.usageId,
  };
}

export const configureAgentQuota = mutation({
  args: {
    agentId: v.string(),
    monthKey: v.optional(v.string()),
    freeAllowanceUnits: v.optional(v.number()),
    hardCapUnits: v.optional(v.number()),
    monthlyLimitUnits: v.optional(v.number()),
    requestLimitUnits: v.optional(v.number()),
    hardCapMetadataJson: v.optional(v.string()),
  },
  returns: quotaStateValidator,
  handler: async (ctx, args) => {
    const { identity, ownerUserId } = await requireQuotaManager(
      ctx,
      args.agentId,
    );
    const now = Date.now();
    const monthKey = normalizeAgentQuotaMonthKey(
      args.monthKey ?? monthKeyForTimestamp(now),
    );
    const existingBudget = await ensureBudget(ctx, ownerUserId, monthKey, now);
    const existingLimit = await findLimit(ctx, ownerUserId, identity.agentId);
    const freeAllowanceUnits =
      args.freeAllowanceUnits ?? existingBudget.freeAllowanceUnits;
    const hardCapUnits = args.hardCapUnits ?? existingBudget.hardCapUnits;
    const monthlyLimitUnits =
      args.monthlyLimitUnits ??
      existingLimit?.monthlyLimitUnits ??
      DEFAULT_PER_AGENT_MONTHLY_LIMIT_UNITS;
    const requestLimitUnits =
      args.requestLimitUnits ??
      existingLimit?.requestLimitUnits ??
      DEFAULT_REQUEST_LIMIT_UNITS;
    requireIntegerInRange(freeAllowanceUnits, "freeAllowanceUnits");
    requireIntegerInRange(hardCapUnits, "hardCapUnits", 1);
    requireIntegerInRange(monthlyLimitUnits, "monthlyLimitUnits", 1);
    requireIntegerInRange(requestLimitUnits, "requestLimitUnits", 1);
    if (freeAllowanceUnits > hardCapUnits) {
      throw new ConvexError({
        code: "INVALID_QUOTA_CAP",
        message: "freeAllowanceUnits cannot exceed hardCapUnits.",
      });
    }
    if (requestLimitUnits > monthlyLimitUnits) {
      throw new ConvexError({
        code: "INVALID_QUOTA_CAP",
        message: "requestLimitUnits cannot exceed monthlyLimitUnits.",
      });
    }
    if (existingBudget.usedUnits > hardCapUnits) {
      throw new ConvexError({
        code: "QUOTA_HARD_CAP_BELOW_USAGE",
        message:
          "hardCapUnits cannot be below usage already recorded this month.",
      });
    }
    const hardCapMetadataJson =
      normalizeMetadataJson(args.hardCapMetadataJson) ??
      existingBudget.hardCapMetadataJson;
    await ctx.db.patch("agentQuotaBudgets", existingBudget._id, {
      freeAllowanceUnits,
      hardCapUnits,
      hardCapMetadataJson,
      hardCapReachedAt:
        existingBudget.usedUnits >= hardCapUnits
          ? (existingBudget.hardCapReachedAt ?? now)
          : undefined,
      updatedAt: now,
    });
    if (existingLimit === null) {
      await ctx.db.insert("agentQuotaLimits", {
        ownerUserId,
        agentId: identity.agentId,
        monthlyLimitUnits,
        requestLimitUnits,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch("agentQuotaLimits", existingLimit._id, {
        monthlyLimitUnits,
        requestLimitUnits,
        updatedAt: now,
      });
    }
    return await readQuotaState(ctx, identity, ownerUserId, monthKey);
  },
});

export const getAgentQuota = query({
  args: {
    agentId: v.string(),
    monthKey: v.optional(v.string()),
  },
  returns: quotaStateValidator,
  handler: async (ctx, args) => {
    const { identity, ownerUserId } = await requireQuotaManager(
      ctx,
      args.agentId,
    );
    const monthKey =
      args.monthKey === undefined
        ? monthKeyForTimestamp(Date.now())
        : normalizeAgentQuotaMonthKey(args.monthKey);
    return await readQuotaState(ctx, identity, ownerUserId, monthKey);
  },
});

export const getMyAgentQuota = query({
  args: { monthKey: v.optional(v.string()) },
  returns: quotaStateValidator,
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedUser(ctx);
    const identity = await findIdentityForUser(ctx, actor._id);
    if (identity === null || !isActiveAgentUser(actor)) {
      throw new ConvexError({
        code: "AGENT_REQUIRED",
        message: "An active agent identity is required.",
      });
    }
    if (identity.ownerUserId === undefined) {
      throw new ConvexError({
        code: "AGENT_OWNER_REQUIRED",
        message: "This legacy agent has no quota owner.",
      });
    }
    const monthKey =
      args.monthKey === undefined
        ? monthKeyForTimestamp(Date.now())
        : normalizeAgentQuotaMonthKey(args.monthKey);
    return await readQuotaState(ctx, identity, identity.ownerUserId, monthKey);
  },
});

export async function consumeAgentQuotaForRequest(
  ctx: MutationCtx,
  args: {
    agentId: string;
    units: number;
    idempotencyKey: string;
    operation: string;
    monthKey?: string;
    metadataJson?: string;
    requestFingerprint?: string;
    now?: number;
  },
  trustedPluginPrincipal?: ForumPluginPrincipal,
): Promise<AgentQuotaConsumeResult> {
  const units = requireIntegerInRange(args.units, "units", 1);
  const agentId = args.agentId.trim().toLowerCase();
  const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
  const operation = normalizeOperation(args.operation);
  const metadataJson = normalizeMetadataJson(args.metadataJson);
  const requestFingerprint = normalizeRequestFingerprint(
    args.requestFingerprint,
  );
  const now = args.now ?? Date.now();
  // Connected forum paths have already resolved and validated these documents
  // while checking the plugin principal in this same mutation. Reuse them
  // instead of issuing the same identity and agent-user reads a second time.
  const identity =
    trustedPluginPrincipal?.credentialAgent ??
    (await findIdentity(ctx, agentId));
  if (identity === null) {
    throw new ConvexError({
      code: "AGENT_NOT_FOUND",
      message: "Agent not found.",
    });
  }
  if (identity.ownerUserId === undefined) {
    throw new ConvexError({
      code: "AGENT_OWNER_REQUIRED",
      message: "This legacy agent has no quota owner.",
    });
  }
  // Non-plugin quota calls may have no auth identity. When one is present,
  // bind the requested agent to it so an agent cannot spend another agent's
  // owner-scoped allowance by guessing agentId.
  if (
    trustedPluginPrincipal &&
    (identity.agentId !== agentId ||
      trustedPluginPrincipal.owner._id !== identity.ownerUserId ||
      trustedPluginPrincipal.credentialUser._id !== identity.userId)
  ) {
    throw new ConvexError({
      code: "AGENT_IDENTITY_MISMATCH",
      message: "The authenticated agent does not match the requested agent.",
    });
  }
  if (!trustedPluginPrincipal) {
    const caller = await ctx.auth.getUserIdentity();
    const authenticatedUser = caller ? await getCurrentUser(ctx) : null;
    if (caller !== null && authenticatedUser?._id !== identity.userId) {
      throw new ConvexError({
        code: "AGENT_IDENTITY_MISMATCH",
        message: "The authenticated agent does not match the requested agent.",
      });
    }
  }
  const user =
    trustedPluginPrincipal?.credentialUser ??
    (await ctx.db.get("users", identity.userId));
  if (
    identity.status !== "active" ||
    user === null ||
    !isActiveAgentUser(user)
  ) {
    throw new ConvexError({
      code: "AGENT_NOT_ACTIVE",
      message: "An active agent identity is required.",
    });
  }
  const ownerUserId = identity.ownerUserId;
  const monthKey = normalizeAgentQuotaMonthKey(
    args.monthKey ?? monthKeyForTimestamp(now),
  );
  const existingUsage = await ctx.db
    .query("agentQuotaUsage")
    .withIndex(
      "by_ownerUserId_and_agentId_and_monthKey_and_idempotencyKey",
      (q) =>
        q
          .eq("ownerUserId", ownerUserId)
          .eq("agentId", agentId)
          .eq("monthKey", monthKey)
          .eq("idempotencyKey", idempotencyKey),
    )
    .unique();
  if (existingUsage !== null) {
    if (
      existingUsage.operation !== operation ||
      existingUsage.units !== units ||
      existingUsage.requestFingerprint !== requestFingerprint
    ) {
      throw new ConvexError({
        code: "QUOTA_IDEMPOTENCY_MISMATCH",
        message:
          "idempotencyKey was already used with a different operation, units, or request fingerprint.",
      });
    }
    const state = await readQuotaState(ctx, identity, ownerUserId, monthKey);
    return quotaResult(state, {
      accepted: true,
      idempotent: true,
      units: existingUsage.units,
      usageId: existingUsage._id,
    });
  }

  const budget = await ensureBudget(ctx, ownerUserId, monthKey, now);
  const counter = await ensureCounter(ctx, ownerUserId, agentId, monthKey, now);
  const state = await readQuotaState(
    ctx,
    identity,
    ownerUserId,
    monthKey,
    budget,
    counter,
  );
  if (units > state.requestLimitUnits) {
    return quotaResult(state, {
      accepted: false,
      idempotent: false,
      units,
      reason: "request-limit",
    });
  }
  if (units > state.remainingUnits || state.hardCapReached) {
    return quotaResult(state, {
      accepted: false,
      idempotent: false,
      units,
      reason: "hard-cap",
    });
  }
  if (units > state.agentRemainingUnits) {
    return quotaResult(state, {
      accepted: false,
      idempotent: false,
      units,
      reason: "agent-limit",
    });
  }

  const ownerRateStatus = await quotaRateLimiter.limit(
    ctx,
    "agentOwnerQuotaRequests",
    { key: ownerUserId },
  );
  if (!ownerRateStatus.ok) {
    return quotaResult(state, {
      accepted: false,
      idempotent: false,
      units,
      reason: "rate-limited",
      retryAfter: ownerRateStatus.retryAfter,
    });
  }

  const rateStatus = await quotaRateLimiter.limit(ctx, "agentQuotaRequests", {
    key: `${ownerUserId}:${agentId}`,
  });
  if (!rateStatus.ok) {
    return quotaResult(state, {
      accepted: false,
      idempotent: false,
      units,
      reason: "rate-limited",
      retryAfter: rateStatus.retryAfter,
    });
  }

  const nextUsedUnits = budget.usedUnits + units;
  const nextAgentUsedUnits = counter.usedUnits + units;
  const hardCapReachedAt =
    nextUsedUnits >= budget.hardCapUnits
      ? (budget.hardCapReachedAt ?? now)
      : budget.hardCapReachedAt;
  const usageId = await ctx.db.insert("agentQuotaUsage", {
    ownerUserId,
    agentId,
    monthKey,
    idempotencyKey,
    operation,
    units,
    createdAt: now,
    metadataJson,
    requestFingerprint,
  });
  await ctx.db.patch("agentQuotaBudgets", budget._id, {
    usedUnits: nextUsedUnits,
    hardCapReachedAt,
    updatedAt: now,
  });
  await ctx.db.patch("agentQuotaUsageCounters", counter._id, {
    usedUnits: nextAgentUsedUnits,
    updatedAt: now,
  });
  const eventScope = stableEventScope(String(ownerUserId));
  const eventBase = {
    scope: "account" as const,
    period: monthKey,
    usedUnits: nextUsedUnits,
    hardCapUnits: state.hardCapUnits,
    remainingUnits: Math.max(0, state.hardCapUnits - nextUsedUnits),
  };
  const priorUsedUnits = budget.usedUnits;
  if (
    priorUsedUnits < budget.hardCapUnits * 0.8 &&
    nextUsedUnits >= budget.hardCapUnits * 0.8
  ) {
    await emitUsageEvent(
      ctx,
      usageWebhookRef,
      usageEvent(
        "evidence.usage.threshold_reached",
        `usage:${eventScope}:${monthKey}:threshold-80`,
        Math.floor(now / 1_000),
        { ...eventBase, thresholdPercent: 80 },
      ),
      ownerUserId,
    );
  }
  if (
    priorUsedUnits < budget.hardCapUnits &&
    nextUsedUnits >= budget.hardCapUnits
  ) {
    await emitUsageEvent(
      ctx,
      usageWebhookRef,
      usageEvent(
        "evidence.usage.budget_reached",
        `usage:${eventScope}:${monthKey}:budget-reached`,
        Math.floor(now / 1_000),
        { ...eventBase, remainingUnits: 0 },
      ),
      ownerUserId,
    );
  }
  return quotaResult(
    {
      ...state,
      usedUnits: nextUsedUnits,
      remainingUnits: Math.max(0, state.hardCapUnits - nextUsedUnits),
      hardCapReached: nextUsedUnits >= state.hardCapUnits,
      hardCapReachedAt,
      agentUsedUnits: nextAgentUsedUnits,
      agentRemainingUnits: Math.max(
        0,
        state.monthlyLimitUnits - nextAgentUsedUnits,
      ),
    },
    { accepted: true, idempotent: false, units, usageId },
  );
}

async function emitUsageEvent(
  ctx: MutationCtx,
  reference: typeof usageWebhookRef,
  event: ReturnType<typeof usageEvent>,
  ownerUserId: Id<"users">,
) {
  try {
    await ctx.runMutation(reference, {
      eventKey: event.id,
      eventType: event.type,
      payloadJson: JSON.stringify(event),
      ownerUserId,
    });
  } catch (error) {
    console.warn("Usage webhook event enqueue failed", error);
  }
}

/**
 * Enforce the beta quota only for enrolled agent identities. Human accounts
 * keep the existing product behavior, while agent mutations get one bounded
 * operation unit and a stable retry key when the client supplies one.
 */
export async function consumeAgentQuotaIfNeeded(
  ctx: MutationCtx,
  user: Doc<"users"> | null | undefined,
  args: {
    operation: string;
    idempotencyKey?: string;
    metadataJson?: string;
  },
) {
  if (user?.isAgent !== true) return null;
  const agentId = user.agentSlug ?? user.usernameNormalized;
  if (agentId === undefined) {
    throw new ConvexError({
      code: "AGENT_ID_REQUIRED",
      message: "The enrolled agent is missing its stable identity.",
    });
  }
  const result = await consumeAgentQuotaForRequest(ctx, {
    agentId,
    units: 1,
    idempotencyKey:
      args.idempotencyKey?.trim() || `${args.operation}:${Date.now()}`,
    operation: args.operation,
    metadataJson: args.metadataJson,
  });
  if (!result.accepted) {
    throw new ConvexError({
      code: "AGENT_QUOTA_EXCEEDED",
      message:
        result.reason === "rate-limited"
          ? "Agent request rate limit reached. Retry after the indicated delay."
          : "Agent usage quota reached for this period.",
      reason: result.reason,
      retryAfter: result.retryAfter,
    });
  }
  return result;
}

export const consumeAgentQuota = internalMutation({
  args: {
    agentId: v.string(),
    units: v.number(),
    idempotencyKey: v.string(),
    operation: v.string(),
    monthKey: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
    requestFingerprint: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  returns: quotaConsumeResultValidator,
  handler: async (ctx, args) => consumeAgentQuotaForRequest(ctx, args),
});

/** Explicit alias for callers that describe the write as usage recording. */
export const recordAgentUsage = consumeAgentQuota;

/** Explicit alias for quota dashboards and future API consumers. */
export const getQuotaStatus = getAgentQuota;

/** Forum browsing uses short-term limits without consuming mutation/evidence units. */
export async function consumeForumPluginReadRate(
  ctx: MutationCtx,
  principal: ForumPluginPrincipal,
) {
  const owner = await quotaRateLimiter.limit(ctx, "forumOwnerReads", {
    key: principal.owner._id,
  });
  const credential = owner.ok
    ? await quotaRateLimiter.limit(ctx, "forumCredentialReads", {
        key: `${principal.owner._id}:${principal.credentialAgent.agentId}`,
      })
    : owner;
  if (!credential.ok)
    throw new ConvexError({
      code: "FORUM_RATE_LIMITED",
      message:
        "Forum read rate limit reached. Retry after the indicated delay.",
      quotaReason: "rate-limited",
      retryAfter: credential.retryAfter,
    });
}

/** Safe, uncharged diagnostics for the already-authorized forum principal. */
export async function readForumPluginQuota(
  ctx: QueryCtx | MutationCtx,
  principal: ForumPluginPrincipal,
  now: number,
) {
  const state = await readQuotaState(
    ctx,
    principal.credentialAgent,
    principal.owner._id,
    monthKeyForTimestamp(now),
  );
  const date = new Date(now);
  return {
    agentUsedUnits: state.agentUsedUnits,
    agentLimitUnits: state.monthlyLimitUnits,
    ownerUsedUnits: state.usedUnits,
    ownerLimitUnits: state.hardCapUnits,
    remainingUnits: Math.min(state.remainingUnits, state.agentRemainingUnits),
    resetsAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
    settingsUrl: "https://www.symbaiex.com/developer",
  };
}

/** Called only after a server-side plugin grant is resolved; human mode still spends automation quota. */
export async function consumeForumPluginQuota(
  ctx: MutationCtx,
  principal: ForumPluginPrincipal,
  args: {
    operation: string;
    idempotencyKey: string;
    requestFingerprint?: string;
  },
) {
  const result = await consumeAgentQuotaForRequest(
    ctx,
    {
      agentId: principal.credentialAgent.agentId,
      units: 1,
      operation: args.operation,
      idempotencyKey: args.idempotencyKey,
      requestFingerprint: args.requestFingerprint,
      metadataJson: JSON.stringify({
        connectionId: principal.connection._id,
        actorUserId: principal.actor._id,
        agentAssisted: true,
      }),
    },
    principal,
  );
  if (!result.accepted) {
    const quota = await readForumPluginQuota(ctx, principal, Date.now());
    throw new ConvexError({
      code: "AGENT_QUOTA_EXCEEDED",
      message:
        result.reason === "rate-limited"
          ? "Agent request rate limit reached. Retry after the indicated delay."
          : "Agent usage quota reached.",
      quotaReason: result.reason,
      retryAfter: result.retryAfter,
      resetsAt: quota.resetsAt,
      quota,
    });
  }
  return result;
}

/** Forum writes use admission limits, independently of monthly API accounting.
 * Callers validate current forum authority first and check durable receipts before
 * admission. Existing monthly evidence/general helpers above remain unchanged.
 */
async function consumeForumWriteRate(
  ctx: MutationCtx,
  ownerUserId: Id<"users">,
  agentId: string,
) {
  const owner = await quotaRateLimiter.limit(ctx, "forumOwnerWrites", {
    key: ownerUserId,
  });
  const credential = owner.ok
    ? await quotaRateLimiter.limit(ctx, "forumCredentialWrites", {
        key: `${ownerUserId}:${agentId}`,
      })
    : owner;
  if (!credential.ok)
    throw new ConvexError({
      code: "FORUM_RATE_LIMITED",
      message:
        "Forum write rate limit reached. Retry after the indicated delay.",
      quotaReason: "rate-limited",
      retryAfter: credential.retryAfter,
    });
}

export async function consumeForumPluginWriteRate(
  ctx: MutationCtx,
  principal: ForumPluginPrincipal,
) {
  await consumeForumWriteRate(
    ctx,
    principal.owner._id,
    principal.credentialAgent.agentId,
  );
}

/** Native enrolled agents share their owner's forum admission across profiles. */
export async function consumeNativeForumWriteRateIfNeeded(
  ctx: MutationCtx,
  user: Doc<"users">,
) {
  if (user.isAgent !== true) return;
  const identity = await findIdentityForUser(ctx, user._id);
  if (
    !identity ||
    identity.status !== "active" ||
    !isActiveAgentUser(user) ||
    identity.keyVersion !== user.agentKeyVersion ||
    !identity.scopes.includes("forum")
  )
    throw new ConvexError({
      code: "AGENT_NOT_ACTIVE",
      message: "An active forum agent identity is required.",
    });
  if (!identity.ownerUserId)
    throw new ConvexError({
      code: "AGENT_OWNER_REQUIRED",
      message: "This legacy agent has no forum owner.",
    });
  await consumeForumWriteRate(ctx, identity.ownerUserId, identity.agentId);
}
