"use node";

import { ConvexError, v } from "convex/values";
import { internalAction, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { commerceConfig, COMMERCE_MINT } from "../lib/forum-commerce";
import {
  buildSwapTransaction,
  buildPromotionTransaction,
  type PromotionPaymentIntent,
} from "../lib/swap-transactions";
import {
  collectSwapQuotes,
  SOL_MINT,
  type SwapRouteQuote,
  type PreparedSwap,
} from "../lib/swap-router";
import {
  swapPreparationIssue,
  SWAP_PREPARATION_MESSAGES,
} from "../lib/swap-preparation-errors";

const prepared = v.object({
  transactionBase64: v.string(),
  messageHash: v.string(),
  lastValidBlockHeight: v.number(),
  estimatedNetworkFeeLamports: v.string(),
  simulationSlot: v.number(),
  transactionVersion: v.union(v.literal(0), v.literal(1)),
});
/** Internal only. The public orchestrator already consumed the one-shot intent and reserved its data budget. */
export const buildSwap = internalAction({
  args: { quoteJson: v.string(), treasury: v.string() },
  returns: prepared,
  handler: async (ctx, { quoteJson, treasury }): Promise<PreparedSwap> => {
    const config = commerceConfig(env);
    if (
      !config.swapsEnabled ||
      !config.rpcUrl ||
      config.treasury !== treasury ||
      quoteJson.length > 300000
    )
      throw new ConvexError("Swaps unavailable.");
    const quote = JSON.parse(quoteJson) as SwapRouteQuote;
    await ctx.runQuery(internal.forumCommerce.authorizeWallet, {
      wallet: quote.request.wallet,
    });
    try {
      return await buildSwapTransaction(quote, {
        rpcUrl: config.rpcUrl,
        treasury,
        jupiterApiKey: config.jupiterApiKey,
      });
    } catch (error) {
      throw new ConvexError(
        SWAP_PREPARATION_MESSAGES[swapPreparationIssue(error)],
      );
    }
  },
});
/** The same SDK/runtime boundary also applies to the shared transfer-and-burn builder. */
export const buildPromotion = internalAction({
  args: { intentJson: v.string(), supportsV1: v.boolean() },
  returns: prepared,
  handler: async (ctx, { intentJson, supportsV1 }): Promise<PreparedSwap> => {
    const config = commerceConfig(env);
    if (
      !config.promotionsEnabled ||
      !config.rpcUrl ||
      !config.treasury ||
      intentJson.length > 10000
    )
      throw new ConvexError("Promotions unavailable.");
    const intent = JSON.parse(intentJson) as PromotionPaymentIntent;
    if (intent.treasury !== config.treasury)
      throw new ConvexError("Treasury changed.");
    await ctx.runQuery(internal.forumCommerce.authorizeWallet, {
      wallet: intent.wallet,
    });
    return buildPromotionTransaction(
      intent,
      { rpcUrl: config.rpcUrl, treasury: config.treasury },
      supportsV1,
    );
  },
});
/** No signing/broadcast capability. Only metadata leaves this operator-only boundary. */
export const unsignedDiagnostic = internalAction({
  args: { wallet: v.string() },
  returns: v.object({
    ok: v.boolean(),
    code: v.string(),
    stage: v.string(),
    simulations: v.number(),
    kitCode: v.union(v.number(), v.null()),
    source: v.union(v.string(), v.null()),
  }),
  handler: async (
    ctx,
    { wallet },
  ): Promise<{
    ok: boolean;
    code: string;
    stage: string;
    simulations: number;
    kitCode: number | null;
    source: string | null;
  }> => {
    let stage = "admission",
      simulations = 0;
    if (
      !(await ctx.runMutation(
        internal.forumSwaps.reserveUnsignedDiagnostic,
        {},
      ))
    )
      return {
        ok: false,
        code: "diagnostic_budget_reached",
        stage,
        simulations,
        kitCode: null,
        source: null,
      };
    const config = commerceConfig(env);
    if (!config.rpcUrl || !config.treasury || !config.swapsEnabled)
      throw new ConvexError("Swaps unavailable.");
    const routerConfig = {
      rpcUrl: config.rpcUrl,
      treasury: config.treasury,
      jupiterApiKey: config.jupiterApiKey,
    };
    const fetcher: typeof fetch = async (input, init) => {
      const method =
        init?.method === "POST"
          ? JSON.parse(String(init.body)).method
          : undefined;
      stage = typeof method === "string" ? method : "quote";
      if (method === "simulateTransaction") simulations++;
      return fetch(input, init);
    };
    try {
      const request = {
        wallet,
        inputMint: SOL_MINT,
        outputMint: COMMERCE_MINT,
        amountRaw: "1000000",
        slippageBps: 50,
        platformFeeBps: config.platformFeeBps,
        supportsV1: true,
      };
      const result = await collectSwapQuotes(request, routerConfig, fetcher);
      const quote = result.quotes.find((q) => q.provider === "jupiter");
      if (!quote)
        return {
          ok: false,
          code: "no_fresh_jupiter_route",
          stage,
          simulations,
          kitCode: null,
          source: null,
        };
      await buildSwapTransaction(quote, routerConfig, fetcher);
      return {
        ok: true,
        code: "simulated",
        stage,
        simulations,
        kitCode: null,
        source: null,
      };
    } catch (error) {
      const context =
        error && typeof error === "object" && "context" in error
          ? error.context
          : null;
      const kitCode =
        context &&
        typeof context === "object" &&
        "__code" in context &&
        typeof context.__code === "number"
          ? context.__code
          : null;
      const source =
        error instanceof Error
          ? (error.stack?.match(/lib\/swap-[a-z-]+\.ts:\d+:\d+/)?.[0] ?? null)
          : null;
      return {
        ok: false,
        code: swapPreparationIssue(error),
        stage,
        simulations,
        kitCode,
        source,
      };
    }
  },
});
