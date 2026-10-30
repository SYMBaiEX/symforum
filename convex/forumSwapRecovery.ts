import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  mutation,
  env,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { commerceActor } from "./forumCommerceAccess";
import { commerceLimiter } from "./forumCommerce";
import { commerceConfig } from "../lib/forum-commerce";
import { commerceRpc } from "./forumCommerceRpc";
import { inspectProvider } from "./forumSwapReconciliation";
import { rpcExpiryProof } from "./forumSwapReconciliationSchema";
import {
  MAINNET_GENESIS,
  RECONCILIATION_QUIET_MS,
  preparedBlockhash,
  reconciliationHash,
  requireExpiredUnsignedHold,
  requireExpiryProof,
} from "../lib/swap-reconciliation";
import { inspectSwapReceipt } from "../lib/swap-receipt";

const MAX_CHECKS = 3,
  LEASE_MS = 120_000,
  RETRY_MS = 3_600_000;
export const recoveryViewValidator = v.object({
  state: v.union(
    v.literal("scheduled"),
    v.literal("checking"),
    v.literal("review"),
    v.literal("resolved"),
  ),
  reason: v.string(),
  attempts: v.number(),
  nextCheckAt: v.number(),
});
export function recoveryView(job: Doc<"forumSwapRecoveries">) {
  return {
    state: job.state,
    reason: job.reason,
    attempts: job.attempts,
    nextCheckAt: job.nextCheckAt,
  };
}
function enabled() {
  return env.FORUM_SWAP_AUTORECOVERY_ENABLED === "true";
}
function waiting(row: Doc<"forumSwapQuotes">) {
  return row.status === "held" || row.status === "submitted";
}
async function jobFor(ctx: MutationCtx, quoteId: Id<"forumSwapQuotes">) {
  return ctx.db
    .query("forumSwapRecoveries")
    .withIndex("by_quoteId", (q) => q.eq("quoteId", quoteId))
    .unique();
}
/** Called atomically with the wallet-request fence; no browser is needed afterwards. */
export async function queueSwapRecovery(
  ctx: MutationCtx,
  row: Doc<"forumSwapQuotes">,
) {
  if (!enabled() || !waiting(row) || !row.messageHash || !row.simulationSlot)
    return null;
  const existing = await jobFor(ctx, row._id),
    now = Date.now();
  const nextCheckAt = row.signature
    ? now + 10_000
    : Math.max(now + 1000, row.expiresAt + RECONCILIATION_QUIET_MS + 1000);
  if (existing) {
    // Re-admit an overdue job after downtime/a disabled switch, without
    // resetting the attempt count or taking over an unexpired lease.
    if (
      (existing.state === "scheduled" || existing.state === "checking") &&
      existing.nextCheckAt <= now &&
      existing.leaseUntil <= now
    ) {
      await ctx.db.patch("forumSwapRecoveries", existing._id, {
        state: "scheduled",
        nextCheckAt: now + 1000,
        leaseUntil: 0,
      });
      await ctx.scheduler.runAt(now + 1000, internal.forumSwapRecovery.check, {
        quoteId: row._id,
      });
      return ctx.db.get("forumSwapRecoveries", existing._id);
    }
    // A newly returned signature can expedite receipt verification, never reset attempts.
    if (
      row.signature &&
      existing.state === "scheduled" &&
      existing.nextCheckAt > nextCheckAt
    ) {
      await ctx.db.patch("forumSwapRecoveries", existing._id, {
        nextCheckAt,
        reason: "checking_receipt",
      });
      await ctx.scheduler.runAt(nextCheckAt, internal.forumSwapRecovery.check, {
        quoteId: row._id,
      });
    }
    return existing;
  }
  const id = await ctx.db.insert("forumSwapRecoveries", {
    quoteId: row._id,
    state: "scheduled",
    reason: row.signature ? "checking_receipt" : "waiting_expiry",
    attempts: 0,
    nextCheckAt,
    leaseUntil: 0,
    lease: "",
  });
  await ctx.scheduler.runAt(nextCheckAt, internal.forumSwapRecovery.check, {
    quoteId: row._id,
  });
  return ctx.db.get("forumSwapRecoveries", id);
}
/** Owner-only admission for interrupted/older requests. Cannot release a hold or consume RPC quota. */
export const ensure = mutation({
  args: { quoteId: v.id("forumSwapQuotes") },
  returns: v.union(v.null(), recoveryViewValidator),
  handler: async (ctx, { quoteId }) => {
    const row = await ctx.db.get("forumSwapQuotes", quoteId),
      actor = await commerceActor(ctx, row?.wallet);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Swap not found.");
    const job = await queueSwapRecovery(ctx, row);
    return job ? recoveryView(job) : null;
  },
});
export const claim = internalMutation({
  args: { quoteId: v.id("forumSwapQuotes") },
  returns: v.union(
    v.null(),
    v.object({ row: schema.doc("forumSwapQuotes"), lease: v.string() }),
  ),
  handler: async (ctx, { quoteId }) => {
    if (!enabled()) return null;
    let row = await ctx.db.get("forumSwapQuotes", quoteId);
    const job = await jobFor(ctx, quoteId),
      now = Date.now();
    if (
      !row ||
      !job ||
      job.state === "review" ||
      job.state === "resolved" ||
      job.nextCheckAt > now ||
      job.leaseUntil > now
    )
      return null;
    if (!waiting(row)) {
      await ctx.db.patch("forumSwapRecoveries", job._id, {
        state: "resolved",
        reason: "resolved",
        nextCheckAt: 0,
        leaseUntil: 0,
      });
      return null;
    }
    if (job.attempts >= MAX_CHECKS) {
      await ctx.db.patch("forumSwapRecoveries", job._id, {
        state: "review",
        reason: "evidence_inconclusive",
        nextCheckAt: 0,
        leaseUntil: 0,
      });
      return null;
    }
    if (!row.signature && row.expiresAt + RECONCILIATION_QUIET_MS > now)
      return null;
    if (
      !row.signature &&
      row.status === "submitted" &&
      row.issue === "wallet_request_started"
    ) {
      await ctx.db.patch("forumSwapQuotes", row._id, {
        status: "held",
        issue: "wallet_outcome_unknown",
      });
      row = (await ctx.db.get("forumSwapQuotes", row._id))!;
    }
    const cost = row.signature ? 4 : 10;
    if (!row.signature) {
      const cooldown = await commerceLimiter.limit(
        ctx,
        "commerceReconciliation",
        { key: row._id },
      );
      if (!cooldown.ok) return defer(ctx, job, "budget_unavailable", now);
    }
    const sub = await commerceLimiter.limit(ctx, "commerceRecoveryDaily", {
      key: "all",
      count: cost,
    });
    if (!sub.ok) return defer(ctx, job, "budget_unavailable", now);
    const daily = await commerceLimiter.limit(ctx, "commerceNetworkDaily", {
      key: "all",
      count: cost,
    });
    if (!daily.ok) return defer(ctx, job, "budget_unavailable", now);
    const lease = crypto.randomUUID();
    await ctx.db.patch("forumSwapRecoveries", job._id, {
      state: "checking",
      attempts: job.attempts + 1,
      lease,
      leaseUntil: now + LEASE_MS,
      nextCheckAt: now + LEASE_MS,
      reason: row.signature ? "checking_receipt" : "waiting_expiry",
      lastCheckedAt: now,
    });
    // Watchdog survives an action crash; it cannot execute while the lease is live.
    await ctx.scheduler.runAt(
      now + LEASE_MS + 1000,
      internal.forumSwapRecovery.check,
      { quoteId },
    );
    return { row, lease };
  },
});
async function defer(
  ctx: MutationCtx,
  job: Doc<"forumSwapRecoveries">,
  reason: "budget_unavailable" | "evidence_inconclusive" | "record_changed",
  now: number,
  delay = RETRY_MS,
) {
  const attempts = job.attempts + 1,
    state =
      attempts >= MAX_CHECKS ? ("review" as const) : ("scheduled" as const);
  const nextCheckAt = state === "review" ? 0 : now + delay;
  await ctx.db.patch("forumSwapRecoveries", job._id, {
    state,
    reason,
    attempts,
    nextCheckAt,
    leaseUntil: 0,
    lastCheckedAt: now,
  });
  if (nextCheckAt)
    await ctx.scheduler.runAt(nextCheckAt, internal.forumSwapRecovery.check, {
      quoteId: job.quoteId,
    });
  return null;
}
export const finish = internalMutation({
  args: {
    quoteId: v.id("forumSwapQuotes"),
    lease: v.string(),
    snapshotHash: v.string(),
    evidence: v.union(
      v.null(),
      v.object({
        kind: v.literal("expired"),
        helius: rpcExpiryProof,
        solana: rpcExpiryProof,
      }),
      v.object({
        kind: v.literal("receipt"),
        outcome: v.union(v.literal("confirmed"), v.literal("chain_failed")),
        receiptHash: v.string(),
        checkedAt: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!enabled()) return null;
    const row = await ctx.db.get("forumSwapQuotes", args.quoteId),
      job = await jobFor(ctx, args.quoteId),
      now = Date.now();
    if (
      !row ||
      !job ||
      job.state !== "checking" ||
      job.lease !== args.lease ||
      job.leaseUntil < now
    )
      return null;
    if (!waiting(row)) {
      await ctx.db.patch("forumSwapRecoveries", job._id, {
        state: "resolved",
        reason: "resolved",
        nextCheckAt: 0,
        leaseUntil: 0,
      });
      return null;
    }
    if ((await reconciliationHash(row)) !== args.snapshotHash) {
      // claim already charged this attempt; defer must not charge it twice.
      return defer(
        ctx,
        { ...job, attempts: job.attempts - 1 },
        "record_changed",
        now,
        row.signature ? 30_000 : RETRY_MS,
      );
    }
    const proof = args.evidence;
    if (!proof)
      return defer(
        ctx,
        { ...job, attempts: job.attempts - 1 },
        "evidence_inconclusive",
        now,
        row.signature ? 30_000 * job.attempts : RETRY_MS,
      );
    let outcome: "confirmed" | "chain_failed" | "not_landed";
    if (proof.kind === "expired") {
      requireExpiredUnsignedHold(row, now);
      requireExpiryProof(row, proof.helius, now);
      requireExpiryProof(row, proof.solana, now);
      await ctx.db.patch("forumSwapQuotes", row._id, {
        status: "failed",
        issue: "reconciled_expired_not_landed",
        reconciliation: {
          kind: "expired_not_landed",
          authorization: "automatic-expiry-proof-v1",
          reconciledAt: now,
          previousStatus: "held",
          previousIssue: "wallet_outcome_unknown",
          previousRecordHash: args.snapshotHash,
          helius: proof.helius,
          solana: proof.solana,
        },
      });
      outcome = "not_landed";
    } else {
      if (
        !row.signature ||
        !/^[a-f0-9]{64}$/.test(proof.receiptHash) ||
        proof.checkedAt > now ||
        now - proof.checkedAt > 60_000
      )
        throw new ConvexError("Receipt proof incomplete.");
      outcome = proof.outcome;
      await ctx.db.patch("forumSwapQuotes", row._id, {
        status: outcome === "confirmed" ? "confirmed" : "failed",
        issue:
          outcome === "confirmed" ? undefined : "finalized_transaction_failed",
      });
    }
    await ctx.db.patch("forumSwapRecoveries", job._id, {
      state: "resolved",
      reason: "resolved",
      outcome,
      nextCheckAt: 0,
      leaseUntil: 0,
      lastCheckedAt: now,
      previousQuoteHash: args.snapshotHash,
      ...(proof.kind === "receipt" ? { receiptHash: proof.receiptHash } : {}),
    });
    return null;
  },
});
export const check = internalAction({
  args: { quoteId: v.id("forumSwapQuotes") },
  returns: v.null(),
  handler: async (ctx, { quoteId }) => {
    const claimed = await ctx.runMutation(internal.forumSwapRecovery.claim, {
      quoteId,
    });
    if (!claimed) return null;
    const { row, lease } = claimed,
      snapshotHash = await reconciliationHash(row);
    let evidence:
      | null
      | {
          kind: "expired";
          helius: Awaited<ReturnType<typeof inspectProvider>>;
          solana: Awaited<ReturnType<typeof inspectProvider>>;
        }
      | {
          kind: "receipt";
          outcome: "confirmed" | "chain_failed";
          receiptHash: string;
          checkedAt: number;
        } = null;
    try {
      const url = new URL(commerceConfig(env).rpcUrl ?? "");
      if (
        url.protocol !== "https:" ||
        url.hostname !== "mainnet.helius-rpc.com" ||
        url.username ||
        url.password ||
        url.pathname !== "/"
      )
        throw Error("RPC unavailable");
      const providers = [url.toString(), "https://api.mainnet-beta.solana.com"];
      if (row.signature && row.messageHash && row.simulationSlot) {
        const results = [];
        for (const provider of providers) {
          if (
            (await commerceRpc(provider, "getGenesisHash", [])) !==
            MAINNET_GENESIS
          )
            throw Error("Wrong chain");
          results.push(
            await inspectSwapReceipt(
              await commerceRpc(provider, "getTransaction", [
                row.signature,
                {
                  encoding: "base64",
                  commitment: "finalized",
                  maxSupportedTransactionVersion: 1,
                },
              ]),
              {
                wallet: row.wallet,
                signature: row.signature,
                messageHash: row.messageHash,
                simulationSlot: row.simulationSlot,
              },
            ),
          );
        }
        if (
          results[0] &&
          results[1] &&
          results[0].outcome === results[1].outcome &&
          results[0].receiptHash === results[1].receiptHash
        )
          evidence = { kind: "receipt", ...results[0], checkedAt: Date.now() };
      } else {
        requireExpiredUnsignedHold(row, Date.now());
        const hash = await preparedBlockhash(row);
        evidence = {
          kind: "expired",
          helius: await inspectProvider(providers[0], row, hash),
          solana: await inspectProvider(providers[1], row, hash),
        };
      }
    } catch {
      /* No provider body, signing, sending or simulation. Inconclusive is still held. */
    }
    await ctx.runMutation(internal.forumSwapRecovery.finish, {
      quoteId,
      lease,
      snapshotHash,
      evidence,
    });
    return null;
  },
});
