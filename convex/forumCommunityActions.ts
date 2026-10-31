import { ConvexError, v, type Infer } from "convex/values";
import { action, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { commerceMint, commerceRpc } from "./forumCommerceRpc";
import { paymentView } from "./forumCommunity";
import {
  boundedArray,
  COMMERCE_MINT,
  commerceConfig,
  record,
  unsignedRaw,
} from "../lib/forum-commerce";
import { verifyCommunityReceipt } from "../lib/forum-community";
import { providerFetch } from "./forumProviderFetch";

/** Read-only receipt verification. This action never signs, sends or rebroadcasts. */
export const verifyPayment = action({
  args: { intentId: v.id("forumCommunityPayments"), signature: v.string() },
  returns: paymentView,
  handler: async (ctx, args): Promise<Infer<typeof paymentView>> => {
    const config = commerceConfig(env);
    if (!config.rpcUrl)
      throw new ConvexError("Chain receipt verification is unavailable.");
    const lease = crypto.randomUUID();
    const claim: { check: boolean; payment: Infer<typeof paymentView> } =
      await ctx.runMutation(internal.forumCommunity.claimPaymentCheck, {
        ...args,
        lease,
      });
    if (!claim.check) return claim.payment;
    let result: ReturnType<typeof verifyCommunityReceipt> = {
      valid: false,
      issue: "receipt_unavailable",
      finalizedAt: null,
      slot: null,
    };
    try {
      await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
        wallet: claim.payment.wallet,
        cost: 1,
      });
      const tx = await commerceRpc(
        config.rpcUrl,
        "getTransaction",
        [
          args.signature,
          {
            commitment: "finalized",
            encoding: "jsonParsed",
            maxSupportedTransactionVersion: 1,
          },
        ],
        providerFetch(ctx, { rpcUrls: [config.rpcUrl] }),
      );
      result = verifyCommunityReceipt(tx, claim.payment, args.signature);
    } catch {
      /* Failure is an unresolved outcome, never proof that no payment landed. */
    }
    return await ctx.runMutation(internal.forumCommunity.finishPaymentCheck, {
      intentId: args.intentId,
      lease,
      ...result,
    });
  },
});

export const refreshSupporter = action({
  args: { wallet: v.string() },
  returns: v.union(
    v.object({
      optedIn: v.boolean(),
      eligible: v.boolean(),
      checkedAt: v.number(),
      expiresAt: v.number(),
      proofSlot: v.union(v.number(), v.null()),
    }),
    v.null(),
  ),
  handler: async (
    ctx,
    { wallet },
  ): Promise<{
    optedIn: boolean;
    eligible: boolean;
    checkedAt: number;
    expiresAt: number;
    proofSlot: number | null;
  } | null> => {
    const config = commerceConfig(env);
    if (!config.rpcUrl) throw new ConvexError("Holder proof is unavailable.");
    const claim: {
      fetch: boolean;
      userId: string;
      proof: {
        optedIn: boolean;
        eligible: boolean;
        checkedAt: number;
        expiresAt: number;
        proofSlot: number | null;
      } | null;
    } = await ctx.runMutation(internal.forumCommunity.claimSupporterRefresh, {
      wallet,
    });
    if (!claim.fetch) return claim.proof;
    let eligible = false,
      slot: number | null = null;
    try {
      await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
        wallet,
        cost: 2,
      });
      const fetcher = providerFetch(ctx, { rpcUrls: [config.rpcUrl] });
      const mint = await commerceMint(config.rpcUrl, COMMERCE_MINT, fetcher);
      const response = record(
        await commerceRpc(
          config.rpcUrl,
          "getTokenAccountsByOwner",
          [
            wallet,
            { mint: COMMERCE_MINT },
            { encoding: "jsonParsed", commitment: "finalized" },
          ],
          fetcher,
        ),
      );
      const context = record(response.context);
      if (!Number.isSafeInteger(context.slot) || (context.slot as number) <= 0)
        throw new Error("Invalid proof slot.");
      let balance = 0n;
      for (const item of boundedArray(response.value, 100)) {
        const account = record(record(item).account),
          parsed = record(record(account.data).parsed),
          info = record(parsed.info),
          amount = record(info.tokenAmount);
        if (
          account.owner !== mint.tokenProgram ||
          parsed.type !== "account" ||
          info.owner !== wallet ||
          info.mint !== COMMERCE_MINT ||
          amount.decimals !== mint.decimals ||
          typeof amount.amount !== "string" ||
          !["initialized", "frozen"].includes(String(info.state))
        )
          throw new Error("Unverified holder account.");
        if (info.state === "initialized") balance += unsignedRaw(amount.amount);
      }
      unsignedRaw(String(balance));
      slot = context.slot as number;
      eligible = balance > 0n;
    } catch {
      /* No public badge on provider failure. No raw balances leave the server. */
    }
    return await ctx.runMutation(internal.forumCommunity.saveSupporterProof, {
      wallet,
      eligible,
      slot,
    });
  },
});
