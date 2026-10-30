import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  env,
  internalMutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import {
  commerceConfig,
  isSolanaAddress,
  unsignedRaw,
} from "../lib/forum-commerce";
import { SYMF_TOKEN } from "../lib/symf-token";

/** Same transaction as verified payment receipt. This never verifies/sends a payment. */
export async function recordTerminalPromotionReceipt(
  ctx: MutationCtx,
  row: Doc<"forumPromotionIntents">,
  verifiedAt: number,
) {
  if (
    !row.signature ||
    !isSolanaAddress(row.mint) ||
    !isSolanaAddress(row.treasury) ||
    !Number.isSafeInteger(row.decimals) ||
    row.decimals < 0 ||
    row.decimals > 18 ||
    !Number.isSafeInteger(verifiedAt) ||
    verifiedAt <= 0
  )
    throw new Error("Invalid verified promotion receipt.");
  const old = await ctx.db
    .query("forumTerminalPromotionReceipts")
    .withIndex("by_intentId", (q) => q.eq("intentId", row._id))
    .unique();
  if (old) return;
  const amount = unsignedRaw(row.amountRaw),
    treasury = unsignedRaw(row.treasuryAmountRaw),
    burn = unsignedRaw(row.burnAmountRaw);
  if (amount !== treasury + burn)
    throw new Error("Receipt amount binding failed.");
  await ctx.db.insert("forumTerminalPromotionReceipts", {
    intentId: row._id,
    mint: row.mint,
    treasury: row.treasury,
    decimals: row.decimals,
    signature: row.signature,
    amountRaw: String(amount),
    treasuryAmountRaw: String(treasury),
    burnAmountRaw: String(burn),
    verifiedAt,
  });
  const total = await ctx.db
    .query("forumTerminalTreasuryTotals")
    .withIndex("by_mint_and_treasury", (q) =>
      q.eq("mint", row.mint).eq("treasury", row.treasury),
    )
    .unique();
  const values = {
    mint: row.mint,
    treasury: row.treasury,
    decimals: row.decimals,
    amountRaw: String(BigInt(total?.amountRaw ?? "0") + amount),
    treasuryAmountRaw: String(
      BigInt(total?.treasuryAmountRaw ?? "0") + treasury,
    ),
    burnAmountRaw: String(BigInt(total?.burnAmountRaw ?? "0") + burn),
    count: (total?.count ?? 0) + 1,
    latestVerifiedAt: Math.max(total?.latestVerifiedAt ?? 0, verifiedAt),
  };
  if (total && total.decimals !== row.decimals)
    throw new Error("Receipt decimals changed.");
  if (total)
    await ctx.db.patch("forumTerminalTreasuryTotals", total._id, values);
  else await ctx.db.insert("forumTerminalTreasuryTotals", values);
}

/** Explicit operator backfill, one bounded page. No scheduler, RPC, status or hold changes. */
export const backfillPromotionReceipts = internalMutation({
  args: {},
  returns: v.object({ processed: v.number(), complete: v.boolean() }),
  handler: async (ctx) => {
    const state = await ctx.db
      .query("forumTerminalProjection")
      .withIndex("by_key", (q) => q.eq("key", "promotions"))
      .unique();
    if (state?.complete) return { processed: 0, complete: true };
    const page = await ctx.db
      .query("forumPromotionIntents")
      .withIndex("by_creation_time")
      .paginate({ numItems: 50, cursor: state?.cursor ?? null });
    for (const row of page.page) {
      if (row.verifiedAt && row.signature)
        await recordTerminalPromotionReceipt(ctx, row, row.verifiedAt);
    }
    const patch = {
      key: "promotions" as const,
      complete: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
      updatedAt: Date.now(),
    };
    if (state) await ctx.db.patch("forumTerminalProjection", state._id, patch);
    else await ctx.db.insert("forumTerminalProjection", patch);
    return { processed: page.page.length, complete: page.isDone };
  },
});

export const getTransparency = query({
  args: {},
  returns: v.object({
    mint: v.string(),
    decimals: v.number(),
    treasury: v.union(v.string(), v.null()),
    promotionAmountRaw: v.string(),
    treasuryAmountRaw: v.string(),
    burnAmountRaw: v.string(),
    verifiedPromotions: v.number(),
    latestVerifiedAt: v.union(v.number(), v.null()),
    historyComplete: v.boolean(),
    coverage: v.literal("verified-promotion-receipts"),
    receipts: v.array(
      v.object({
        signature: v.string(),
        amountRaw: v.string(),
        treasuryAmountRaw: v.string(),
        burnAmountRaw: v.string(),
        verifiedAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const config = commerceConfig(env),
      mint = SYMF_TOKEN.mint,
      treasury = config.treasury;
    const total = treasury
      ? await ctx.db
          .query("forumTerminalTreasuryTotals")
          .withIndex("by_mint_and_treasury", (q) =>
            q.eq("mint", mint).eq("treasury", treasury),
          )
          .unique()
      : null;
    const receipts = treasury
      ? await ctx.db
          .query("forumTerminalPromotionReceipts")
          .withIndex("by_mint_and_treasury_and_verifiedAt", (q) =>
            q.eq("mint", mint).eq("treasury", treasury),
          )
          .order("desc")
          .take(20)
      : [];
    const state = await ctx.db
      .query("forumTerminalProjection")
      .withIndex("by_key", (q) => q.eq("key", "promotions"))
      .unique();
    return {
      mint,
      decimals: total?.decimals ?? SYMF_TOKEN.decimals,
      treasury,
      promotionAmountRaw: total?.amountRaw ?? "0",
      treasuryAmountRaw: total?.treasuryAmountRaw ?? "0",
      burnAmountRaw: total?.burnAmountRaw ?? "0",
      verifiedPromotions: total?.count ?? 0,
      latestVerifiedAt: total?.latestVerifiedAt ?? null,
      historyComplete: state?.complete ?? false,
      coverage: "verified-promotion-receipts" as const,
      receipts: receipts.map((row) => ({
        signature: row.signature,
        amountRaw: row.amountRaw,
        treasuryAmountRaw: row.treasuryAmountRaw,
        burnAmountRaw: row.burnAmountRaw,
        verifiedAt: row.verifiedAt,
      })),
    };
  },
});
