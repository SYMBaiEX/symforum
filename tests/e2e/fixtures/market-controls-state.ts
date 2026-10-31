// Invented local samples only. Unexpected reads/actions/financial calls fail closed.
import { useCallback } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type {
  TerminalMarket,
  TerminalMarketList,
} from "../../../lib/forum-terminal-model";
import type { MarketChoice } from "../../../components/trading/market-identity";
export const fixtureMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const fixtureNow = 1800000000000;
const market: TerminalMarket = {
  mint: fixtureMint,
  symbol: "SAME",
  name: "Invented token, not live data",
  platform: "pumpfun",
  observedAt: fixtureNow,
  metricsAsOf: fixtureNow,
  priceUsd: null,
  marketCapUsd: 25000,
  fdvUsd: null,
  liquidityUsd: null,
  volume1hUsd: null,
  volume24hUsd: null,
  holders: null,
  priceChange1hPercent: null,
  imageUrl: null,
  website: null,
  twitter: null,
  telegram: null,
  description: null,
  sourceUrl: "",
  sourceRank: null,
  threadId: null,
  threadUrl: null,
};
export const state = {
  selected: [] as MarketChoice[],
  queries: [] as Record<string, unknown>[],
  actions: [] as string[],
};
Object.assign(window, { __marketControls: state });
export function useQuery(
  ref: FunctionReference<"query">,
  args: Record<string, unknown>,
): TerminalMarketList {
  if (getFunctionName(ref) !== "forumTerminal:listMarket")
    throw new Error("Forbidden fixture query");
  if (
    !state.queries.some((old) => JSON.stringify(old) === JSON.stringify(args))
  )
    state.queries.push(args);
  return {
    markets: location.search.includes("empty") ? [] : [market],
    band: "all",
    coverage: "sampled",
    sampledAt: fixtureNow,
    stale: false,
  };
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    state.actions.push(name);
    if (name !== "forumTerminalRefresh:refresh")
      throw new Error(`Forbidden fixture action ${name}`);
    return {
      state: "ready",
      checkedAt: fixtureNow,
      nextRefreshAt: Date.now() + 600000,
    };
  }, [name]);
}
export function useMutation() {
  throw new Error("Forbidden fixture mutation");
}
