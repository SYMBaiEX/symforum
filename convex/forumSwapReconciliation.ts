import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  env,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { commerceLimiter } from "./forumCommerce";
import { commerceRpc } from "./forumCommerceRpc";
import { commerceConfig, isSolanaAddress, record } from "../lib/forum-commerce";
import { rpcExpiryProof } from "./forumSwapReconciliationSchema";
import {
  MAINNET_GENESIS,
  preparedBlockhash,
  proveQuietHistory,
  reconciliationHash,
  requireExpiredUnsignedHold,
  requireExpiryProof,
  type RpcExpiryProof,
} from "../lib/swap-reconciliation";

/** Disabled by default. An operator must install a short-lived, exact-record approval. */
function target(now: number) {
  try {
    const value = record(
      JSON.parse(env.FORUM_SWAP_RECONCILIATION_TARGET ?? "null"),
    );
    if (
      typeof value.quoteId !== "string" ||
      typeof value.wallet !== "string" ||
      !isSolanaAddress(value.wallet) ||
      typeof value.messageHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.messageHash) ||
      typeof value.authorization !== "string" ||
      !/^[a-z0-9-]{8,80}$/.test(value.authorization) ||
      !Number.isSafeInteger(value.approvedAt) ||
      !Number.isSafeInteger(value.expiresAt) ||
      Number(value.approvedAt) > now ||
      Number(value.expiresAt) <= now ||
      Number(value.expiresAt) - Number(value.approvedAt) > 3_600_000
    )
      throw new Error("Invalid approval");
    return {
      quoteId: value.quoteId as Id<"forumSwapQuotes">,
      wallet: value.wallet as string,
      messageHash: value.messageHash,
      authorization: value.authorization,
    };
  } catch {
    throw new ConvexError("No current approval for this reconciliation.");
  }
}
function approved(row: Doc<"forumSwapQuotes"> | null, now: number) {
  const approval = target(now);
  if (
    !row ||
    row._id !== approval.quoteId ||
    row.wallet !== approval.wallet ||
    row.messageHash !== approval.messageHash
  )
    throw new ConvexError(
      "Reconciliation approval does not match the saved swap.",
    );
  return approval;
}
export const context = internalQuery({
  args: { now: v.number() },
  returns: schema.doc("forumSwapQuotes"),
  handler: async (ctx, { now }) => {
    const row = await ctx.db.get("forumSwapQuotes", target(now).quoteId);
    approved(row, now);
    if (!row) throw new ConvexError("Swap missing.");
    return row;
  },
});
export const reserve = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const approval = target(Date.now());
    const gate = await commerceLimiter.limit(ctx, "commerceReconciliation", {
      key: approval.quoteId,
    });
    if (!gate.ok)
      throw new ConvexError("Reconciliation check already reserved.");
    const daily = await commerceLimiter.limit(ctx, "commerceNetworkDaily", {
      key: "all",
      count: 10,
    });
    if (!daily.ok) throw new ConvexError("Free-tier data budget reached.");
    return null;
  },
});
export const settleNotLanded = internalMutation({
  args: {
    snapshotHash: v.string(),
    helius: rpcExpiryProof,
    solana: rpcExpiryProof,
  },
  returns: v.literal("reconciled_not_landed"),
  handler: async (ctx, args) => {
    const now = Date.now(),
      row = await ctx.db.get("forumSwapQuotes", target(now).quoteId);
    const approval = approved(row, now);
    if (!row) throw new ConvexError("Swap missing.");
    if (
      row.reconciliation?.kind === "expired_not_landed" &&
      row.status === "failed"
    )
      return "reconciled_not_landed" as const;
    requireExpiredUnsignedHold(row, now);
    if ((await reconciliationHash(row)) !== args.snapshotHash)
      throw new ConvexError("Saved swap changed during verification.");
    requireExpiryProof(row, args.helius, now);
    requireExpiryProof(row, args.solana, now);
    await ctx.db.patch("forumSwapQuotes", row._id, {
      status: "failed",
      issue: "reconciled_expired_not_landed",
      reconciliation: {
        kind: "expired_not_landed",
        authorization: approval.authorization,
        reconciledAt: now,
        previousStatus: "held",
        previousIssue: "wallet_outcome_unknown",
        previousRecordHash: args.snapshotHash,
        helius: args.helius,
        solana: args.solana,
      },
    });
    return "reconciled_not_landed" as const;
  },
});
async function inspectProvider(
  url: string,
  row: Doc<"forumSwapQuotes">,
  hash: string,
): Promise<RpcExpiryProof> {
  const genesis = await commerceRpc(url, "getGenesisHash", []);
  if (genesis !== MAINNET_GENESIS) throw new Error("Wrong cluster.");
  const invalid = record(
    await commerceRpc(url, "isBlockhashValid", [
      hash,
      { commitment: "finalized", minContextSlot: row.simulationSlot },
    ]),
  );
  const slot = record(invalid.context).slot;
  if (
    invalid.value !== false ||
    !Number.isSafeInteger(slot) ||
    Number(slot) <= Number(row.simulationSlot)
  )
    throw new Error("Blockhash expiry not proven.");
  const options = { commitment: "finalized", minContextSlot: slot };
  const height = await commerceRpc(url, "getBlockHeight", [options]);
  const first = await commerceRpc(url, "getFirstAvailableBlock", []);
  const history = await commerceRpc(url, "getSignaturesForAddress", [
    row.wallet,
    { ...options, limit: 10 },
  ]);
  const proof: RpcExpiryProof = {
    checkedAt: Date.now(),
    genesis: MAINNET_GENESIS,
    invalidAtSlot: Number(slot),
    finalizedHeight: Number(height),
    firstAvailableSlot: Number(first),
    ...(await proveQuietHistory(history, row)),
  };
  // Require numeric RPC results, not coercible strings.
  if (typeof height !== "number" || typeof first !== "number")
    throw new Error("Invalid chain metadata.");
  requireExpiryProof(row, proof, Date.now());
  return proof;
}
export const reconcileApproved = internalAction({
  args: {},
  returns: v.object({
    status: v.union(v.literal("reconciled_not_landed"), v.literal("held")),
    reason: v.string(),
  }),
  handler: async (
    ctx,
  ): Promise<{ status: "reconciled_not_landed" | "held"; reason: string }> => {
    const row = await ctx.runQuery(internal.forumSwapReconciliation.context, {
      now: Date.now(),
    });
    if (
      row.reconciliation?.kind === "expired_not_landed" &&
      row.status === "failed"
    )
      return {
        status: "reconciled_not_landed",
        reason: "already_reconciled_no_replay",
      };
    try {
      requireExpiredUnsignedHold(row, Date.now());
      const hash = await preparedBlockhash(row),
        snapshotHash = await reconciliationHash(row);
      const url = new URL(commerceConfig(env).rpcUrl ?? "");
      if (
        url.protocol !== "https:" ||
        url.hostname !== "mainnet.helius-rpc.com" ||
        url.username ||
        url.password ||
        url.pathname !== "/"
      )
        throw new Error("Expected configured Helius endpoint.");
      await ctx.runMutation(internal.forumSwapReconciliation.reserve, {});
      const helius = await inspectProvider(url.toString(), row, hash);
      const solana = await inspectProvider(
        "https://api.mainnet-beta.solana.com",
        row,
        hash,
      );
      const status = await ctx.runMutation(
        internal.forumSwapReconciliation.settleNotLanded,
        { snapshotHash, helius, solana },
      );
      return {
        status,
        reason: "two_independent_finalized_expiry_and_history_checks",
      };
    } catch {
      return {
        status: "held",
        reason: "evidence_inconclusive_or_record_changed_no_replay",
      };
    }
  },
});
