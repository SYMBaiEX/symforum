import { ConvexError, v } from "convex/values";
import {
  action,
  mutation,
  internalMutation,
  internalQuery,
  env,
} from "./_generated/server";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { commerceActor } from "./forumCommerceAccess";
import { commerceConfig } from "../lib/forum-commerce";
import { inspectSignedSwap } from "../lib/swap-signed-wire";
import { swapRpc } from "../lib/swap-rpc";
import { queueSwapRecovery } from "./forumSwapRecovery";

const receipt = v.object({
  quoteId: v.id("forumSwapQuotes"),
  signature: v.string(),
});
function available(row: Doc<"forumSwapQuotes">) {
  const c = commerceConfig(env);
  if (
    env.FORUM_SWAP_SIGNATURE_FIRST_ENABLED !== "true" ||
    env.FORUM_SWAP_AUTORECOVERY_ENABLED !== "true" ||
    !c.swapsEnabled ||
    c.treasury !== row.treasury
  )
    throw new ConvexError("Signature-first swaps are unavailable.");
  return c;
}
/** Store a verified signature before any server is permitted to relay its bytes. No network IO. */
export const registerSigned = mutation({
  args: {
    quoteId: v.id("forumSwapQuotes"),
    signedTransactionBase64: v.string(),
  },
  returns: receipt,
  handler: async (ctx, args) => {
    const row = await ctx.db.get("forumSwapQuotes", args.quoteId),
      actor = await commerceActor(ctx, row?.wallet);
    if (
      !row ||
      row.authUserId !== actor.authUserId ||
      !row.messageHash ||
      row.transactionVersion === undefined
    )
      throw new ConvexError("Prepared swap not found.");
    available(row);
    let signed: Awaited<ReturnType<typeof inspectSignedSwap>>;
    try {
      signed = await inspectSignedSwap(args.signedTransactionBase64, {
        wallet: row.wallet,
        messageHash: row.messageHash,
        transactionVersion: row.transactionVersion,
      });
    } catch {
      throw new ConvexError(
        "The signed transaction did not match the simulated swap. Nothing was submitted by this request.",
      );
    }
    const existing = await ctx.db
      .query("forumSwapSubmissions")
      .withIndex("by_quoteId", (q) => q.eq("quoteId", row._id))
      .unique();
    if (existing) {
      if (
        existing.signature !== signed.signature ||
        existing.wireHash !== signed.wireHash ||
        row.signature !== signed.signature
      )
        throw new ConvexError("Submission binding mismatch.");
      return { quoteId: row._id, signature: signed.signature };
    }
    if (
      row.status !== "prepared" ||
      row.signature ||
      row.expiresAt <= Date.now()
    )
      throw new ConvexError(
        "Quote expired or already used. No submission was started.",
      );
    for (const status of ["held", "submitted"] as const) {
      const previous = await ctx.db
        .query("forumSwapQuotes")
        .withIndex("by_wallet_and_status", (q) =>
          q.eq("wallet", row.wallet).eq("status", status),
        )
        .take(1);
      if (previous.length)
        throw new ConvexError("A previous wallet request needs verification.");
    }
    const duplicate = await ctx.db
      .query("forumSwapQuotes")
      .withIndex("by_signature", (q) => q.eq("signature", signed.signature))
      .unique();
    const promotion = await ctx.db
      .query("forumPromotionIntents")
      .withIndex("by_signature", (q) => q.eq("signature", signed.signature))
      .unique();
    if (duplicate || promotion)
      throw new ConvexError(
        "This signature is already assigned to an operation.",
      );
    await ctx.db.insert("forumSwapSubmissions", {
      quoteId: row._id,
      signature: signed.signature,
      wireHash: signed.wireHash,
      registeredAt: Date.now(),
    });
    await ctx.db.patch("forumSwapQuotes", row._id, {
      signature: signed.signature,
      signatureFirst: true,
      status: "submitted",
      issue: "signature_saved_before_submission",
    });
    await queueSwapRecovery(ctx, {
      ...row,
      signature: signed.signature,
      signatureFirst: true,
      status: "submitted",
      issue: "signature_saved_before_submission",
    });
    return { quoteId: row._id, signature: signed.signature };
  },
});
export const context = internalQuery({
  args: { quoteId: v.id("forumSwapQuotes") },
  returns: schema.doc("forumSwapQuotes"),
  handler: async (ctx, { quoteId }) => {
    const row = await ctx.db.get("forumSwapQuotes", quoteId),
      actor = await commerceActor(ctx, row?.wallet);
    if (
      !row ||
      row.authUserId !== actor.authUserId ||
      !row.signatureFirst ||
      !row.signature
    )
      throw new ConvexError("Registered signed swap not found.");
    return row;
  },
});
/** Ledger-proven unattempted relays can be cancelled, never a broadcast/legacy hold. */
export const cancelUnsubmitted = mutation({
  args: { quoteId: v.id("forumSwapQuotes") },
  returns: v.boolean(),
  handler: async (ctx, { quoteId }) => {
    const row = await ctx.db.get("forumSwapQuotes", quoteId),
      actor = await commerceActor(ctx, row?.wallet);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Swap not found.");
    const job = await ctx.db
      .query("forumSwapSubmissions")
      .withIndex("by_quoteId", (q) => q.eq("quoteId", quoteId))
      .unique();
    if (
      job?.attemptedAt !== undefined ||
      (!job && row.status !== "prepared") ||
      (job && (!row.signatureFirst || row.status !== "submitted"))
    )
      return false;
    await ctx.db.patch("forumSwapQuotes", quoteId, {
      status: "failed",
      issue: "app_submission_not_started",
    });
    const recovery = await ctx.db
      .query("forumSwapRecoveries")
      .withIndex("by_quoteId", (q) => q.eq("quoteId", quoteId))
      .unique();
    if (recovery)
      await ctx.db.patch("forumSwapRecoveries", recovery._id, {
        state: "resolved",
        reason: "resolved",
        nextCheckAt: 0,
        leaseUntil: 0,
      });
    return true;
  },
});
/** Atomic at-most-once broadcast authorization. A crash consumes it, never authorizes a replay. */
export const claimRelay = internalMutation({
  args: {
    quoteId: v.id("forumSwapQuotes"),
    wireHash: v.string(),
    signature: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("forumSwapQuotes", args.quoteId),
      actor = await commerceActor(ctx, row?.wallet);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Swap not found.");
    const job = await ctx.db
      .query("forumSwapSubmissions")
      .withIndex("by_quoteId", (q) => q.eq("quoteId", row._id))
      .unique();
    if (
      !job ||
      job.signature !== args.signature ||
      row.signature !== args.signature ||
      job.wireHash !== args.wireHash
    )
      throw new ConvexError("Submission binding mismatch.");
    if (job.attemptedAt !== undefined) return false;
    available(row);
    if (row.status !== "submitted" || row.expiresAt <= Date.now())
      throw new ConvexError(
        "Submission expired or paused; no new broadcast was authorized.",
      );
    // Shared quota and actor cap participate in this same transaction.
    await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
      wallet: row.wallet,
      cost: 1,
    });
    await ctx.db.patch("forumSwapSubmissions", job._id, {
      attemptedAt: Date.now(),
      rpcState: "unknown",
    });
    return true;
  },
});
export const saveRelayResult = internalMutation({
  args: { quoteId: v.id("forumSwapQuotes"), accepted: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { quoteId, accepted }) => {
    const row = await ctx.db.get("forumSwapQuotes", quoteId),
      actor = await commerceActor(ctx, row?.wallet);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Swap not found.");
    const job = await ctx.db
      .query("forumSwapSubmissions")
      .withIndex("by_quoteId", (q) => q.eq("quoteId", quoteId))
      .unique();
    if (!job || job.attemptedAt === undefined)
      throw new ConvexError("Submission not authorized.");
    await ctx.db.patch("forumSwapSubmissions", job._id, {
      rpcState: accepted ? "accepted" : "unknown",
    });
    return null;
  },
});
export const relay = action({
  args: {
    quoteId: v.id("forumSwapQuotes"),
    signedTransactionBase64: v.string(),
  },
  returns: receipt,
  handler: async (
    ctx,
    args,
  ): Promise<{ quoteId: Id<"forumSwapQuotes">; signature: string }> => {
    const row: Doc<"forumSwapQuotes"> = await ctx.runQuery(
      internal.forumSwapSubmission.context,
      { quoteId: args.quoteId },
    );
    const c = available(row);
    let signed: Awaited<ReturnType<typeof inspectSignedSwap>>;
    try {
      signed = await inspectSignedSwap(args.signedTransactionBase64, {
        wallet: row.wallet,
        messageHash: row.messageHash!,
        transactionVersion: row.transactionVersion!,
      });
    } catch {
      throw new ConvexError(
        "Signed transaction binding could not be verified.",
      );
    }
    if (!c.rpcUrl) throw new ConvexError("Submission endpoint unavailable.");
    const url = new URL(c.rpcUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "mainnet.helius-rpc.com" ||
      url.pathname !== "/" ||
      url.username ||
      url.password
    )
      throw new ConvexError("Submission endpoint unavailable.");
    const allowed: boolean = await ctx.runMutation(
      internal.forumSwapSubmission.claimRelay,
      {
        quoteId: row._id,
        signature: signed.signature,
        wireHash: signed.wireHash,
      },
    );
    if (allowed) {
      let accepted = false;
      try {
        const result = await swapRpc<string>(c.rpcUrl, "sendTransaction", [
          args.signedTransactionBase64,
          {
            encoding: "base64",
            skipPreflight: false,
            maxRetries: 0,
            preflightCommitment: "confirmed",
            minContextSlot: row.simulationSlot,
          },
        ]);
        accepted = result === signed.signature;
      } catch {
        /* Known signature survives every RPC error; never resend or log bearer bytes. */
      }
      await ctx.runMutation(internal.forumSwapSubmission.saveRelayResult, {
        quoteId: row._id,
        accepted,
      });
    }
    return { quoteId: row._id, signature: signed.signature };
  },
});
