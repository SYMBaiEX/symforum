import { v } from "convex/values";
export const rpcExpiryProof = v.object({
  checkedAt: v.number(),
  genesis: v.string(),
  invalidAtSlot: v.number(),
  finalizedHeight: v.number(),
  firstAvailableSlot: v.number(),
  historyCount: v.number(),
  newestHistorySlot: v.number(),
  newestHistoryTime: v.number(),
  historyHash: v.string(),
});
export const signatureExpiryProof = v.object({
  signature: v.string(),
  checkedAt: v.number(),
  genesis: v.string(),
  statusSlot: v.number(),
  invalidAtSlot: v.number(),
  finalizedHeight: v.number(),
  firstAvailableSlot: v.number(),
});
export const swapReconciliationAudit = v.object({
  kind: v.literal("expired_not_landed"),
  authorization: v.string(),
  reconciledAt: v.number(),
  previousStatus: v.literal("held"),
  previousIssue: v.literal("wallet_outcome_unknown"),
  previousRecordHash: v.string(),
  helius: rpcExpiryProof,
  solana: rpcExpiryProof,
});
