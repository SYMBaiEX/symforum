import { useCallback, useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type {
  TerminalMarket,
  TerminalMarketList,
  TerminalMarketRefreshResult,
} from "../../../lib/forum-terminal-model";
import {
  matchesMarketCap,
  type MarketCapBand,
} from "../../../lib/forum-market-cap";
import type { MarketChoice } from "../../../components/trading/market-identity";
export const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const mintB = "So11111111111111111111111111111111111111112";
export const baseNow = Date.now();
const row = (
  mint: string,
  overrides: Partial<TerminalMarket>,
): TerminalMarket => ({
  mint,
  symbol: "SAME",
  name: "Invented sample token",
  platform: "pumpfun",
  observedAt: baseNow,
  metricsAsOf: baseNow,
  priceUsd: 1,
  marketCapUsd: 25000,
  fdvUsd: null,
  liquidityUsd: null,
  volume1hUsd: null,
  volume24hUsd: null,
  holders: 12,
  priceChange1hPercent: null,
  imageUrl: null,
  website: null,
  twitter: null,
  telegram: null,
  description: null,
  sourceUrl: `https://source.example.test/${mint}`,
  sourceRank: null,
  threadId: null,
  threadUrl: null,
  ...overrides,
});
const rows = [
  row(mintA, {
    metricsAsOf: baseNow - 7200000,
    marketData: {
      checkedAt: baseNow,
      state: "available",
      sourceUrl: `https://pool.example.test/${mintA}`,
    },
  }),
  row(mintB, {
    metricsAsOf: baseNow - 1200000,
    marketCapUsd: 75000,
    platform: "bags",
  }),
  row("11111111111111111111111111111111", {
    marketData: { checkedAt: baseNow, state: "unavailable", sourceUrl: null },
    priceUsd: null,
    marketCapUsd: null,
    platform: "bags",
  }),
  row("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", {
    metricsAsOf: NaN,
    marketCapUsd: 200000,
  }),
  row("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", {
    metricsAsOf: baseNow - 899000,
    marketCapUsd: 35000,
  }),
];
let offset = 0;
let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const state = {
  selected: [] as MarketChoice[],
  queries: [] as Record<string, unknown>[],
  actions: [] as string[],
  nextAt: null as number | null,
  queryLoading: false,
  panel: "visible" as "visible" | "hidden" | "unmounted",
  setPanel(value: "visible" | "hidden" | "unmounted") {
    this.panel = value;
    revision++;
    listeners.forEach((listener) => listener());
  },
  setQueryLoading(value: boolean) {
    this.queryLoading = value;
    revision++;
    listeners.forEach((listener) => listener());
  },
  advance(ms: number) {
    offset += ms;
    listeners.forEach((listener) => listener());
  },
};
Object.assign(window, { __sampleUsability: state });
export function usePanel() {
  return useSyncExternalStore(subscribe, () => state.panel);
}
export function useNow() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => baseNow + offset,
  );
}
export function useQuery(
  ref: FunctionReference<"query">,
  args: { band: MarketCapBand; platform?: string; now: number; limit: number },
): TerminalMarketList | undefined {
  useSyncExternalStore(subscribe, () => revision);
  if (getFunctionName(ref) !== "forumTerminal:listMarket")
    throw new Error("Forbidden fixture query");
  if (
    !state.queries.some((old) => JSON.stringify(old) === JSON.stringify(args))
  )
    state.queries.push(args);
  if (state.queryLoading) return undefined;
  return {
    markets: rows.filter(
      (row) =>
        matchesMarketCap(row.marketCapUsd, args.band) &&
        (!args.platform || row.platform === args.platform),
    ),
    band: args.band,
    coverage: "sampled",
    sampledAt: baseNow,
    stale: false,
  };
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(async (): Promise<TerminalMarketRefreshResult> => {
    state.actions.push(name);
    if (name !== "forumTerminalRefresh:refresh")
      throw new Error("Forbidden fixture action");
    const scenario = new URLSearchParams(location.search).get("scenario");
    const status =
      scenario === "budget" || scenario === "loading" || scenario === "deferred"
        ? scenario
        : "ready";
    state.nextAt =
      scenario === "invalid"
        ? NaN
        : Date.now() +
          (status === "budget"
            ? 86400000
            : status === "deferred"
              ? 30000
              : 600000);
    return { state: status, checkedAt: baseNow, nextRefreshAt: state.nextAt };
  }, [name]);
}
export function useMutation() {
  throw new Error("Forbidden fixture mutation");
}
