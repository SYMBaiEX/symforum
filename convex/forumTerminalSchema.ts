import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  tokenPlatformValidator,
  tokenSnapshotValidator,
} from "./tokenAlphaSchema";

const n = v.union(v.number(), v.null());
const s = v.union(v.string(), v.null());
export const terminalBandValidator = v.union(
  v.literal("all"),
  v.literal("under50k"),
  v.literal("50k100k"),
  v.literal("100k500k"),
  v.literal("500k1m"),
  v.literal("1m10m"),
  v.literal("over10m"),
  v.literal("unknown"),
);
export const terminalMarketValidator = v.object({
  mint: v.string(),
  name: v.string(),
  symbol: v.string(),
  platform: v.union(tokenPlatformValidator, v.literal("other")),
  observedAt: v.number(),
  metricsAsOf: v.number(),
  priceUsd: n,
  marketCapUsd: n,
  fdvUsd: n,
  liquidityUsd: n,
  volume1hUsd: n,
  volume24hUsd: n,
  holders: n,
  priceChange1hPercent: n,
  imageUrl: s,
  website: s,
  twitter: s,
  telegram: s,
  description: s,
  sourceUrl: v.string(),
  sourceRank: n,
  threadId: s,
  threadUrl: s,
});
export const terminalWalletValidator = v.object({
  wallet: v.string(),
  checkedAt: v.number(),
  expiresAt: v.number(),
  slot: n,
  balances: v.array(
    v.object({ mint: v.string(), rawAmount: v.string(), decimals: v.number() }),
  ),
  maxSolRaw: s,
  feeReserveLamports: s,
});
export const terminalRiskValidator = v.object({
  mint: v.string(),
  checkedAt: v.number(),
  mintAuthority: s,
  freezeAuthority: s,
  tokenProgram: v.string(),
  unsupportedExtensions: v.array(v.string()),
  status: v.literal("checked"),
});

export const forumTerminalTables = {
  // A display-only materialized sample. It cannot authorize a swap or token claim.
  forumTerminalMarkets: defineTable({
    mint: v.string(),
    platform: tokenPlatformValidator,
    band: terminalBandValidator,
    observedAt: v.number(),
    snapshot: tokenSnapshotValidator,
  })
    .index("by_mint", ["mint"])
    .index("by_observedAt", ["observedAt"])
    .index("by_band_and_observedAt", ["band", "observedAt"])
    .index("by_platform_and_observedAt", ["platform", "observedAt"])
    .index("by_platform_and_band_and_observedAt", [
      "platform",
      "band",
      "observedAt",
    ]),
  forumTerminalWallets: defineTable({
    wallet: v.string(),
    selection: v.string(),
    lease: v.string(),
    leaseUntil: v.number(),
    nextFetchAt: v.number(),
    state: v.optional(terminalWalletValidator),
  }).index("by_wallet", ["wallet"]),
  forumTerminalRisks: defineTable({
    mint: v.string(),
    lease: v.string(),
    leaseUntil: v.number(),
    nextFetchAt: v.number(),
    risk: v.optional(terminalRiskValidator),
  }).index("by_mint", ["mint"]),
  forumTerminalWatches: defineTable({
    authUserId: v.string(),
    userId: v.id("users"),
    mint: v.string(),
    priceAboveUsd: n,
    priceBelowUsd: n,
    previousPriceUsd: n,
    lastObservedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_authUserId_and_updatedAt", ["authUserId", "updatedAt"])
    .index("by_authUserId_and_mint", ["authUserId", "mint"])
    .index("by_mint", ["mint"]),
  forumTerminalAlerts: defineTable({
    authUserId: v.string(),
    mint: v.string(),
    symbol: s,
    direction: v.union(v.literal("above"), v.literal("below")),
    thresholdUsd: v.number(),
    priceUsd: v.number(),
    observedAt: v.number(),
    acknowledged: v.boolean(),
  })
    .index("by_observedAt", ["observedAt"])
    .index("by_authUserId_and_observedAt", ["authUserId", "observedAt"])
    .index("by_authUserId_and_mint_and_observedAt", [
      "authUserId",
      "mint",
      "observedAt",
    ]),
  forumTerminalPromotionReceipts: defineTable({
    intentId: v.id("forumPromotionIntents"),
    mint: v.string(),
    treasury: v.string(),
    decimals: v.number(),
    signature: v.string(),
    amountRaw: v.string(),
    treasuryAmountRaw: v.string(),
    burnAmountRaw: v.string(),
    verifiedAt: v.number(),
  })
    .index("by_intentId", ["intentId"])
    .index("by_mint_and_treasury_and_verifiedAt", [
      "mint",
      "treasury",
      "verifiedAt",
    ]),
  forumTerminalTreasuryTotals: defineTable({
    mint: v.string(),
    treasury: v.string(),
    decimals: v.number(),
    amountRaw: v.string(),
    treasuryAmountRaw: v.string(),
    burnAmountRaw: v.string(),
    count: v.number(),
    latestVerifiedAt: v.number(),
  }).index("by_mint_and_treasury", ["mint", "treasury"]),
  forumTerminalProjection: defineTable({
    key: v.union(v.literal("promotions"), v.literal("markets")),
    complete: v.boolean(),
    cursor: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
};
