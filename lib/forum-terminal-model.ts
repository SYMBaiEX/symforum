import type { MarketCapBand } from "./forum-market-cap";

export type TerminalPlatform = "bags" | "pumpfun" | "other";
export type TerminalMarketData = {
  state: "available" | "unavailable";
  checkedAt: number;
  sourceUrl: string | null;
};
export type TerminalMarket = {
  mint: string;
  name: string;
  symbol: string;
  platform: TerminalPlatform;
  observedAt: number;
  metricsAsOf: number;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume1hUsd: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  priceChange1hPercent: number | null;
  imageUrl: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  description: string | null;
  sourceUrl: string;
  sourceRank: number | null;
  threadId: string | null;
  threadUrl: string | null;
  /** Display-only market fields. Holders and scout evidence retain metricsAsOf. */
  marketData?: TerminalMarketData;
};

export type TerminalMarketRefreshResult = {
  state: "ready" | "loading" | "budget" | "unavailable";
  checkedAt: number | null;
  nextRefreshAt: number | null;
};

export type TerminalMarketList = {
  markets: TerminalMarket[];
  band: MarketCapBand;
  coverage: "sampled";
  sampledAt: number | null;
  stale: boolean;
};

export type TerminalWalletReadState = {
  wallet: string;
  checkedAt: number;
  expiresAt: number;
  slot: number | null;
  balances: { mint: string; rawAmount: string; decimals: number }[];
  /** Null means no reliable Max value is available. Preparation rechecks it. */
  maxSolRaw: string | null;
  feeReserveLamports: string | null;
};

export type TerminalCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};
