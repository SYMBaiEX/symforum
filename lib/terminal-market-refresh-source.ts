import { isSolanaAddress, record } from "./forum-commerce";
import type { TerminalMarket } from "./forum-terminal-model";
import { parseMarketStats } from "./symf-market-overview";
import { marketPrice, selectMarketBinding } from "./terminal-market-source";

export const MARKET_REFRESH_WINDOW_MS = 10 * 60_000;
export const MARKET_REFRESH_MAX_MINTS = 30;

export type RefreshedMarket = {
  mint: string;
  checkedAt: number;
  state: "available" | "unavailable";
  sourceUrl: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume1hUsd: number | null;
  volume24hUsd: number | null;
  priceChange1hPercent: number | null;
};

function metric(value: unknown, signed = false): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    (signed || value >= 0)
    ? value
    : null;
}

export function marketRefreshUrl(mints: readonly string[]) {
  if (
    mints.length < 1 ||
    mints.length > MARKET_REFRESH_MAX_MINTS ||
    new Set(mints).size !== mints.length ||
    mints.some((mint) => !isSolanaAddress(mint))
  )
    throw Error("invalid_market_cohort");
  return `https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`;
}

/** Missing or unbound tokens stay unavailable, not refreshed stale prices. */
export function parseMarketRefresh(
  value: unknown,
  mints: readonly string[],
  checkedAt: number,
): RefreshedMarket[] {
  marketRefreshUrl(mints);
  if (
    !Array.isArray(value) ||
    value.length > 3_000 ||
    !Number.isSafeInteger(checkedAt) ||
    checkedAt <= 0
  )
    throw Error("invalid_market_batch");
  return mints.map((mint) => {
    const unavailable: RefreshedMarket = {
      mint,
      checkedAt,
      state: "unavailable",
      sourceUrl: null,
      priceUsd: null,
      marketCapUsd: null,
      fdvUsd: null,
      liquidityUsd: null,
      volume1hUsd: null,
      volume24hUsd: null,
      priceChange1hPercent: null,
    };
    // Filter BEFORE the existing per-token <=100-pool binding guard. A batch
    // can contain other requested tokens without weakening that local bound.
    const pairs = value.filter((entry) => {
      const pair = record(entry);
      return (
        pair.chainId === "solana" && record(pair.baseToken).address === mint
      );
    });
    try {
      const binding = selectMarketBinding(pairs, mint);
      const bound = pairs.filter((entry) => {
        const pair = record(entry);
        return (
          pair.pairAddress === binding.pool &&
          record(pair.quoteToken).address === binding.quote
        );
      });
      // Conflicting duplicate pool identities are not an independent quote.
      if (bound.length !== 1) return unavailable;
      const priceUsd = marketPrice(bound, binding);
      if (priceUsd === null) return unavailable;
      const stats = parseMarketStats(bound, binding);
      const pair = record(bound[0]);
      return {
        mint,
        checkedAt,
        state: "available" as const,
        sourceUrl: `https://dexscreener.com/solana/${binding.pool}`,
        priceUsd,
        marketCapUsd:
          stats.marketCap && stats.marketCap > 0 ? stats.marketCap : null,
        fdvUsd: stats.fdv,
        liquidityUsd: stats.liquidity,
        volume1hUsd: metric(record(pair.volume).h1),
        volume24hUsd: stats.volume24h,
        priceChange1hPercent: metric(record(pair.priceChange).h1, true),
      };
    } catch {
      return unavailable;
    }
  });
}

/** Refreshes display fields only. Scout evidence and holder time never move. */
export function withRefreshedMarket(
  market: TerminalMarket,
  quote: RefreshedMarket | undefined,
  now: number,
): TerminalMarket {
  if (
    !quote ||
    quote.mint !== market.mint ||
    !Number.isSafeInteger(quote.checkedAt) ||
    quote.checkedAt <= 0 ||
    quote.checkedAt < market.metricsAsOf ||
    quote.checkedAt > now + 60_000 ||
    now - quote.checkedAt > 24 * 3_600_000
  )
    return market;
  return {
    ...market,
    priceUsd: quote.priceUsd,
    marketCapUsd: quote.marketCapUsd,
    fdvUsd: quote.fdvUsd,
    liquidityUsd: quote.liquidityUsd,
    volume1hUsd: quote.volume1hUsd,
    volume24hUsd: quote.volume24hUsd,
    priceChange1hPercent: quote.priceChange1hPercent,
    marketData: {
      state: quote.state,
      checkedAt: quote.checkedAt,
      sourceUrl: quote.sourceUrl,
    },
  };
}
