import { useEffect } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { TerminalMarketList } from "../../../lib/forum-terminal-model";
export const now = 1_800_000_000_000;
export const evidence = {
  queries: [] as Record<string, unknown>[],
  forbidden: [] as string[],
  selected: [] as string[],
  mounts: 0,
};
declare global {
  interface Window {
    marketPreferences: typeof evidence;
  }
}
window.marketPreferences = evidence;
const sample: TerminalMarketList = {
  band: "all",
  coverage: "sampled",
  sampledAt: now - 60_000,
  stale: false,
  markets: [
    {
      mint: "So11111111111111111111111111111111111111112",
      symbol: "TEST",
      name: "Invented public token",
      platform: "pumpfun",
      observedAt: now - 60_000,
      metricsAsOf: now - 60_000,
      priceUsd: 1,
      marketCapUsd: 75_000,
      liquidityUsd: 10_000,
      fdvUsd: null,
      volume1hUsd: 100,
      volume24hUsd: null,
      holders: null,
      priceChange1hPercent: 0,
      imageUrl: null,
      website: null,
      twitter: null,
      telegram: null,
      description: "Invented public fixture",
      sourceUrl:
        "https://www.solanatracker.io/token/So11111111111111111111111111111111111111112",
      sourceRank: null,
      threadId: null,
      threadUrl: null,
      marketData: {
        state: "available",
        checkedAt: now - 60_000,
        sourceUrl: null,
      },
    },
  ],
};
export function useQuery(
  ref: FunctionReference<"query">,
  args: Record<string, unknown>,
) {
  if (getFunctionName(ref) !== "forumTerminal:listMarket") {
    evidence.forbidden.push("query");
    throw Error("Unexpected read");
  }
  const key = JSON.stringify(args);
  useEffect(() => {
    evidence.queries.push(JSON.parse(key));
  }, [key]);
  return sample;
}
const deny = () => {
  evidence.forbidden.push("action or write");
  throw Error("No financial, provider or write operation allowed");
};
export const useAction = () => deny,
  useMutation = () => deny;
