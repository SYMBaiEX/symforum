import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  swapReconciliationAudit,
  signatureExpiryProof,
} from "./forumSwapReconciliationSchema";
export const promotionStatus = v.union(
  v.literal("checkout"),
  v.literal("submitted"),
  v.literal("held"),
  v.literal("scheduled"),
  v.literal("expired"),
);
export const forumCommerceTables = {
  forumSwapReconciliationAttempts: defineTable({
    authorization: v.string(),
    quoteId: v.id("forumSwapQuotes"),
    reservedAt: v.number(),
  }).index("by_authorization", ["authorization"]),
  // Never store signed bearer transaction bytes in the submission ledger.
  forumSwapSubmissions: defineTable({
    quoteId: v.id("forumSwapQuotes"),
    signature: v.string(),
    wireHash: v.string(),
    registeredAt: v.number(),
    attemptedAt: v.optional(v.number()),
    rpcState: v.optional(v.union(v.literal("accepted"), v.literal("unknown"))),
    expiryProofHash: v.optional(v.string()),
    previousQuoteHash: v.optional(v.string()),
    expiryProof: v.optional(
      v.object({ helius: signatureExpiryProof, solana: signatureExpiryProof }),
    ),
  }).index("by_quoteId", ["quoteId"]),
  // High-churn checking/leases stay separate from the immutable payment binding.
  forumSwapRecoveries: defineTable({
    quoteId: v.id("forumSwapQuotes"),
    state: v.union(
      v.literal("scheduled"),
      v.literal("checking"),
      v.literal("review"),
      v.literal("resolved"),
    ),
    reason: v.union(
      v.literal("waiting_expiry"),
      v.literal("checking_receipt"),
      v.literal("evidence_inconclusive"),
      v.literal("budget_unavailable"),
      v.literal("record_changed"),
      v.literal("resolved"),
    ),
    attempts: v.number(),
    nextCheckAt: v.number(),
    leaseUntil: v.number(),
    lease: v.string(),
    lastCheckedAt: v.optional(v.number()),
    outcome: v.optional(
      v.union(
        v.literal("confirmed"),
        v.literal("chain_failed"),
        v.literal("not_landed"),
      ),
    ),
    receiptHash: v.optional(v.string()),
    previousQuoteHash: v.optional(v.string()),
    diagnostic: v.optional(v.string()),
    progress: v.optional(
      v.union(
        v.literal("processed"),
        v.literal("confirmed"),
        v.literal("finalized"),
      ),
    ),
  }).index("by_quoteId", ["quoteId"]),
  forumSwapRequests: defineTable({
    wallet: v.string(),
    authUserId: v.string(),
    requestKey: v.string(),
    lease: v.string(),
    leaseUntil: v.number(),
    payload: v.optional(v.string()),
    quoteIds: v.array(v.id("forumSwapQuotes")),
    expiresAt: v.number(),
  }).index("by_wallet", ["wallet"]),
  forumTokenDiscoveryCache: defineTable({
    key: v.string(),
    payload: v.string(),
    expiresAt: v.number(),
    leaseUntil: v.number(),
  }).index("by_key", ["key"]),
  forumVerifiedMints: defineTable({
    mint: v.string(),
    symbol: v.string(),
    name: v.string(),
    decimals: v.number(),
    tokenProgram: v.string(),
    verifiedAt: v.number(),
    expiresAt: v.number(),
  }).index("by_mint", ["mint"]),
  forumTradeTokens: defineTable({
    mint: v.string(),
    symbol: v.string(),
    symbolNormalized: v.string(),
    name: v.string(),
    decimals: v.number(),
    tokenProgram: v.string(),
    projectHost: v.optional(v.string()),
    proofUrl: v.string(),
    status: v.union(v.literal("active"), v.literal("blocked")),
    verifiedBy: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_mint", ["mint"])
    .index("by_symbolNormalized_and_status", ["symbolNormalized", "status"])
    .index("by_status_and_symbolNormalized", ["status", "symbolNormalized"])
    .index("by_projectHost_and_status", ["projectHost", "status"]),
  forumWalletBenefits: defineTable({
    wallet: v.string(),
    status: v.union(
      v.literal("checking"),
      v.literal("verified"),
      v.literal("unavailable"),
    ),
    balanceRaw: v.string(),
    decimals: v.number(),
    priceUsd: v.optional(v.string()),
    eligible: v.boolean(),
    checkedAt: v.number(),
    expiresAt: v.number(),
    leaseUntil: v.number(),
  })
    .index("by_wallet", ["wallet"])
    .index("by_expiresAt", ["expiresAt"]),
  forumPromotionIntents: defineTable({
    authUserId: v.string(),
    userId: v.id("users"),
    wallet: v.string(),
    threadId: v.id("forumThreads"),
    categoryId: v.id("forumCategories"),
    categorySlug: v.string(),
    treasury: v.string(),
    mint: v.string(),
    tokenProgram: v.string(),
    decimals: v.number(),
    amountRaw: v.string(),
    treasuryAmountRaw: v.string(),
    burnAmountRaw: v.string(),
    reference: v.string(),
    lane: v.number(),
    startsAt: v.number(),
    endsAt: v.number(),
    createdAt: v.number(),
    checkoutExpiresAt: v.number(),
    status: promotionStatus,
    signature: v.optional(v.string()),
    issue: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    blockTime: v.optional(v.number()),
    preparationStartedAt: v.optional(v.number()),
    messageHash: v.optional(v.string()),
  })
    .index("by_reference", ["reference"])
    .index("by_signature", ["signature"])
    .index("by_authUserId_and_createdAt", ["authUserId", "createdAt"])
    .index("by_authUserId_and_status", ["authUserId", "status"])
    .index("by_categoryId_and_endsAt", ["categoryId", "endsAt"])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"]),
  forumSwapQuotes: defineTable({
    signatureFirst: v.optional(v.boolean()),
    authUserId: v.string(),
    userId: v.id("users"),
    wallet: v.string(),
    provider: v.union(v.literal("jupiter"), v.literal("raydium")),
    quoteJson: v.string(),
    treasury: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    platformFeeBps: v.number(),
    status: v.union(
      v.literal("quoted"),
      v.literal("preparing"),
      v.literal("prepared"),
      v.literal("submitted"),
      v.literal("held"),
      v.literal("confirmed"),
      v.literal("failed"),
    ),
    transactionBase64: v.optional(v.string()),
    messageHash: v.optional(v.string()),
    lastValidBlockHeight: v.optional(v.number()),
    estimatedNetworkFeeLamports: v.optional(v.string()),
    simulationSlot: v.optional(v.number()),
    transactionVersion: v.optional(v.number()),
    reconciliation: v.optional(swapReconciliationAudit),
    signature: v.optional(v.string()),
    issue: v.optional(v.string()),
  })
    .index("by_authUserId_and_createdAt", ["authUserId", "createdAt"])
    .index("by_authUserId_and_status", ["authUserId", "status"])
    .index("by_wallet_and_status", ["wallet", "status"])
    .index("by_signature", ["signature"])
    .index("by_expiresAt", ["expiresAt"]),
};
