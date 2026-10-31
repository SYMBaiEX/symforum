import type { TerminalMarket } from "@/lib/forum-terminal-model";

export type MarketSortKey =
  | "price"
  | "change1h"
  | "marketCap"
  | "liquidity"
  | "volume1h"
  | "volume24h"
  | "holders";
export type MarketSortDirection = "asc" | "desc";

const fields = {
  price: "priceUsd",
  change1h: "priceChange1hPercent",
  marketCap: "marketCapUsd",
  liquidity: "liquidityUsd",
  volume1h: "volume1hUsd",
  volume24h: "volume24hUsd",
  holders: "holders",
} as const;

function sortableValue(market: TerminalMarket, key: MarketSortKey) {
  const value = market[fields[key]];
  return value == null ||
    !Number.isFinite(value) ||
    (key !== "change1h" && value < 0)
    ? null
    : value;
}

/** Sort only the retained sample; an absent value never becomes a zero. */
export function sortMarketRows(
  rows: TerminalMarket[],
  key: MarketSortKey,
  direction: MarketSortDirection,
): TerminalMarket[] {
  return [...rows].sort((left, right) => {
    const a = sortableValue(left, key);
    const b = sortableValue(right, key);
    if (a === null && b !== null) return 1;
    if (a !== null && b === null) return -1;
    if (a !== null && b !== null && a !== b)
      return (a < b ? -1 : 1) * (direction === "asc" ? 1 : -1);
    return left.mint.localeCompare(right.mint, "en-US");
  });
}

const percentage = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const rawNumber = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  maximumSignificantDigits: 21,
});

export function rawMarketNumber(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? undefined
    : rawNumber.format(value);
}

export function formatMarketPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  if (value === 0) return "0.00%";
  const sign = value > 0 ? "+" : "−";
  return Math.abs(value) < 0.01
    ? `${sign}<0.01%`
    : `${sign}${percentage.format(Math.abs(value))}%`;
}

export function marketObservation(timestamp: number, now: number) {
  const valid =
    Number.isFinite(timestamp) &&
    timestamp > 0 &&
    timestamp <= 8_640_000_000_000_000 &&
    Number.isFinite(now) &&
    timestamp <= now + 60_000;
  if (!valid)
    return {
      label: "Unavailable",
      dateTime: null,
      full: "Observation time unavailable",
      stale: true,
    };
  const elapsed = Math.max(0, now - timestamp);
  const label =
    elapsed < 60_000
      ? "Just now"
      : elapsed < 3_600_000
        ? `${Math.floor(elapsed / 60_000)}m ago`
        : elapsed < 86_400_000
          ? `${Math.floor(elapsed / 3_600_000)}h ago`
          : `${Math.floor(elapsed / 86_400_000)}d ago`;
  const date = new Date(timestamp);
  return {
    label,
    dateTime: date.toISOString(),
    full: `Metrics as of ${date.toLocaleString([], { dateStyle: "medium", timeStyle: "long" })}`,
    stale: elapsed > 15 * 60_000,
  };
}

/** Refreshing a pool's market fields never refreshes the holder-count sample. */
export function marketSources(market: TerminalMarket, now: number) {
  return {
    market: marketObservation(
      market.marketData?.checkedAt ?? market.metricsAsOf,
      now,
    ),
    holders: marketObservation(market.metricsAsOf, now),
    sourceUrl: market.marketData
      ? market.marketData.sourceUrl
      : market.sourceUrl,
    refreshed: market.marketData !== undefined,
    unavailable: market.marketData?.state === "unavailable",
  };
}
