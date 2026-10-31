import { ConvexError, v } from "convex/values";
import {
  action,
  env,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  commerceActor,
  publicCommerceThread,
  promotableCommerceThread,
} from "./forumCommerceAccess";
import { commerceLimiter } from "./forumCommerce";
import { commerceMint, commerceRpc } from "./forumCommerceRpc";
import { providerFetch } from "./forumProviderFetch";
import { ProviderAdmissionError } from "../lib/provider-admission-error";
import {
  allocatePromotionLane,
  CHECKOUT_TTL_MS,
  COMMERCE_MINT,
  commerceConfig,
  publicReference,
  verifyPromotionReceipt,
  unsignedRaw,
} from "../lib/forum-commerce";
import {
  selectedPromotionSlots,
  promotionCalendarSlots,
  overlapsPromotion,
} from "../lib/promotion-calendar";
import { SYMF_TOKEN } from "../lib/symf-token";
import { promotionSlot } from "./forumCommerceSchema";
import { promotionStatus } from "./forumCommerceSchema";
import type { PreparedSwap } from "../lib/swap-router";
import { recordTerminalPromotionReceipt } from "./forumTerminalTransparency";
import { walletTokenAccount } from "../lib/swap-rpc";

const intentValidator = v.object({
  intentId: v.id("forumPromotionIntents"),
  wallet: v.string(),
  threadId: v.id("forumThreads"),
  categorySlug: v.string(),
  treasury: v.string(),
  mint: v.string(),
  tokenProgram: v.string(),
  decimals: v.number(),
  amountRaw: v.string(),
  treasuryAmountRaw: v.string(),
  burnAmountRaw: v.string(),
  reference: v.string(),
  checkoutExpiresAt: v.number(),
  startsAt: v.number(),
  endsAt: v.number(),
  slots: v.optional(v.array(promotionSlot)),
  status: promotionStatus,
  signature: v.union(v.string(), v.null()),
  issue: v.union(v.string(), v.null()),
  prepared: v.boolean(),
});
function publicIntent(row: Doc<"forumPromotionIntents">) {
  return {
    intentId: row._id,
    wallet: row.wallet,
    threadId: row.threadId,
    categorySlug: row.categorySlug,
    treasury: row.treasury,
    mint: row.mint,
    tokenProgram: row.tokenProgram,
    decimals: row.decimals,
    amountRaw: row.amountRaw,
    treasuryAmountRaw: row.treasuryAmountRaw,
    burnAmountRaw: row.burnAmountRaw,
    reference: row.reference,
    checkoutExpiresAt: row.checkoutExpiresAt,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    ...(row.slots ? { slots: row.slots } : {}),
    status: row.status,
    signature: row.signature ?? null,
    issue: row.issue ?? null,
    prepared: row.messageHash !== undefined,
  };
}
async function inventory(
  ctx: MutationCtx | QueryCtx,
  categoryId: Id<"forumCategories">,
  now: number,
  omit?: Id<"forumPromotionIntents">,
) {
  const rows = await ctx.db
    .query("forumPromotionIntents")
    .withIndex("by_categoryId_and_endsAt", (q) =>
      q.eq("categoryId", categoryId).gt("endsAt", now),
    )
    .take(128);
  if (rows.length === 128)
    throw new ConvexError("This board's promotion queue is full.");
  // Unknown payment records remain held forever, but an expired inventory lease
  // cannot lock a board forever. Late receipt proof is requeued atomically.
  return rows
    .filter(
      (r) =>
        r._id !== omit &&
        (r.status === "scheduled" ||
          (r.status !== "expired" && r.checkoutExpiresAt > now)),
    )
    .flatMap((r) =>
      r.slots
        ? r.slots.map((slot) => ({ ...r, ...slot }))
        : [
            {
              ...r,
              endsAt:
                r.status === "scheduled"
                  ? r.endsAt
                  : r.endsAt + CHECKOUT_TTL_MS,
            },
          ],
    );
}
export const quotePromotion = action({
  args: {
    wallet: v.string(),
    threadId: v.id("forumThreads"),
    selectedStartsAt: v.optional(v.array(v.number())),
    expectedCategoryId: v.optional(v.id("forumCategories")),
  },
  returns: intentValidator,
  handler: async (ctx, args): Promise<ReturnType<typeof publicIntent>> => {
    const config = commerceConfig(env);
    if (!config.promotionsEnabled || !config.rpcUrl)
      throw new ConvexError("Paid promotions are not enabled.");
    const count = args.selectedStartsAt
      ? selectedPromotionSlots(
          Date.now(),
          args.selectedStartsAt,
          config.promotionDurationMs,
          [],
          CHECKOUT_TTL_MS,
        ).length
      : 1;
    const amount = unsignedRaw(
      String(BigInt(config.promotionAmountRaw) * BigInt(count)),
    );
    await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
      wallet: args.wallet,
      cost: 2,
    });
    const fetcher = providerFetch(ctx, { rpcUrls: [config.rpcUrl] });
    const mint = await commerceMint(config.rpcUrl, COMMERCE_MINT, fetcher);
    try {
      await walletTokenAccount(
        config.rpcUrl,
        args.wallet,
        {
          mint: COMMERCE_MINT,
          decimals: mint.decimals,
          tokenProgram: mint.tokenProgram,
        },
        amount,
        fetcher,
      );
    } catch (error) {
      if (error instanceof ProviderAdmissionError) throw error;
      throw new ConvexError(
        "Fund this wallet with the full promotion amount in one eligible SYMF token account before reserving inventory.",
      );
    }
    const reference = publicReference(
      crypto.getRandomValues(new Uint8Array(32)),
    );
    return await ctx.runMutation(internal.forumPromotions.reserve, {
      ...args,
      decimals: mint.decimals,
      tokenProgram: mint.tokenProgram,
      reference,
    });
  },
});
export const reserve = internalMutation({
  args: {
    wallet: v.string(),
    threadId: v.id("forumThreads"),
    tokenProgram: v.string(),
    decimals: v.number(),
    reference: v.string(),
    selectedStartsAt: v.optional(v.array(v.number())),
    expectedCategoryId: v.optional(v.id("forumCategories")),
  },
  returns: intentValidator,
  handler: async (ctx, args) => {
    const actor = await commerceActor(ctx, args.wallet),
      config = commerceConfig(env),
      now = Date.now();
    if (!config.promotionsEnabled || !config.treasury)
      throw new ConvexError("Paid promotions are not enabled.");
    const rate = await commerceLimiter.limit(ctx, "commerceCheckout", {
      key: actor.authUserId,
    });
    if (!rate.ok)
      throw new ConvexError("Promotion checkout rate limit reached.");
    const thread = await promotableCommerceThread(ctx, args.threadId);
    if (!thread)
      throw new ConvexError("Only active public board posts can be promoted.");
    if (
      args.expectedCategoryId &&
      args.expectedCategoryId !== thread.categoryId
    )
      throw new ConvexError(
        "This post moved to another board. Refresh its calendar before booking.",
      );
    const prior = await ctx.db
      .query("forumPromotionIntents")
      .withIndex("by_threadId_and_createdAt", (q) =>
        q.eq("threadId", thread._id),
      )
      .order("desc")
      .take(64);
    if (prior.length === 64)
      throw new ConvexError("This post's promotion history requires review.");
    const rows = await inventory(ctx, thread.categoryId, now);
    const slots = args.selectedStartsAt
      ? selectedPromotionSlots(
          now,
          args.selectedStartsAt,
          config.promotionDurationMs,
          rows,
          CHECKOUT_TTL_MS,
        )
      : undefined;
    if (
      slots &&
      rows.some(
        (r) =>
          r.threadId === thread._id &&
          slots.some((slot) => overlapsPromotion(r, slot)),
      )
    )
      throw new ConvexError(
        "This post already has a placement at a selected time.",
      );
    const duplicate = prior.find(
      (r) =>
        (!slots && r.status === "scheduled" && r.endsAt > now) ||
        (r.status !== "expired" &&
          r.status !== "scheduled" &&
          r.checkoutExpiresAt > now),
    );
    if (duplicate)
      throw new ConvexError(
        "This post already has a promotion or an open checkout.",
      );
    if (
      prior.some(
        (r) =>
          r.authUserId === actor.authUserId &&
          ["submitted", "held"].includes(r.status),
      )
    )
      throw new ConvexError(
        "A payment outcome is unresolved. Recheck that receipt; do not pay again.",
      );
    const existing = await ctx.db
      .query("forumPromotionIntents")
      .withIndex("by_reference", (q) => q.eq("reference", args.reference))
      .unique();
    if (existing) throw new ConvexError("Duplicate payment reference.");
    const amount = unsignedRaw(
        String(BigInt(config.promotionAmountRaw) * BigInt(slots?.length ?? 1)),
      ),
      burn = amount / 2n;
    if (burn <= 0n) throw new ConvexError("Invalid promotion price.");
    const slot = slots
      ? {
          lane: slots[0].lane,
          startsAt: slots[0].startsAt,
          endsAt: slots[slots.length - 1].endsAt,
        }
      : allocatePromotionLane(now, config.promotionDurationMs, rows);
    const id = await ctx.db.insert("forumPromotionIntents", {
      authUserId: actor.authUserId,
      userId: actor.userId,
      wallet: args.wallet,
      threadId: thread._id,
      categoryId: thread.categoryId,
      categorySlug: thread.categorySlug,
      treasury: config.treasury,
      mint: COMMERCE_MINT,
      tokenProgram: args.tokenProgram,
      decimals: args.decimals,
      amountRaw: String(amount),
      treasuryAmountRaw: String(amount - burn),
      burnAmountRaw: String(burn),
      reference: args.reference,
      ...slot,
      ...(slots ? { slots } : {}),
      createdAt: now,
      checkoutExpiresAt: now + CHECKOUT_TTL_MS,
      status: "checkout",
    });
    await ctx.scheduler.runAfter(
      CHECKOUT_TTL_MS,
      internal.forumPromotions.expireCheckout,
      { intentId: id },
    );
    const row = await ctx.db.get("forumPromotionIntents", id);
    if (!row) throw new Error("Promotion reservation missing.");
    return publicIntent(row);
  },
});
export const expireCheckout = internalMutation({
  args: { intentId: v.id("forumPromotionIntents") },
  returns: v.null(),
  handler: async (ctx, { intentId }) => {
    const row = await ctx.db.get("forumPromotionIntents", intentId);
    if (row?.status === "checkout" && row.checkoutExpiresAt <= Date.now())
      await ctx.db.patch("forumPromotionIntents", row._id, {
        status: "expired",
      });
    return null;
  },
});
export const getPromotion = query({
  args: { intentId: v.id("forumPromotionIntents") },
  returns: intentValidator,
  handler: async (ctx, { intentId }) => {
    const actor = await commerceActor(ctx),
      row = await ctx.db.get("forumPromotionIntents", intentId);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Promotion not found.");
    return publicIntent(row);
  },
});
export const listMine = query({
  args: {},
  returns: v.array(intentValidator),
  handler: async (ctx) => {
    const actor = await commerceActor(ctx);
    const rows = await ctx.db
      .query("forumPromotionIntents")
      .withIndex("by_authUserId_and_createdAt", (q) =>
        q.eq("authUserId", actor.authUserId),
      )
      .order("desc")
      .take(10);
    const important: Doc<"forumPromotionIntents">[] = [];
    for (const status of ["held", "submitted"] as const)
      important.push(
        ...(await ctx.db
          .query("forumPromotionIntents")
          .withIndex("by_authUserId_and_status", (q) =>
            q.eq("authUserId", actor.authUserId).eq("status", status),
          )
          .order("desc")
          .take(10)),
      );
    const unique = new Map(
      [...important, ...rows].map((row) => [row._id, row]),
    );
    return [...unique.values()].slice(0, 10).map(publicIntent);
  },
});
export const consumePreparation = internalMutation({
  args: { intentId: v.id("forumPromotionIntents") },
  returns: intentValidator,
  handler: async (ctx, { intentId }) => {
    const row = await ctx.db.get("forumPromotionIntents", intentId);
    const actor = await commerceActor(ctx, row?.wallet),
      config = commerceConfig(env);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Promotion not found.");
    if (
      !config.promotionsEnabled ||
      config.treasury !== row.treasury ||
      row.status !== "checkout" ||
      row.preparationStartedAt !== undefined ||
      Date.now() + 15000 >= row.checkoutExpiresAt
    )
      throw new ConvexError(
        "Checkout expired or preparation already requested. Do not submit another payment.",
      );
    const currentThread = await promotableCommerceThread(ctx, row.threadId);
    if (!currentThread || currentThread.categoryId !== row.categoryId)
      throw new ConvexError(
        "This post is no longer eligible in the selected board.",
      );
    await ctx.db.patch("forumPromotionIntents", row._id, {
      preparationStartedAt: Date.now(),
    });
    return publicIntent(row);
  },
});
export const savePreparation = internalMutation({
  args: { intentId: v.id("forumPromotionIntents"), messageHash: v.string() },
  returns: v.null(),
  handler: async (ctx, { intentId, messageHash }) => {
    const row = await ctx.db.get("forumPromotionIntents", intentId),
      actor = await commerceActor(ctx, row?.wallet);
    const config = commerceConfig(env);
    if (
      !row ||
      row.authUserId !== actor.authUserId ||
      row.status !== "checkout" ||
      !row.preparationStartedAt ||
      Date.now() + 10000 >= row.checkoutExpiresAt ||
      !/^[0-9a-f]{64}$/.test(messageHash) ||
      !config.promotionsEnabled ||
      config.treasury !== row.treasury
    )
      throw new ConvexError("Checkout is no longer ready.");
    const currentThread = await promotableCommerceThread(ctx, row.threadId);
    if (!currentThread || currentThread.categoryId !== row.categoryId)
      throw new ConvexError(
        "This post is no longer eligible in the selected board.",
      );
    await ctx.db.patch("forumPromotionIntents", row._id, { messageHash });
    return null;
  },
});
export const prepare = action({
  args: {
    intentId: v.id("forumPromotionIntents"),
    supportsV1: v.optional(v.boolean()),
  },
  returns: v.object({
    intentId: v.id("forumPromotionIntents"),
    wallet: v.string(),
    transactionBase64: v.string(),
    messageHash: v.string(),
    lastValidBlockHeight: v.number(),
    estimatedNetworkFeeLamports: v.string(),
    simulationSlot: v.number(),
    transactionVersion: v.union(v.literal(0), v.literal(1)),
  }),
  handler: async (
    ctx,
    { intentId, supportsV1 },
  ): Promise<
    PreparedSwap & { intentId: Id<"forumPromotionIntents">; wallet: string }
  > => {
    const saved = await ctx.runMutation(
      internal.forumPromotions.consumePreparation,
      { intentId },
    );
    const config = commerceConfig(env);
    if (!config.rpcUrl) throw new ConvexError("Commerce RPC unavailable.");
    try {
      await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
        wallet: saved.wallet,
        cost: 10,
      });
      const result: PreparedSwap = await ctx.runAction(
        internal.forumCommerceNode.buildPromotion,
        {
          intentJson: JSON.stringify(saved),
          supportsV1: supportsV1 === true,
        },
      );
      await ctx.runMutation(internal.forumPromotions.savePreparation, {
        intentId,
        messageHash: result.messageHash,
      });
      return { intentId, wallet: saved.wallet, ...result };
    } catch {
      throw new ConvexError(
        "No payment was sent. Preparation failed; this checkout cannot be prepared again. Wait for its expiry before requesting another.",
      );
    }
  },
});
export const markUnknown = mutation({
  args: { intentId: v.id("forumPromotionIntents") },
  returns: intentValidator,
  handler: async (ctx, { intentId }) => {
    const row = await ctx.db.get("forumPromotionIntents", intentId),
      actor = await commerceActor(ctx, row?.wallet);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Promotion not found.");
    if (row.status !== "scheduled") {
      if (
        !row.messageHash ||
        !["checkout", "submitted", "held", "expired"].includes(row.status)
      )
        throw new ConvexError("Prepared payment not found.");
      await ctx.db.patch("forumPromotionIntents", row._id, {
        status: "held",
        issue: "wallet_outcome_unknown",
      });
    }
    const current = await ctx.db.get("forumPromotionIntents", row._id);
    if (!current) throw new Error("Promotion missing.");
    return publicIntent(current);
  },
});
export const beginWalletRequest = mutation({
  args: { intentId: v.id("forumPromotionIntents") },
  returns: intentValidator,
  handler: async (ctx, { intentId }) => {
    const row = await ctx.db.get("forumPromotionIntents", intentId),
      actor = await commerceActor(ctx, row?.wallet);
    if (
      !row ||
      row.authUserId !== actor.authUserId ||
      row.status !== "checkout" ||
      !row.messageHash ||
      Date.now() + 5000 >= row.checkoutExpiresAt
    )
      throw new ConvexError(
        "Prepared payment not found or wallet request already started.",
      );
    const config = commerceConfig(env);
    const currentThread = await promotableCommerceThread(ctx, row.threadId);
    if (
      !config.promotionsEnabled ||
      config.treasury !== row.treasury ||
      !currentThread ||
      currentThread.categoryId !== row.categoryId
    )
      throw new ConvexError(
        "Promotions paused or post no longer eligible. Nothing was sent.",
      );
    await ctx.db.patch("forumPromotionIntents", row._id, {
      status: "submitted",
      issue: "wallet_request_started",
    });
    return {
      ...publicIntent(row),
      status: "submitted" as const,
      issue: "wallet_request_started",
    };
  },
});
export const receiptContext = internalQuery({
  args: { intentId: v.id("forumPromotionIntents") },
  returns: v.object({
    intentId: v.id("forumPromotionIntents"),
    wallet: v.string(),
    treasury: v.string(),
    mint: v.string(),
    tokenProgram: v.string(),
    amountRaw: v.string(),
    treasuryAmountRaw: v.string(),
    burnAmountRaw: v.string(),
    decimals: v.number(),
    reference: v.string(),
    createdAt: v.number(),
    checkoutExpiresAt: v.number(),
    signature: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { intentId }) => {
    const actor = await commerceActor(ctx),
      row = await ctx.db.get("forumPromotionIntents", intentId);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Promotion not found.");
    return {
      intentId: row._id,
      wallet: row.wallet,
      treasury: row.treasury,
      mint: row.mint,
      tokenProgram: row.tokenProgram,
      amountRaw: row.amountRaw,
      treasuryAmountRaw: row.treasuryAmountRaw,
      burnAmountRaw: row.burnAmountRaw,
      decimals: row.decimals,
      reference: row.reference,
      createdAt: row.createdAt,
      checkoutExpiresAt: row.checkoutExpiresAt,
      signature: row.signature ?? null,
    };
  },
});
export const claimSignature = internalMutation({
  args: { intentId: v.id("forumPromotionIntents"), signature: v.string() },
  returns: intentValidator,
  handler: async (ctx, { intentId, signature }) => {
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))
      throw new ConvexError("Invalid transaction signature.");
    const actor = await commerceActor(ctx),
      row = await ctx.db.get("forumPromotionIntents", intentId);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Promotion not found.");
    await commerceActor(ctx, row.wallet);
    if (row.signature && row.signature !== signature)
      throw new ConvexError(
        "An earlier payment is unresolved. Its signature cannot be replaced.",
      );
    const duplicate = await ctx.db
      .query("forumPromotionIntents")
      .withIndex("by_signature", (q) => q.eq("signature", signature))
      .unique();
    const swap = await ctx.db
      .query("forumSwapQuotes")
      .withIndex("by_signature", (q) => q.eq("signature", signature))
      .unique();
    if (swap)
      throw new ConvexError(
        "This transaction is already bound to another operation.",
      );
    if (duplicate && duplicate._id !== intentId)
      throw new ConvexError(
        "This transaction is already bound to another promotion.",
      );
    if (row.status !== "scheduled")
      await ctx.db.patch("forumPromotionIntents", intentId, {
        signature,
        status: "submitted",
        issue: "awaiting_finalized_receipt",
      });
    const current = await ctx.db.get("forumPromotionIntents", intentId);
    if (!current) throw new Error("Promotion missing.");
    return publicIntent(current);
  },
});
export const settleReceipt = internalMutation({
  args: {
    intentId: v.id("forumPromotionIntents"),
    signature: v.string(),
    verified: v.boolean(),
    issue: v.string(),
    blockTime: v.union(v.number(), v.null()),
  },
  returns: intentValidator,
  handler: async (ctx, args) => {
    const actor = await commerceActor(ctx),
      row = await ctx.db.get("forumPromotionIntents", args.intentId);
    if (
      !row ||
      row.authUserId !== actor.authUserId ||
      row.signature !== args.signature
    )
      throw new ConvexError("Promotion receipt mismatch.");
    if (row.status === "scheduled") return publicIntent(row);
    if (!args.verified) {
      await ctx.db.patch("forumPromotionIntents", row._id, {
        status: "held",
        issue: args.issue.slice(0, 80),
      });
    } else {
      const now = Date.now(),
        thread = await publicCommerceThread(ctx, row.threadId);
      await recordTerminalPromotionReceipt(ctx, row, now);
      if (!thread || thread.categoryId !== row.categoryId)
        await ctx.db.patch("forumPromotionIntents", row._id, {
          status: "held",
          issue: "paid_content_no_longer_eligible",
          verifiedAt: now,
          blockTime: args.blockTime ?? undefined,
        });
      else {
        try {
          const rows = await inventory(ctx, row.categoryId, now, row._id),
            sameThread = rows.filter(
              (r) => r.threadId === row.threadId && r.status === "scheduled",
            ),
            floor = Math.max(now, ...sameThread.map((r) => r.endsAt));
          if (row.slots) {
            const duration = row.slots[0].endsAt - row.slots[0].startsAt;
            if (
              rows.some(
                (r) =>
                  r.threadId === row.threadId &&
                  row.slots!.some((slot) => overlapsPromotion(r, slot)),
              )
            )
              throw Error(
                "Selected placement overlaps another booking for this post",
              );
            const exact = selectedPromotionSlots(
              now,
              row.slots.map((s) => s.startsAt),
              duration,
              rows,
            );
            await ctx.db.patch("forumPromotionIntents", row._id, {
              slots: exact,
              lane: exact[0].lane,
              startsAt: exact[0].startsAt,
              endsAt: exact[exact.length - 1].endsAt,
              status: "scheduled",
              issue: undefined,
              verifiedAt: now,
              blockTime: args.blockTime ?? undefined,
            });
            const current = await ctx.db.get("forumPromotionIntents", row._id);
            if (!current) throw Error("Promotion missing");
            return publicIntent(current);
          }
          const duration = row.endsAt - row.startsAt;
          // The checkout's calendar reservation includes one checkout-window of
          // slack. A prompt payer receives the full paid duration, not a duration
          // shortened by time spent approving their wallet request.
          const startsAt = Math.max(now, row.startsAt);
          const slot =
            row.checkoutExpiresAt > now
              ? { lane: row.lane, startsAt, endsAt: startsAt + duration }
              : allocatePromotionLane(floor, duration, rows);
          await ctx.db.patch("forumPromotionIntents", row._id, {
            ...slot,
            status: "scheduled",
            issue: undefined,
            verifiedAt: now,
            blockTime: args.blockTime ?? undefined,
          });
        } catch {
          await ctx.db.patch("forumPromotionIntents", row._id, {
            status: "held",
            issue: "paid_inventory_requires_review",
            verifiedAt: now,
            blockTime: args.blockTime ?? undefined,
          });
        }
      }
    }
    const current = await ctx.db.get("forumPromotionIntents", row._id);
    if (!current) throw new Error("Promotion missing.");
    return publicIntent(current);
  },
});
export const submitPromotion = action({
  args: { intentId: v.id("forumPromotionIntents"), signature: v.string() },
  returns: intentValidator,
  handler: async (ctx, args): Promise<ReturnType<typeof publicIntent>> => {
    const claimed = await ctx.runMutation(
      internal.forumPromotions.claimSignature,
      args,
    );
    if (claimed.status === "scheduled") return claimed;
    const intent = await ctx.runQuery(internal.forumPromotions.receiptContext, {
        intentId: args.intentId,
      }),
      config = commerceConfig(env);
    let verified = false,
      issue = "receipt_unavailable",
      blockTime: number | null = null;
    try {
      if (!config.rpcUrl) throw new Error("RPC unavailable.");
      await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
        wallet: intent.wallet,
        cost: 1,
      });
      const result = await commerceRpc(
        config.rpcUrl,
        "getTransaction",
        [
          args.signature,
          {
            encoding: "jsonParsed",
            commitment: "finalized",
            maxSupportedTransactionVersion: 1,
          },
        ],
        providerFetch(ctx, { rpcUrls: [config.rpcUrl] }),
      );
      if (result !== null) {
        const proof = verifyPromotionReceipt(result, intent);
        verified = proof.valid;
        issue = proof.reason;
        blockTime = proof.blockTime;
      }
    } catch {
      /* A timeout, absent finalized receipt or budget refusal is an unresolved hold. */
    }
    return await ctx.runMutation(internal.forumPromotions.settleReceipt, {
      ...args,
      verified,
      issue,
      blockTime,
    });
  },
});
export const listPromoted = query({
  args: { categorySlug: v.string(), now: v.number() },
  returns: v.array(
    v.object({
      intentId: v.id("forumPromotionIntents"),
      threadId: v.id("forumThreads"),
      title: v.string(),
      slug: v.string(),
      categorySlug: v.string(),
      startsAt: v.number(),
      endsAt: v.number(),
      label: v.literal("Promoted"),
    }),
  ),
  handler: async (ctx, { categorySlug, now }) => {
    if (!Number.isSafeInteger(now) || now < 0 || categorySlug.length > 100)
      return [];
    const category = await ctx.db
      .query("forumCategories")
      .withIndex("by_slug", (q) => q.eq("slug", categorySlug))
      .unique();
    if (!category) return [];
    const rows = await ctx.db
      .query("forumPromotionIntents")
      .withIndex("by_categoryId_and_endsAt", (q) =>
        q.eq("categoryId", category._id).gt("endsAt", now),
      )
      .take(128);
    const active = rows
        .filter((r) => r.status === "scheduled")
        .flatMap((r) =>
          (r.slots ?? [r])
            .filter((slot) => slot.startsAt <= now && slot.endsAt > now)
            .map((slot) => ({ ...r, ...slot })),
        )
        .sort((a, b) => a.lane - b.lane),
      result: {
        intentId: Id<"forumPromotionIntents">;
        threadId: Id<"forumThreads">;
        title: string;
        slug: string;
        categorySlug: string;
        label: "Promoted";
        startsAt: number;
        endsAt: number;
      }[] = [];
    for (const row of active) {
      const thread = await publicCommerceThread(ctx, row.threadId);
      if (
        thread &&
        thread.categoryId === row.categoryId &&
        !result.some((r) => r.threadId === thread._id)
      )
        result.push({
          intentId: row._id,
          threadId: thread._id,
          title: thread.title,
          slug: thread.slug,
          categorySlug: thread.categorySlug,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          label: "Promoted" as const,
        });
      if (result.length === 5) break;
    }
    return result;
  },
});

