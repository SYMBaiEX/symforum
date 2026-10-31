// Invented, fixed-time readings only; no provider, wallet or financial client.
import { useEffect, useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { TerminalMarket } from "../../../lib/forum-terminal-model";
import type { ChartMarketData } from "../../../components/trading/price-chart-data";
export const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const mintB = "So11111111111111111111111111111111111111112";
export const now = Date.parse("2026-10-31T12:00:00.000Z");
export const originalAt = now - 7200000;
export const checkedAt = now - 60000;
export const reads: string[] = [];
export const forbidden: string[] = [];
const scenario = new URLSearchParams(location.search).get("scenario");
const originalSourceUrl = new URLSearchParams(location.search).has(
  "long-source",
)
  ? `https://indexed.example.test/original/${"historic-holder-snapshot-".repeat(10)}`
  : "https://indexed.example.test/original";
const listeners = new Set<() => void>();
let selection = mintA;
export function select(mint: string) {
  selection = mint;
  listeners.forEach((listener) => listener());
}
export function useSelection() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => selection,
  );
}
export function useQuery(
  ref: FunctionReference<"query">,
  args: { mint: string },
): TerminalMarket | null | undefined {
  const name = getFunctionName(ref);
  if (name !== "forumTerminal:getMarket") {
    forbidden.push(name);
    throw new Error(`Forbidden fixture query ${name}`);
  }
  if (!reads.includes(args.mint)) reads.push(args.mint);
  if (scenario === "missing") return null;
  if (scenario === "loading") return undefined;
  const zero = scenario === "zero";
  return {
    mint: args.mint,
    symbol: "SAME",
    name: "Invented duplicate symbol",
    platform: "pumpfun",
    observedAt: originalAt,
    metricsAsOf: scenario === "invalid-time" ? NaN : originalAt,
    priceUsd: zero ? 0 : args.mint === mintB ? 0.25 : 0.000000000123456789,
    marketCapUsd: zero ? 0 : null,
    fdvUsd: zero ? 0 : 1234567.89,
    liquidityUsd: zero ? 0 : 12345.6789,
    volume1hUsd: zero ? 0 : 765.4321,
    volume24hUsd: zero ? 0 : 54321.1234,
    holders: zero ? 0 : 1234,
    priceChange1hPercent: zero ? 0 : -0.00123456789,
    imageUrl: null,
    website: null,
    twitter: null,
    telegram: null,
    description: null,
    sourceUrl: originalSourceUrl,
    sourceRank: null,
    threadId: null,
    threadUrl: null,
    ...(scenario === "overlay" || scenario === "unavailable"
      ? {
          marketData: {
            state:
              scenario === "unavailable"
                ? ("unavailable" as const)
                : ("available" as const),
            checkedAt,
            sourceUrl: "https://refreshed.example.test/pool",
          },
          ...(scenario === "unavailable"
            ? {
                priceUsd: null,
                marketCapUsd: null,
                fdvUsd: null,
                liquidityUsd: null,
                volume1hUsd: null,
                volume24hUsd: null,
                priceChange1hPercent: null,
              }
            : {}),
        }
      : {}),
  };
}
export function useAction(ref: FunctionReference<"action">) {
  return async () => {
    const name = getFunctionName(ref);
    forbidden.push(name);
    throw new Error(`Forbidden fixture action ${name}`);
  };
}
export function usePathname() {
  return "/trade";
}
// Only the already-existing child callback is exercised. No transport is present.
export function TokenPriceChart({
  mint,
  onMarket,
}: {
  mint: string;
  onMarket?: (data: ChartMarketData) => void;
}) {
  useEffect(() => {
    if (
      (scenario === "chart" || scenario === "chart-missing") &&
      mint === mintA
    )
      onMarket?.({
        mint,
        checkedAt,
        stale: false,
        priceUsd: 0.000000000987654321,
        stats:
          scenario === "chart-missing"
            ? null
            : {
                marketCap: null,
                fdv: 9876543.21,
                liquidity: 45678.1234,
                volume24h: 87654.321,
              },
      });
  }, [mint, onMarket]);
  return (
    <div aria-label="Inert chart callback fixture" style={{ minHeight: 200 }}>
      Chart transport denied
    </div>
  );
}
