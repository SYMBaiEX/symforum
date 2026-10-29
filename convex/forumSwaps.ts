import { ConvexError, v } from "convex/values";
import { getTransactionDecoder } from "@solana/kit";
import {
  action,
  env,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { commerceActor } from "./forumCommerceAccess";
import { refreshBenefitForActor } from "./forumCommerce";
import { commerceRpc } from "./forumCommerceRpc";
import { commerceConfig, record } from "../lib/forum-commerce";
import {
  buildSwapTransaction,
  collectSwapQuotes,
  validateSwapRequest,
  type SwapRouteQuote,
  type PreparedSwap,
} from "../lib/swap-router";

const providerValidator = v.union(v.literal("jupiter"), v.literal("raydium"));
const statusValidator = v.union(
  v.literal("quoted"),
  v.literal("preparing"),
  v.literal("prepared"),
  v.literal("submitted"),
  v.literal("held"),
  v.literal("confirmed"),
  v.literal("failed"),
);
const routeValidator = v.object({
  quoteId: v.id("forumSwapQuotes"),
  provider: providerValidator,
  inputMint: v.string(),
  outputMint: v.string(),
  amountRaw: v.string(),
  swapAmountRaw: v.string(),
  platformFeeRaw: v.string(),
  outputAmountRaw: v.string(),
  minimumOutputAmountRaw: v.string(),
  priceImpactBps: v.number(),
  platformFeeBps: v.number(),
  routeLabels: v.array(v.string()),
  expiresAt: v.number(),
});
const preparedValidator = v.object({
  quoteId: v.id("forumSwapQuotes"),
  wallet: v.string(),
  transactionBase64: v.string(),
  messageHash: v.string(),
  lastValidBlockHeight: v.number(),
  estimatedNetworkFeeLamports: v.string(),
  simulationSlot: v.number(),
  transactionVersion: v.union(v.literal(0), v.literal(1)),
});
function routeView(row: Doc<"forumSwapQuotes">) {
  const q = JSON.parse(row.quoteJson) as SwapRouteQuote;
  return {
    quoteId: row._id,
    provider: q.provider,
    inputMint: q.request.inputMint,
    outputMint: q.request.outputMint,
    amountRaw: q.request.amountRaw,
    swapAmountRaw: q.swapAmountRaw,
    platformFeeRaw: q.platformFeeRaw,
    outputAmountRaw: q.outputAmountRaw,
    minimumOutputAmountRaw: q.minimumOutputAmountRaw,
    priceImpactBps: q.priceImpactBps,
    platformFeeBps: row.platformFeeBps,
    routeLabels: q.routeLabels,
    expiresAt: row.expiresAt,
  };
}
export const quote = action({
  args: {
    wallet: v.string(),
    inputMint: v.string(),
    outputMint: v.string(),
    amountRaw: v.string(),
    slippageBps: v.number(),
    supportsV1: v.optional(v.boolean()),
  },
  returns: v.object({
    quotes: v.array(routeValidator),
    failures: v.array(
      v.object({ provider: providerValidator, reason: v.string() }),
    ),
    benefitEligible: v.boolean(),
    benefitStatus: v.union(
      v.literal("checking"),
      v.literal("verified"),
      v.literal("unavailable"),
    ),
    platformFeeBps: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    quotes: ReturnType<typeof routeView>[];
    failures: { provider: "jupiter" | "raydium"; reason: string }[];
    benefitEligible: boolean;
    benefitStatus: "checking" | "verified" | "unavailable";
    platformFeeBps: number;
  }> => {
    const config = commerceConfig(env);
    if (!config.swapsEnabled || !config.rpcUrl || !config.treasury)
      throw new ConvexError("Swaps are not enabled.");
    await ctx.runQuery(internal.forumCommerce.authorizeWallet, {
      wallet: args.wallet,
    });
    const benefit = await refreshBenefitForActor(ctx, { wallet: args.wallet });
    const platformFeeBps =
      benefit.status === "verified" &&
      benefit.eligible &&
      benefit.expiresAt > Date.now()
        ? 0
        : config.platformFeeBps;
    const request = {
      ...args,
      supportsV1: args.supportsV1 === true,
      platformFeeBps,
    };
    validateSwapRequest(request);
    await ctx.runQuery(internal.forumSwaps.checkMints, {
      inputMint: args.inputMint,
      outputMint: args.outputMint,
    });
    await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
      wallet: args.wallet,
      cost: 2,
    });
    const result = await collectSwapQuotes(request, {
      rpcUrl: config.rpcUrl,
      jupiterApiKey: config.jupiterApiKey,
      treasury: config.treasury,
    });
    const quotes = await ctx.runMutation(internal.forumSwaps.saveQuotes, {
      wallet: args.wallet,
      quotesJson: JSON.stringify(result.quotes),
    });
    return {
      quotes,
      failures: result.failures,
      benefitEligible: platformFeeBps === 0 && benefit.eligible,
      benefitStatus: benefit.status,
      platformFeeBps,
    };
  },
});
export const checkMints = internalQuery({
  args: { inputMint: v.string(), outputMint: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const mint of [args.inputMint, args.outputMint]) {
      const row = await ctx.db
        .query("forumTradeTokens")
        .withIndex("by_mint", (q) => q.eq("mint", mint))
        .unique();
      if (row?.status === "blocked")
        throw new ConvexError("This token is unavailable for swaps.");
    }
    return null;
  },
});
export const saveQuotes = internalMutation({
  args: { wallet: v.string(), quotesJson: v.string() },
  returns: v.array(routeValidator),
  handler: async (ctx, { wallet, quotesJson }) => {
    const actor = await commerceActor(ctx, wallet),
      config = commerceConfig(env),
      now = Date.now();
    if (!config.swapsEnabled || !config.treasury)
      throw new ConvexError("Swaps are not enabled.");
    if (quotesJson.length > 300_000)
      throw new ConvexError("Quote is too large.");
    const quotes = JSON.parse(quotesJson) as SwapRouteQuote[];
    if (!Array.isArray(quotes) || quotes.length > 2)
      throw new ConvexError("Invalid route count.");
    const result = [];
    for (const quote of quotes) {
      validateSwapRequest(quote.request);
      if (
        quote.request.wallet !== wallet ||
        quote.expiresAt <= now ||
        quote.expiresAt > now + 30_000 ||
        !["jupiter", "raydium"].includes(quote.provider)
      )
        throw new ConvexError("Invalid quote.");
      const id = await ctx.db.insert("forumSwapQuotes", {
        authUserId: actor.authUserId,
        userId: actor.userId,
        wallet,
        provider: quote.provider,
        quoteJson: JSON.stringify(quote),
        treasury: config.treasury,
        createdAt: now,
        expiresAt: quote.expiresAt,
        platformFeeBps: quote.request.platformFeeBps,
        status: "quoted",
      });
      const row = await ctx.db.get("forumSwapQuotes", id);
      if (!row) throw new Error("Quote missing.");
      result.push(routeView(row));
    }
    return result;
  },
});
export const consumeQuote = internalMutation({
  args: { quoteId: v.id("forumSwapQuotes") },
  returns: v.object({
    wallet: v.string(),
    quoteJson: v.string(),
    treasury: v.string(),
    platformFeeBps: v.number(),
  }),
  handler: async (ctx, { quoteId }) => {
    const row = await ctx.db.get("forumSwapQuotes", quoteId),
      actor = await commerceActor(ctx, row?.wallet);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Quote not found.");
    const config = commerceConfig(env);
    if (
      !config.swapsEnabled ||
      config.treasury !== row.treasury ||
      row.status !== "quoted" ||
      row.expiresAt <= Date.now()
    )
      throw new ConvexError(
        "Quote expired or already used. Request fresh routes.",
      );
    for (const status of ["submitted", "held"] as const) {
      const outstanding = await ctx.db
        .query("forumSwapQuotes")
        .withIndex("by_wallet_and_status", (q) =>
          q.eq("wallet", row.wallet).eq("status", status),
        )
        .take(1);
      if (outstanding.length)
        throw new ConvexError(
          "A previous wallet request needs reconciliation. Do not create another transaction.",
        );
    }
    await ctx.db.patch("forumSwapQuotes", quoteId, { status: "preparing" });
    return {
      wallet: row.wallet,
      quoteJson: row.quoteJson,
      treasury: row.treasury,
      platformFeeBps: row.platformFeeBps,
    };
  },
});
export const prepared = internalMutation({
  args: {
    quoteId: v.id("forumSwapQuotes"),
    transactionBase64: v.string(),
    messageHash: v.string(),
    lastValidBlockHeight: v.number(),
    estimatedNetworkFeeLamports: v.string(),
    simulationSlot: v.number(),
    transactionVersion: v.union(v.literal(0), v.literal(1)),
  },
  returns: preparedValidator,
  handler: async (ctx, args) => {
    const row = await ctx.db.get("forumSwapQuotes", args.quoteId),
      actor = await commerceActor(ctx, row?.wallet);
    if (
      !row ||
      row.authUserId !== actor.authUserId ||
      row.status !== "preparing"
    )
      throw new ConvexError("Quote not preparing.");
    if (row.expiresAt <= Date.now())
      throw new ConvexError("Quote expired before preparation completed.");
    const config = commerceConfig(env);
    if (!config.swapsEnabled || config.treasury !== row.treasury)
      throw new ConvexError(
        "Swaps are paused or treasury configuration changed.",
      );
    if (
      args.transactionBase64.length > 6000 ||
      !Number.isSafeInteger(args.lastValidBlockHeight) ||
      args.lastValidBlockHeight < 0 ||
      !/^[0-9a-f]{64}$/.test(args.messageHash)
    )
      throw new ConvexError("Invalid prepared swap.");
    try {
      if (atob(args.transactionBase64).length > 4096) throw new Error("size");
    } catch {
      throw new ConvexError("Invalid prepared swap wire size.");
    }
    const { quoteId, ...receipt } = args;
    await ctx.db.patch("forumSwapQuotes", quoteId, {
      ...receipt,
      status: "prepared",
    });
    return { ...args, wallet: row.wallet };
  },
});
export const preparationFailed = internalMutation({
  args: { quoteId: v.id("forumSwapQuotes") },
  returns: v.null(),
  handler: async (ctx, { quoteId }) => {
    const actor = await commerceActor(ctx),
      row = await ctx.db.get("forumSwapQuotes", quoteId);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Quote not found.");
    if (row.status === "preparing")
      await ctx.db.patch("forumSwapQuotes", quoteId, {
        status: "failed",
        issue: "preparation_not_completed",
      });
    return null;
  },
});
export const prepare = action({
  args: { quoteId: v.id("forumSwapQuotes") },
  returns: preparedValidator,
  handler: async (
    ctx,
    args,
  ): Promise<
    PreparedSwap & { quoteId: Id<"forumSwapQuotes">; wallet: string }
  > => {
    const saved = await ctx.runMutation(internal.forumSwaps.consumeQuote, args),
      config = commerceConfig(env);
    try {
      if (!config.rpcUrl || !config.treasury) throw new Error("Unavailable.");
      const benefit = await refreshBenefitForActor(ctx, {
        wallet: saved.wallet,
      });
      const fee =
        benefit.status === "verified" &&
        benefit.eligible &&
        benefit.expiresAt > Date.now()
          ? 0
          : config.platformFeeBps;
      if (fee !== saved.platformFeeBps)
        throw new ConvexError(
          "Holder benefit changed. Request fresh routes before signing.",
        );
      await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
        wallet: saved.wallet,
        cost: 10,
      });
      const result: PreparedSwap = await buildSwapTransaction(
        JSON.parse(saved.quoteJson) as SwapRouteQuote,
        {
          rpcUrl: config.rpcUrl,
          jupiterApiKey: config.jupiterApiKey,
          treasury: saved.treasury,
        },
      );
      return await ctx.runMutation(internal.forumSwaps.prepared, {
        quoteId: args.quoteId,
        ...result,
      });
    } catch (error) {
      await ctx.runMutation(internal.forumSwaps.preparationFailed, args);
      if (error instanceof ConvexError) throw error;
      throw new ConvexError(
        "No safe, simulated swap could be prepared. Request fresh routes.",
      );
    }
  },
});
const receiptValidator = v.object({
  quoteId: v.id("forumSwapQuotes"),
  status: statusValidator,
  signature: v.union(v.string(), v.null()),
  issue: v.union(v.string(), v.null()),
});
function receiptView(row: Doc<"forumSwapQuotes">) {
  return {
    quoteId: row._id,
    status: row.status,
    signature: row.signature ?? null,
    issue: row.issue ?? null,
  };
}
export const getStatus = query({
  args: { quoteId: v.id("forumSwapQuotes") },
  returns: receiptValidator,
  handler: async (ctx, { quoteId }) => {
    const actor = await commerceActor(ctx),
      row = await ctx.db.get("forumSwapQuotes", quoteId);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Quote not found.");
    return receiptView(row);
  },
});
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      quoteId: v.id("forumSwapQuotes"),
      status: statusValidator,
      signature: v.union(v.string(), v.null()),
      issue: v.union(v.string(), v.null()),
      wallet: v.string(),
      createdAt: v.number(),
      inputMint: v.string(),
      outputMint: v.string(),
      amountRaw: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const actor = await commerceActor(ctx);
    const rows = await ctx.db
      .query("forumSwapQuotes")
      .withIndex("by_authUserId_and_createdAt", (q) =>
        q.eq("authUserId", actor.authUserId),
      )
      .order("desc")
      .take(10);
    const important: Doc<"forumSwapQuotes">[] = [];
    for (const status of ["held", "submitted", "prepared"] as const)
      important.push(
        ...(await ctx.db
          .query("forumSwapQuotes")
          .withIndex("by_authUserId_and_status", (q) =>
            q.eq("authUserId", actor.authUserId).eq("status", status),
          )
          .order("desc")
          .take(10)),
      );
    const unique = new Map(
      [...important, ...rows].map((row) => [row._id, row]),
    );
    return [...unique.values()].slice(0, 10).map((row) => {
      const saved = JSON.parse(row.quoteJson) as SwapRouteQuote;
      return {
        ...receiptView(row),
        wallet: row.wallet,
        createdAt: row.createdAt,
        inputMint: saved.request.inputMint,
        outputMint: saved.request.outputMint,
        amountRaw: saved.request.amountRaw,
      };
    });
  },
});
export const markUnknown = mutation({
  args: { quoteId: v.id("forumSwapQuotes") },
  returns: receiptValidator,
  handler: async (ctx, { quoteId }) => {
    const row = await ctx.db.get("forumSwapQuotes", quoteId),
      actor = await commerceActor(ctx, row?.wallet);
    if (
      !row ||
      row.authUserId !== actor.authUserId ||
      !row.messageHash ||
      !["prepared", "submitted", "held", "confirmed"].includes(row.status)
    )
      throw new ConvexError("Prepared swap not found.");
    if (row.status !== "confirmed")
      await ctx.db.patch("forumSwapQuotes", row._id, {
        status: "held",
        issue: "wallet_outcome_unknown",
      });
    const current = await ctx.db.get("forumSwapQuotes", row._id);
    if (!current) throw new Error("Swap missing.");
    return receiptView(current);
  },
});
export const beginWalletRequest = mutation({
  args: { quoteId: v.id("forumSwapQuotes") },
  returns: receiptValidator,
  handler: async (ctx, { quoteId }) => {
    const row = await ctx.db.get("forumSwapQuotes", quoteId),
      actor = await commerceActor(ctx, row?.wallet);
    if (
      !row ||
      row.authUserId !== actor.authUserId ||
      row.status !== "prepared" ||
      !row.messageHash
    )
      throw new ConvexError(
        "Prepared swap not found or wallet request already started.",
      );
    const config = commerceConfig(env);
    if (
      row.expiresAt <= Date.now() ||
      !config.swapsEnabled ||
      config.treasury !== row.treasury
    )
      throw new ConvexError(
        "Quote expired or swaps paused. Request fresh routes; nothing was sent.",
      );
    for (const status of ["submitted", "held"] as const) {
      const other = await ctx.db
        .query("forumSwapQuotes")
        .withIndex("by_wallet_and_status", (q) =>
          q.eq("wallet", row.wallet).eq("status", status),
        )
        .take(1);
      if (other.length)
        throw new ConvexError(
          "A previous wallet request needs reconciliation.",
        );
    }
    await ctx.db.patch("forumSwapQuotes", row._id, {
      status: "submitted",
      issue: "wallet_request_started",
    });
    return {
      ...receiptView(row),
      status: "submitted" as const,
      issue: "wallet_request_started",
    };
  },
});
export const claimSignature = internalMutation({
  args: { quoteId: v.id("forumSwapQuotes"), signature: v.string() },
  returns: v.object({
    wallet: v.string(),
    messageHash: v.string(),
    confirmed: v.boolean(),
  }),
  handler: async (ctx, { quoteId, signature }) => {
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))
      throw new ConvexError("Invalid transaction signature.");
    const row = await ctx.db.get("forumSwapQuotes", quoteId),
      actor = await commerceActor(ctx, row?.wallet);
    if (
      !row ||
      row.authUserId !== actor.authUserId ||
      !row.messageHash ||
      !["prepared", "submitted", "held", "confirmed"].includes(row.status)
    )
      throw new ConvexError("Prepared swap not found.");
    if (row.signature && row.signature !== signature)
      throw new ConvexError(
        "A prior transaction outcome is unresolved. Do not resubmit or replace it.",
      );
    const duplicate = await ctx.db
      .query("forumSwapQuotes")
      .withIndex("by_signature", (q) => q.eq("signature", signature))
      .unique();
    const promotion = await ctx.db
      .query("forumPromotionIntents")
      .withIndex("by_signature", (q) => q.eq("signature", signature))
      .unique();
    if (promotion)
      throw new ConvexError(
        "This transaction is already bound to another operation.",
      );
    if (duplicate && duplicate._id !== quoteId)
      throw new ConvexError(
        "This transaction already belongs to another swap.",
      );
    if (row.status !== "confirmed")
      await ctx.db.patch("forumSwapQuotes", quoteId, {
        status: "submitted",
        signature,
        issue: "awaiting_finalized_receipt",
      });
    return {
      wallet: row.wallet,
      messageHash: row.messageHash,
      confirmed: row.status === "confirmed",
    };
  },
});
export const settle = internalMutation({
  args: {
    quoteId: v.id("forumSwapQuotes"),
    signature: v.string(),
    verified: v.boolean(),
    issue: v.string(),
  },
  returns: receiptValidator,
  handler: async (ctx, args) => {
    const actor = await commerceActor(ctx),
      row = await ctx.db.get("forumSwapQuotes", args.quoteId);
    if (
      !row ||
      row.authUserId !== actor.authUserId ||
      row.signature !== args.signature
    )
      throw new ConvexError("Swap receipt mismatch.");
    if (row.status !== "confirmed")
      await ctx.db.patch("forumSwapQuotes", row._id, {
        status: args.verified ? "confirmed" : "held",
        issue: args.verified ? undefined : args.issue.slice(0, 80),
      });
    const current = await ctx.db.get("forumSwapQuotes", row._id);
    if (!current) throw new Error("Swap missing.");
    return receiptView(current);
  },
});
export const confirm = action({
  args: { quoteId: v.id("forumSwapQuotes"), signature: v.string() },
  returns: receiptValidator,
  handler: async (ctx, args): Promise<ReturnType<typeof receiptView>> => {
    const saved = await ctx.runMutation(
      internal.forumSwaps.claimSignature,
      args,
    );
    if (saved.confirmed)
      return {
        quoteId: args.quoteId,
        status: "confirmed" as const,
        signature: args.signature,
        issue: null,
      };
    let verified = false,
      issue = "receipt_unavailable";
    try {
      const config = commerceConfig(env);
      if (!config.rpcUrl) throw new Error("RPC unavailable.");
      await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
        wallet: saved.wallet,
        cost: 1,
      });
      const result = record(
        await commerceRpc(config.rpcUrl, "getTransaction", [
          args.signature,
          {
            encoding: "base64",
            commitment: "finalized",
            maxSupportedTransactionVersion: 1,
          },
        ]),
      );
      const tx = result.transaction;
      if (
        result.meta &&
        record(result.meta).err === null &&
        Array.isArray(tx) &&
        tx[1] === "base64" &&
        typeof tx[0] === "string" &&
        tx[0].length <= 6000
      ) {
        const bytes = Uint8Array.from(atob(tx[0]), (c) => c.charCodeAt(0));
        if (bytes.length > 4096)
          throw new Error("Receipt wire size exceeds limit.");
        const decoded = getTransactionDecoder().decode(bytes);
        const digest = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            Uint8Array.from(decoded.messageBytes),
          ),
        );
        const hash = Array.from(digest, (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        verified = hash === saved.messageHash;
        issue = verified ? "finalized" : "transaction_message_mismatch";
      }
    } catch {
      /* Unknown is not failure and never authorizes a resend. */
    }
    return await ctx.runMutation(internal.forumSwaps.settle, {
      ...args,
      verified,
      issue,
    });
  },
});
