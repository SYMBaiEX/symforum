import { useEffect, useSyncExternalStore } from "react";
import { getFunctionName } from "convex/server";
import type { FunctionReference } from "convex/server";
import type { ChartMarketData } from "../../../components/trading/price-chart-data";
export const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const mintB = "So11111111111111111111111111111111111111112";
export const now = Date.parse("2026-10-31T12:00:00Z");
export const reads: string[] = [];
export const forbidden: string[] = [];
const listeners = new Set<() => void>();
let version = 0;
let mint = mintA;
let index: "absent" | "loading" | "present" | "wrong" = "absent";
let snapshot: ChartMarketData = {
  mint: mintA,
  checkedAt: now - 360000,
  stale: true,
  priceUsd: 2,
  stats: { marketCap: 123, liquidity: 456, volume24h: 789, fdv: 999 },
};
const callbacks: ((data: ChartMarketData) => void)[] = [];
export function update(value: {
  mint?: string;
  index?: typeof index;
  snapshot?: ChartMarketData;
}) {
  if (value.mint) mint = value.mint;
  if (value.index) index = value.index;
  if (value.snapshot) snapshot = value.snapshot;
  version++;
  listeners.forEach((fn) => fn());
}
export function late(data: ChartMarketData) {
  callbacks[0]?.(data);
}
export function useFixture() {
  const revision = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => version,
  );
  return { mint, revision };
}
export function useQuery(
  ref: FunctionReference<"query">,
  args: { mint: string },
) {
  if (getFunctionName(ref) !== "forumTerminal:getMarket")
    throw Error("Unexpected query");
  reads.push(args.mint);
  if (index === "loading") return undefined;
  if (index === "absent") return null;
  return {
    mint: index === "wrong" ? mintB : args.mint,
    symbol: "TEST",
    name: "Invented token",
    priceUsd: 8,
    marketCapUsd: 800,
    liquidityUsd: 80,
    volume24hUsd: 88,
    priceChange1hPercent: 1,
    metricsAsOf: now - 60000,
    observedAt: now - 60000,
  };
}
export function useAction(ref: FunctionReference<"action">) {
  return () => {
    forbidden.push(getFunctionName(ref));
    throw Error("No actions permitted");
  };
}
export function usePathname() {
  return "/trade";
}
export function TokenPriceChart({
  onMarket,
}: {
  onMarket?: (data: ChartMarketData) => void;
}) {
  const { revision } = useFixture();
  useEffect(() => {
    if (onMarket) {
      callbacks.push(onMarket);
      onMarket(snapshot);
    }
  }, [onMarket]);
  useEffect(() => {
    onMarket?.(snapshot);
  }, [onMarket, revision]);
  return <div>Inert chart callback — no transport</div>;
}
export function current() {
  return snapshot;
}
