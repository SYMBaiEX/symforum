import { defineTable } from "convex/server";
import { v } from "convex/values";

export const researchStateValidator = v.union(
  v.literal("quoted"),
  v.literal("verifying"),
  v.literal("settlement_claimed"),
  v.literal("unknown"),
  v.literal("fulfilled"),
  v.literal("rejected"),
  v.literal("expired"),
);
export const researchReportValidator = v.object({
  product: v.literal("solana-token-brief-v1"),
  mint: v.string(),
  title: v.string(),
  generatedAt: v.number(),
  metricsAsOf: v.number(),
  facts: v.array(v.object({ label: v.string(), value: v.string() })),
  analysis: v.array(v.string()),
  sources: v.array(v.object({ label: v.string(), url: v.string() })),
  methodology: v.string(),
});
export const researchRequirementsValidator = v.object({
  scheme: v.literal("exact"),
  network: v.literal("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"),
  asset: v.string(),
  amount: v.literal("100000"),
  payTo: v.string(),
  maxTimeoutSeconds: v.number(),
  extra: v.object({
    feePayer: v.string(),
    memo: v.string(),
    transactionVersions: v.array(v.number()),
  }),
});
export const forumResearchTables = {
  forumResearchControl: defineTable({
    key: v.literal("x402-research-v1"),
    enabled: v.boolean(),
    feePayer: v.string(),
    recipientAta: v.string(),
    verifiedAt: v.number(),
    // Non-renewing initial free credit budget. Never topped up automatically.
    creditLimit: v.number(),
    creditsReserved: v.number(),
    creditEvidence: v.literal("provider-dashboard-verified"),
    updatedAt: v.number(),
    refreshLeaseUntil: v.optional(v.number()),
  }).index("by_key", ["key"]),
  forumResearchIntents: defineTable({
    intentKey: v.string(),
    ownerUserId: v.id("users"),
    wallet: v.string(),
    mint: v.string(),
    idempotencyKey: v.string(),
    product: v.literal("solana-token-brief-v1"),
    resource: v.string(),
    method: v.literal("GET"),
    bodyHash: v.string(),
    requirements: researchRequirementsValidator,
    requirementsHash: v.string(),
    report: researchReportValidator,
    state: researchStateValidator,
    createdAt: v.number(),
    expiresAt: v.number(),
    updatedAt: v.number(),
    sdkReads: v.number(),
    simulationHash: v.optional(v.string()),
    simulationAt: v.optional(v.number()),
    payloadHash: v.optional(v.string()),
    settlementClaimedAt: v.optional(v.number()),
    signature: v.optional(v.string()),
    receiptNetwork: v.optional(v.string()),
    finalizedAt: v.optional(v.number()),
    reason: v.optional(v.string()),
  })
    .index("by_intentKey", ["intentKey"])
    .index("by_ownerUserId_and_idempotencyKey", [
      "ownerUserId",
      "idempotencyKey",
    ])
    .index("by_ownerUserId_and_createdAt", ["ownerUserId", "createdAt"])
    .index("by_wallet_and_state", ["wallet", "state"])
    .index("by_ownerUserId_and_state", ["ownerUserId", "state"])
    .index("by_signature", ["signature"]),
};
