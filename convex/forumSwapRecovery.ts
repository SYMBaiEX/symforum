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
import { inspectProvider, ExpiryCheckError } from "./forumSwapReconciliation";
import {
  rpcExpiryProof,
  signatureExpiryProof,
} from "./forumSwapReconciliationSchema";
import {
  requireSignatureExpiry,
  signatureStatus,
  type SignatureExpiryProof,
} from "../lib/swap-signature-expiry";
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
const SIGNED_DELAYS = [1000, 5000, 10000, 15000, 30000, 60000];
const checksFor = (row: Doc<"forumSwapQuotes">) =>
  row.signatureFirst ? SIGNED_DELAYS.length : MAX_CHECKS;
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
  diagnostic: v.optional(v.string()),
  progress: v.optional(
    v.union(
      v.literal("processed"),
      v.literal("confirmed"),
      v.literal("finalized"),
    ),
  ),
});
export function recoveryView(job: Doc<"forumSwapRecoveries">) {
  return {
    state: job.state,
    reason: job.reason,
    attempts: job.attempts,
    nextCheckAt: job.nextCheckAt,
    ...(job.diagnostic ? { diagnostic: job.diagnostic } : {}),
    ...(job.progress ? { progress: job.progress } : {}),
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
    ? now + (row.signatureFirst ? 1000 : 10_000)
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
    if (row.signatureFirst && row.expiresAt <= now) {
      const submission = await ctx.db
        .query("forumSwapSubmissions")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", quoteId))
        .unique();
      if (
        submission &&
        submission.signature === row.signature &&
        submission.attemptedAt === undefined
      ) {
        // Atomic with the relay claim: an expired, never-authorized relay
        // cannot race this cancellation into a later send. Legacy holds never enter here.
        await ctx.db.patch("forumSwapQuotes", row._id, {
          status: "failed",
          issue: "app_submission_not_started",
        });
        await ctx.db.patch("forumSwapRecoveries", job._id, {
          state: "resolved",
          reason: "resolved",
          nextCheckAt: 0,
          leaseUntil: 0,
        });
        return null;
      }
    }
    if (job.attempts >= checksFor(row)) {
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
    const cost = row.signature ? (row.signatureFirst ? 6 : 4) : 10;
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
    if (!sub.ok)
      return defer(
        ctx,
        job,
        "budget_unavailable",
        now,
        RETRY_MS,
        checksFor(row),
      );
    const daily = await commerceLimiter.limit(ctx, "commerceNetworkDaily", {
      key: "all",
      count: cost,
    });
    if (!daily.ok)
      return defer(
        ctx,
        job,
        "budget_unavailable",
        now,
        RETRY_MS,
        checksFor(row),
      );
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
  maxChecks = MAX_CHECKS,
) {
  const attempts = job.attempts + 1,
    state =
      attempts >= maxChecks ? ("review" as const) : ("scheduled" as const);
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
    diagnostic: v.optional(v.string()),
    progress: v.optional(
      v.union(
        v.literal("processed"),
        v.literal("confirmed"),
        v.literal("finalized"),
      ),
    ),
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
      v.object({
        kind: v.literal("signature_expired"),
        helius: signatureExpiryProof,
        solana: signatureExpiryProof,
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
        checksFor(row),
      );
    }
    const progressOrder = ["processed", "confirmed", "finalized"];
    await ctx.db.patch("forumSwapRecoveries", job._id, {
      ...(args.diagnostic && /^[a-z_]{1,60}$/.test(args.diagnostic)
        ? { diagnostic: args.diagnostic }
        : {}),
      ...(args.progress &&
      progressOrder.indexOf(args.progress) >
        progressOrder.indexOf(job.progress ?? "")
        ? { progress: args.progress }
        : {}),
    });
    const proof = args.evidence;
    if (!proof)
      return defer(
        ctx,
        { ...job, attempts: job.attempts - 1 },
        "evidence_inconclusive",
        now,
        row.signatureFirst
          ? SIGNED_DELAYS[Math.min(job.attempts, SIGNED_DELAYS.length - 1)]
          : row.signature
            ? 30_000 * job.attempts
            : RETRY_MS,
        checksFor(row),
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
    } else if (proof.kind === "signature_expired") {
      const submission = await ctx.db
        .query("forumSwapSubmissions")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", row._id))
        .unique();
      if (
        !row.signatureFirst ||
        !submission ||
        row.signature !== submission.signature
      )
        throw new ConvexError("Signature-first binding missing.");
      requireSignatureExpiry(row, proof.helius, now);
      requireSignatureExpiry(row, proof.solana, now);
      await ctx.db.patch("forumSwapSubmissions", submission._id, {
        expiryProofHash: await reconciliationHash(proof),
        previousQuoteHash: args.snapshotHash,
        expiryProof: { helius: proof.helius, solana: proof.solana },
      });
      await ctx.db.patch("forumSwapQuotes", row._id, {
        status: "failed",
        issue: "signature_expired_not_found",
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
/** Reserve optional absent-signature proof work inside both unchanged daily caps. */
export const reserveSignatureExpiry = internalMutation({
  args: { quoteId: v.id("forumSwapQuotes"), lease: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { quoteId, lease }) => {
    const job = await jobFor(ctx, quoteId),
      row = await ctx.db.get("forumSwapQuotes", quoteId);
    if (
      !enabled() ||
      !row?.signatureFirst ||
      !job ||
      job.state !== "checking" ||
      job.lease !== lease ||
      job.leaseUntil < Date.now()
    )
      return false;
    const sub = await commerceLimiter.limit(ctx, "commerceRecoveryDaily", {
      key: "all",
      count: 8,
    });
    if (!sub.ok) return false;
    return (
      await commerceLimiter.limit(ctx, "commerceNetworkDaily", {
        key: "all",
        count: 8,
      })
    ).ok;
  },
});
async function signatureExpiry(
  url: string,
  row: Doc<"forumSwapQuotes">,
  hash: string,
): Promise<SignatureExpiryProof> {
  const invalid = (await commerceRpc(url, "isBlockhashValid", [
    hash,
    { commitment: "finalized", minContextSlot: row.simulationSlot },
  ])) as { context: { slot: number }; value: boolean };
  if (invalid.value !== false || !Number.isSafeInteger(invalid.context?.slot))
    throw Error("Expiry not proven");
  const height = await commerceRpc(url, "getBlockHeight", [
    { commitment: "finalized", minContextSlot: invalid.context.slot },
  ]);
  const first = await commerceRpc(url, "getFirstAvailableBlock", []);
  if (typeof height !== "number" || typeof first !== "number")
    throw Error("Incomplete expiry metadata");
  // Re-read absence AFTER finalized expiry. A status observed before expiry
  // cannot rule out a transaction landing between those two observations.
  const status = signatureStatus(
    await commerceRpc(url, "getSignatureStatuses", [
      [row.signature],
      { searchTransactionHistory: true },
    ]),
    row.simulationSlot!,
  );
  if (!status.missing) throw Error("Signature exists; expiry is not absence");
  const proof = {
    signature: row.signature!,
    checkedAt: Date.now(),
    genesis: MAINNET_GENESIS,
    statusSlot: status.slot,
    invalidAtSlot: invalid.context.slot,
    finalizedHeight: height,
    firstAvailableSlot: first,
  };
  requireSignatureExpiry(row, proof, Date.now());
  return proof;
}
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
        }
      | {
          kind: "signature_expired";
          helius: SignatureExpiryProof;
          solana: SignatureExpiryProof;
        } = null;
    let diagnostic = "check_inconclusive",
      providerName = "helius";
    let progress: "processed" | "confirmed" | "finalized" | undefined;
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
        for (const [i, provider] of providers.entries()) {
          providerName = i === 0 ? "helius" : "solana";
          diagnostic = `${providerName}_genesis`;
          if (
            (await commerceRpc(provider, "getGenesisHash", [])) !==
            MAINNET_GENESIS
          )
            throw Error("Wrong chain");
          diagnostic = `${providerName}_receipt`;
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
        else if (row.signatureFirst) {
          const statuses = [];
          for (const [i, provider] of providers.entries()) {
            diagnostic = `${i === 0 ? "helius" : "solana"}_signature_status`;
            statuses.push(
              signatureStatus(
                await commerceRpc(provider, "getSignatureStatuses", [
                  [row.signature],
                  { searchTransactionHistory: true },
                ]),
                row.simulationSlot,
              ),
            );
          }
          const order = ["processed", "confirmed", "finalized"] as const;
          if (statuses[0].progress && statuses[1].progress)
            progress =
              order[
                Math.min(
                  order.indexOf(statuses[0].progress),
                  order.indexOf(statuses[1].progress),
                )
              ];
          // Time is only an IO optimization. Finalized block height and explicit
          // two-provider absence, not this timer, authorize an expired outcome.
          if (
            results.every((r) => r === null) &&
            statuses.every((s) => s.missing) &&
            Date.now() - row.createdAt >= 60000
          ) {
            if (
              await ctx.runMutation(
                internal.forumSwapRecovery.reserveSignatureExpiry,
                { quoteId, lease },
              )
            ) {
              const hash = await preparedBlockhash(row);
              diagnostic = "helius_signature_expiry";
              const helius = await signatureExpiry(providers[0], row, hash);
              diagnostic = "solana_signature_expiry";
              const solana = await signatureExpiry(providers[1], row, hash);
              evidence = { kind: "signature_expired", helius, solana };
            } else diagnostic = "expiry_budget_unavailable";
          } else
            diagnostic = progress
              ? "confirmation_pending_finality"
              : "signature_not_finalized";
        }
      } else {
        requireExpiredUnsignedHold(row, Date.now());
        const hash = await preparedBlockhash(row);
        providerName = "helius";
        const helius = await inspectProvider(providers[0], row, hash);
        providerName = "solana";
        evidence = {
          kind: "expired",
          helius,
          solana: await inspectProvider(providers[1], row, hash),
        };
      }
    } catch (error) {
      if (error instanceof ExpiryCheckError)
        diagnostic = `${providerName}_${error.stage}`;
      /* No provider body, signing, sending or simulation. Inconclusive is still held. */
    }
    await ctx.runMutation(internal.forumSwapRecovery.finish, {
      quoteId,
      lease,
      snapshotHash,
      evidence,
      diagnostic,
      ...(progress ? { progress } : {}),
    });
    return null;
  },
});