/** Reading the calendar neither requires a wallet nor reserves paid inventory. */
export const calendar = query({
  args: { threadId: v.id("forumThreads"), minute: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      categoryId: v.id("forumCategories"),
      generatedAt: v.number(),
      durationMs: v.number(),
      amountRaw: v.string(),
      decimals: v.number(),
      slots: v.array(
        v.object({
          startsAt: v.number(),
          endsAt: v.number(),
          remaining: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const thread = await promotableCommerceThread(ctx, args.threadId),
      config = commerceConfig(env);
    if (
      !thread ||
      !config.promotionsEnabled ||
      !Number.isSafeInteger(args.minute)
    )
      return null;
    const now = Date.now(),
      rows = await inventory(ctx, thread.categoryId, now);
    const slots = promotionCalendarSlots(
      now,
      config.promotionDurationMs,
      rows,
      CHECKOUT_TTL_MS,
    ).map((slot) => ({
      ...slot,
      remaining: rows.some(
        (r) => r.threadId === thread._id && overlapsPromotion(r, slot),
      )
        ? 0
        : slot.remaining,
    }));
    return {
      categoryId: thread.categoryId,
      generatedAt: now,
      durationMs: config.promotionDurationMs,
      amountRaw: config.promotionAmountRaw,
      decimals: SYMF_TOKEN.decimals,
      slots,
    };
  },
});
