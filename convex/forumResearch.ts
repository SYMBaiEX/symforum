import { ConvexError, v } from "convex/values";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { docValidator } from "convex/server";
import { components } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { commerceActor, publicCommerceThread } from "./forumCommerceAccess";
import { commerceLimiter } from "./forumCommerce";
import {
  buildResearchReport,
  RESEARCH_AMOUNT,
  RESEARCH_ASSET,
  RESEARCH_CREDIT_RESERVE,
  RESEARCH_INTENT_TTL,
  RESEARCH_NETWORK,
  RESEARCH_PRODUCT,
  RESEARCH_READINESS_TTL,
  researchHash,
  researchRequirements,
  researchResource,
  researchSignatureValid,
} from "../lib/forum-research";
import { isSolanaAddress } from "../lib/forum-commerce";
import {
  forumResearchTables,
  researchReportValidator,
  researchStateValidator,
} from "./forumResearchSchema";

const limiter = new RateLimiter(components.rateLimiter, {
  researchQuote: {
    kind: "token bucket",
    rate: 6,
    period: 3_600_000,
    capacity: 2,
  },
  researchReadiness: {
    kind: "token bucket",
    rate: 1,
    period: 60_000,
    capacity: 1,
  },
});
export const reserveReadinessNetwork = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const admission = await limiter.limit(ctx, "researchReadiness", {
      key: "shared",
    });
    const daily = await commerceLimiter.limit(ctx, "commerceNetworkDaily", {
      key: "all",
      count: 3,
    });
    if (!admission.ok || !daily.ok)
      throw new ConvexError("Free-tier readiness allowance reached.");
    return null;
  },
});
const receiptValidator = v.object({
  intentKey: v.string(),
  mint: v.string(),
  state: researchStateValidator,
  createdAt: v.number(),
  expiresAt: v.number(),
  signature: v.union(v.string(), v.null()),
  finalizedAt: v.union(v.number(), v.null()),
  report: v.union(researchReportValidator, v.null()),
});
const intentValidator = docValidator(
  "forumResearchIntents",
  forumResearchTables.forumResearchIntents,
);
type Intent = Doc<"forumResearchIntents">;
const view = (row: Intent) => ({
  intentKey: row.intentKey,
  mint: row.mint,
  state: row.state,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  signature: row.signature ?? null,
  finalizedAt: row.finalizedAt ?? null,
  report: row.state === "fulfilled" ? row.report : null,
});
async function control(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("forumResearchControl")
    .withIndex("by_key", (q) => q.eq("key", "x402-research-v1"))
    .unique();
}
function ready(row: Awaited<ReturnType<typeof control>>, now: number) {
  return (
    !!row?.enabled &&
    row.verifiedAt <= now &&
    now - row.verifiedAt <= RESEARCH_READINESS_TTL &&
    row.creditsReserved + RESEARCH_CREDIT_RESERVE <= row.creditLimit
  );
}
async function owned(ctx: QueryCtx | MutationCtx, key: string) {
  const actor = await commerceActor(ctx);
  const row = await ctx.db
    .query("forumResearchIntents")
    .withIndex("by_intentKey", (q) => q.eq("intentKey", key))
    .unique();
  if (!row || row.ownerUserId !== actor.userId)
    throw new ConvexError("Research receipt unavailable.");
  return row;
}
export const getConfig = query({
  args: { now: v.number() },
  returns: v.object({
    enabled: v.boolean(),
    amountRaw: v.literal("100000"),
    asset: v.string(),
    network: v.string(),
    product: v.literal("solana-token-brief-v1"),
    priceLabel: v.literal("$0.10 USDC"),
    reason: v.union(
      v.literal("ready"),
      v.literal("setup_required"),
      v.literal("free_credits_exhausted"),
    ),
  }),
  handler: async (ctx, { now }) => {
    const row = await control(ctx);
    return {
      // Capability/ATA freshness is refreshed under a bounded lease on demand.
      enabled:
        !!row?.enabled &&
        row.verifiedAt <= now &&
        row.creditsReserved + RESEARCH_CREDIT_RESERVE <= row.creditLimit,
      amountRaw: RESEARCH_AMOUNT as "100000",
      asset: RESEARCH_ASSET,
      network: RESEARCH_NETWORK,
      product: RESEARCH_PRODUCT as "solana-token-brief-v1",
      priceLabel: "$0.10 USDC" as const,
      reason:
        row?.enabled &&
        row.creditsReserved + RESEARCH_CREDIT_RESERVE <= row.creditLimit
          ? ("ready" as const)
          : row &&
              row.creditsReserved + RESEARCH_CREDIT_RESERVE > row.creditLimit
            ? ("free_credits_exhausted" as const)
            : ("setup_required" as const),
    };
  },
});
export const claimReadinessRefresh = internalMutation({
  args: { wallet: v.string() },
  returns: v.union(
    v.null(),
    docValidator(
      "forumResearchControl",
      forumResearchTables.forumResearchControl,
    ),
  ),
  handler: async (ctx, { wallet }) => {
    await commerceActor(ctx, wallet);
    const row = await control(ctx),
      now = Date.now();
    if (
      !row?.enabled ||
      row.creditsReserved + RESEARCH_CREDIT_RESERVE > row.creditLimit
    )
      throw new ConvexError("Research payments are not available.");
    if (ready(row, now)) return null;
    if ((row.refreshLeaseUntil ?? 0) > now)
      throw new ConvexError(
        "Research readiness is refreshing. No payment is required.",
      );
    await ctx.db.patch("forumResearchControl", row._id, {
      refreshLeaseUntil: now + 60_000,
    });
    return row;
  },
});
export const quote = mutation({
  args: { wallet: v.string(), mint: v.string(), idempotencyKey: v.string() },
  returns: v.object({
    intentKey: v.string(),
    expiresAt: v.number(),
    requirementsJson: v.string(),
    resource: v.string(),
  }),
  handler: async (ctx, args) => {
    const actor = await commerceActor(ctx, args.wallet),
      now = Date.now();
    if (
      !isSolanaAddress(args.mint) ||
      !/^[A-Za-z0-9_-]{16,100}$/.test(args.idempotencyKey)
    )
      throw new ConvexError("Invalid research request.");
    const previous = await ctx.db
      .query("forumResearchIntents")
      .withIndex("by_ownerUserId_and_idempotencyKey", (q) =>
        q
          .eq("ownerUserId", actor.userId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (previous) {
      if (previous.wallet !== args.wallet || previous.mint !== args.mint)
        throw new ConvexError("Research request identity changed.");
      return {
        intentKey: previous.intentKey,
        expiresAt: previous.expiresAt,
        requirementsJson: JSON.stringify(previous.requirements),
        resource: previous.resource,
      };
    }
    for (const state of [
      "verifying",
      "settlement_claimed",
      "unknown",
    ] as const) {
      const held = await ctx.db
        .query("forumResearchIntents")
        .withIndex("by_wallet_and_state", (q) =>
          q.eq("wallet", args.wallet).eq("state", state),
        )
        .first();
      if (held)
        throw new ConvexError(
          "A prior research payment is protected. Check its receipt; no new payment was requested.",
        );
    }
    if (!(await limiter.limit(ctx, "researchQuote", { key: actor.userId })).ok)
      throw new ConvexError("Research request limit reached. Try later.");
    const setup = await control(ctx);
    if (!setup || !ready(setup, now))
      throw new ConvexError(
        "Research payments are not ready or the free facilitator allowance is exhausted. No payment is required.",
      );
    const tracked = await ctx.db
      .query("tokenAlphaTrackedTokens")
      .withIndex("by_chain_and_mint", (q) =>
        q.eq("chain", "solana").eq("mint", args.mint),
      )
      .unique();
    const thread = tracked
      ? await publicCommerceThread(ctx, tracked.threadId)
      : null;
    if (!tracked?.latestSnapshot || !thread)
      throw new ConvexError(
        "No citable public token coverage is available. No payment is required.",
      );
    let report;
    try {
      report = buildResearchReport({
        ...tracked.latestSnapshot,
        generatedAt: now,
        threadUrl: `https://forum.symbaiex.com/${thread.categorySlug}/${thread.slug}`,
      });
    } catch {
      throw new ConvexError(
        "Fresh citable source data is unavailable. No payment is required.",
      );
    }
    const bodyHash = await researchHash({
      mint: args.mint,
      product: RESEARCH_PRODUCT,
      report,
    });
    const intentKey = await researchHash({
      owner: actor.userId,
      wallet: args.wallet,
      idempotencyKey: args.idempotencyKey,
      bodyHash,
    });
    const requirements = researchRequirements(intentKey, setup.feePayer);
    const resource = researchResource(intentKey),
      expiresAt = now + RESEARCH_INTENT_TTL;
    await ctx.db.insert("forumResearchIntents", {
      intentKey,
      ownerUserId: actor.userId,
      wallet: args.wallet,
      mint: args.mint,
      idempotencyKey: args.idempotencyKey,
      product: RESEARCH_PRODUCT,
      resource,
      method: "GET",
      bodyHash,
      requirements: requirements as Intent["requirements"],
      requirementsHash: await researchHash(requirements),
      report,
      state: "quoted",
      createdAt: now,
      expiresAt,
      updatedAt: now,
      sdkReads: 0,
    });
    return {
      intentKey,
      expiresAt,
      requirementsJson: JSON.stringify(requirements),
      resource,
    };
  },
});
export const status = query({
  args: { intentKey: v.string() },
  returns: receiptValidator,
  handler: async (ctx, { intentKey }) => view(await owned(ctx, intentKey)),
});
export const challenge = query({
  args: { intentKey: v.string(), now: v.number() },
  returns: v.object({
    requirementsJson: v.string(),
    resource: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.intentKey);
    if (row.state !== "quoted" || row.expiresAt <= args.now)
      throw new ConvexError("Research quote is no longer payable.");
    return {
      requirementsJson: JSON.stringify(row.requirements),
      resource: row.resource,
      expiresAt: row.expiresAt,
    };
  },
});
export const listMine = query({
  args: {},
  returns: v.array(receiptValidator),
  handler: async (ctx) => {
    const actor = await commerceActor(ctx);
    return (
      await ctx.db
        .query("forumResearchIntents")
        .withIndex("by_ownerUserId_and_createdAt", (q) =>
          q.eq("ownerUserId", actor.userId),
        )
        .order("desc")
        .take(10)
    ).map(view);
  },
});
export const readIntent = internalQuery({
  args: { intentKey: v.string() },
  returns: intentValidator,
  handler: async (ctx, { intentKey }) => await owned(ctx, intentKey),
});
export const claimRead = internalMutation({
  args: {
    intentKey: v.string(),
    purpose: v.union(v.literal("sdk"), v.literal("simulation")),
  },
  returns: intentValidator,
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.intentKey),
      now = Date.now();
    if (row.state !== "quoted" || row.expiresAt <= now || row.sdkReads >= 3)
      throw new ConvexError(
        "Research quote expired or its preparation allowance was consumed.",
      );
    await commerceActor(ctx, row.wallet);
    await ctx.db.patch("forumResearchIntents", row._id, {
      sdkReads: row.sdkReads + 1,
      updatedAt: now,
    });
    return row;
  },
});
export const saveSimulation = internalMutation({
  args: { intentKey: v.string(), messageHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.intentKey),
      now = Date.now();
    if (row.state !== "quoted" || row.expiresAt <= now)
      throw new ConvexError("Research quote expired.");
    await ctx.db.patch("forumResearchIntents", row._id, {
      simulationHash: args.messageHash,
      simulationAt: now,
    });
    return null;
  },
});
export const claimPayment = internalMutation({
  args: {
    intentKey: v.string(),
    payloadHash: v.string(),
    messageHash: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.intentKey),
      now = Date.now();
    await commerceActor(ctx, row.wallet);
    if (row.state !== "quoted") return false;
    if (row.expiresAt <= now) {
      await ctx.db.patch("forumResearchIntents", row._id, {
        state: "expired",
        updatedAt: now,
      });
      return false;
    }
    if (
      row.simulationHash !== args.messageHash ||
      !row.simulationAt ||
      now - row.simulationAt > 60_000
    )
      throw new ConvexError("Prepare a fresh research request before signing.");
    if (!ready(await control(ctx), now))
      throw new ConvexError(
        "Research payments are paused. Nothing was settled.",
      );
    await ctx.db.patch("forumResearchIntents", row._id, {
      state: "verifying",
      payloadHash: args.payloadHash,
      updatedAt: now,
    });
    return true;
  },
});
export const claimSettlement = internalMutation({
  args: { intentKey: v.string(), payloadHash: v.string(), payer: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.intentKey),
      setup = await control(ctx),
      now = Date.now();
    if (
      row.state !== "verifying" ||
      row.expiresAt <= now ||
      row.payloadHash !== args.payloadHash ||
      row.wallet !== args.payer ||
      !setup ||
      !ready(setup, now)
    )
      return false;
    await ctx.db.patch("forumResearchControl", setup._id, {
      creditsReserved: setup.creditsReserved + RESEARCH_CREDIT_RESERVE,
      updatedAt: now,
    });
    await ctx.db.patch("forumResearchIntents", row._id, {
      state: "settlement_claimed",
      settlementClaimedAt: now,
      updatedAt: now,
    });
    return true;
  },
});
export const finish = internalMutation({
  args: {
    intentKey: v.string(),
    payloadHash: v.string(),
    state: v.union(
      v.literal("unknown"),
      v.literal("rejected"),
      v.literal("fulfilled"),
    ),
    signature: v.optional(v.string()),
    finalizedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Completion survives a concurrent logout. This internal callback cannot authorize a new payment.
    const row = await ctx.db
      .query("forumResearchIntents")
      .withIndex("by_intentKey", (q) => q.eq("intentKey", args.intentKey))
      .unique();
    if (!row || row.payloadHash !== args.payloadHash)
      throw new ConvexError("Research completion binding changed.");
    if (
      row.state === "fulfilled" ||
      row.state === "rejected" ||
      row.state === "expired"
    )
      return null;
    if (args.state === "fulfilled") {
      if (
        !args.signature ||
        !args.finalizedAt ||
        !["settlement_claimed", "unknown"].includes(row.state)
      )
        throw new ConvexError("A finalized exact receipt is required.");
      const duplicate = await ctx.db
        .query("forumResearchIntents")
        .withIndex("by_signature", (q) => q.eq("signature", args.signature))
        .unique();
      if (duplicate && duplicate._id !== row._id)
        throw new ConvexError(
          "This payment is already bound to another receipt.",
        );
    }
    // No transition releases/refunds/replays an uncertain settlement.
    if (args.state === "rejected" && row.state !== "verifying") return null;
    await ctx.db.patch("forumResearchIntents", row._id, {
      state: args.state,
      ...(args.signature ? { signature: args.signature } : {}),
      ...(args.finalizedAt
        ? { finalizedAt: args.finalizedAt, receiptNetwork: RESEARCH_NETWORK }
        : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const saveSettlementSignature = internalMutation({
  args: {
    intentKey: v.string(),
    payloadHash: v.string(),
    signature: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("forumResearchIntents")
      .withIndex("by_intentKey", (q) => q.eq("intentKey", args.intentKey))
      .unique();
    if (
      !row ||
      row.state !== "settlement_claimed" ||
      row.payloadHash !== args.payloadHash ||
      !researchSignatureValid(args.signature)
    )
      throw new ConvexError("Research settlement binding changed.");
    const duplicate = await ctx.db
      .query("forumResearchIntents")
      .withIndex("by_signature", (q) => q.eq("signature", args.signature))
      .unique();
    if (duplicate && duplicate._id !== row._id)
      throw new ConvexError("Research signature is already bound.");
    await ctx.db.patch("forumResearchIntents", row._id, {
      signature: args.signature,
      state: "unknown",
      updatedAt: Date.now(),
    });
    return null;
  },
});
/** Only the approved operator may invoke this internal mutation after checking the provider's actual starter-credit balance. */
export const configureReadiness = internalMutation({
  args: {
    enabled: v.boolean(),
    creditLimit: v.number(),
    feePayer: v.string(),
    recipientAta: v.string(),
    verifiedAt: v.number(),
    creditEvidence: v.literal("provider-dashboard-verified"),
    expectedUpdatedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const old = await control(ctx),
      now = Date.now();
    if (
      args.expectedUpdatedAt !== undefined &&
      (!old || old.updatedAt !== args.expectedUpdatedAt || !old.enabled)
    )
      throw new ConvexError(
        "Research control changed while readiness was checked.",
      );
    if (
      !Number.isSafeInteger(args.creditLimit) ||
      args.creditLimit < 0 ||
      args.creditLimit > 1000 ||
      args.creditLimit < (old?.creditsReserved ?? 0) ||
      !isSolanaAddress(args.feePayer) ||
      !isSolanaAddress(args.recipientAta) ||
      args.verifiedAt > now ||
      now - args.verifiedAt > 60_000
    )
      throw new ConvexError("Invalid free-only readiness proof.");
    if (old && args.creditLimit > old.creditLimit)
      throw new ConvexError(
        "The non-renewing starter-credit allowance cannot be increased.",
      );
    const { expectedUpdatedAt: _expected, ...configuration } = args;
    void _expected;
    const next = {
      key: "x402-research-v1" as const,
      ...configuration,
      creditsReserved: old?.creditsReserved ?? 0,
      updatedAt: now,
    };
    if (old) await ctx.db.patch("forumResearchControl", old._id, next);
    else await ctx.db.insert("forumResearchControl", next);
    return null;
  },
});
