import { makeFunctionReference } from "convex/server";
import type { MarketCapBand } from "@/lib/forum-market-cap";
import type {
  TerminalMarket,
  TerminalMarketList,
  TerminalWalletReadState,
} from "@/lib/forum-terminal-model";

// Explicit public contracts keep the standalone UI worktree type-safe until the
// integrated schema/codegen adds these modules to the generated API map.
export const terminalApi = {
  listMarket: makeFunctionReference<
    "query",
    {
      band?: MarketCapBand;
      platform?: "bags" | "pumpfun";
      now: number;
      limit?: number;
    },
    TerminalMarketList
  >("forumTerminal:listMarket"),
  getMarket: makeFunctionReference<
    "query",
    { mint: string; now: number },
    TerminalMarket | null
  >("forumTerminal:getMarket"),
  getWalletReadState: makeFunctionReference<
    "action",
    { wallet: string; selectedMint?: string },
    TerminalWalletReadState | null
  >("forumTerminal:getWalletReadState"),
  getRisk: makeFunctionReference<"query", { mint: string }, TokenRisk | null>(
    "forumTerminal:getRisk",
  ),
  refreshRisk: makeFunctionReference<
    "action",
    { wallet: string; mint: string },
    TokenRisk | null
  >("forumTerminal:refreshRisk"),
  listWatchlist: makeFunctionReference<
    "query",
    Record<string, never>,
    WatchToken[]
  >("forumTerminal:listWatchlist"),
  setWatchlist: makeFunctionReference<
    "mutation",
    {
      mint: string;
      enabled: boolean;
      priceAboveUsd?: number | null;
      priceBelowUsd?: number | null;
    },
    null
  >("forumTerminal:setWatchlist"),
  listAlerts: makeFunctionReference<
    "query",
    Record<string, never>,
    TokenAlert[]
  >("forumTerminal:listAlerts"),
  acknowledgeAlert: makeFunctionReference<"mutation", { id: string }, null>(
    "forumTerminal:acknowledgeAlert",
  ),
  getTransparency: makeFunctionReference<
    "query",
    Record<string, never>,
    PromotionTransparency
  >("forumTerminalTransparency:getTransparency"),
};

export type TokenRisk = {
  mint: string;
  checkedAt: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  tokenProgram: string;
  unsupportedExtensions: string[];
  status: "checked";
};
export type WatchToken = {
  mint: string;
  symbol: string | null;
  priceAboveUsd: number | null;
  priceBelowUsd: number | null;
  updatedAt: number;
};
export type TokenAlert = {
  id: string;
  mint: string;
  symbol: string | null;
  direction: "above" | "below";
  thresholdUsd: number;
  priceUsd: number;
  observedAt: number;
  acknowledged: boolean;
};
export type PromotionTransparency = {
  mint: string;
  decimals: number;
  treasury: string | null;
  promotionAmountRaw: string;
  treasuryAmountRaw: string;
  burnAmountRaw: string;
  verifiedPromotions: number;
  latestVerifiedAt: number | null;
  receipts: {
    signature: string;
    amountRaw: string;
    treasuryAmountRaw: string;
    burnAmountRaw: string;
    verifiedAt: number;
  }[];
  coverage: "verified-promotion-receipts";
  historyComplete: boolean;
};
