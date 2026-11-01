import { useCallback, useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type {
  TerminalMarket,
  TerminalMarketList,
} from "../../../lib/forum-terminal-model";
export const now = 1_800_000_000_000;
export const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  mintB = "So11111111111111111111111111111111111111112";
const flags = new URLSearchParams(location.search);
function row(mint: string, symbol: string, volume: number): TerminalMarket {
  return {
    mint,
    name: `Invented ${symbol}`,
    symbol,
    platform: "pumpfun",
    observedAt: now - 3600000,
    metricsAsOf: now - 3600000,
    priceUsd: 1e-25,
    marketCapUsd: 75000,
    fdvUsd: null,
    liquidityUsd: 0,
    volume1hUsd: volume,
    volume24hUsd: null,
    holders: 0,
    priceChange1hPercent: -1e-12,
    imageUrl: null,
    website: null,
    twitter: null,
    telegram: null,
    description: "DO_NOT_EXPORT",
    sourceUrl: `https://www.solanatracker.io/token/${mint}`,
    sourceRank: null,
    threadId: null,
    threadUrl: null,
    marketData: {
      state: "available",
      checkedAt: now - 60000,
      sourceUrl:
        "https://dexscreener.com/solana/pool?not-public=secret#fragment",
    },
  };
}
let rows = [row(mintA, "AAA", 10), row(mintB, "BBB", 20)];
let mode = flags.get("mode") ?? "ready",
  mounted = true,
  version = 0;
const listeners = new Set<() => void>();
function update() {
  version++;
  listeners.forEach((listener) => listener());
}
export function useFixture() {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => version,
  );
  return { mounted };
}
export const queries: Record<string, unknown>[] = [],
  actions: string[] = [],
  forbidden: string[] = [];
Object.assign(window, {
  __marketExport: {
    queries,
    actions,
    forbidden,
    replace() {
      rows = [{ ...rows[0], symbol: "NEW", priceUsd: 9 }];
      update();
    },
    empty() {
      rows = [];
      update();
    },
    unknown() {
      rows = rows.map((row) => ({
        ...row,
        priceUsd: null,
        liquidityUsd: null,
        marketCapUsd: null,
        volume1hUsd: null,
        volume24hUsd: null,
        marketData: { state: "unavailable", checkedAt: NaN, sourceUrl: null },
      }));
      update();
    },
    ready() {
      mode = "ready";
      update();
    },
    unmount() {
      mounted = false;
      update();
    },
  },
});
export function useQuery(
  ref: FunctionReference<"query">,
  args: Record<string, unknown>,
): TerminalMarketList | undefined {
  useFixture();
  if (getFunctionName(ref) !== "forumTerminal:listMarket") {
    forbidden.push("query");
    throw Error("Unexpected query");
  }
  if (!queries.some((q) => JSON.stringify(q) === JSON.stringify(args)))
    queries.push(args);
  if (mode === "loading") return undefined;
  return {
    markets: mode === "empty" ? [] : rows,
    band: "all",
    coverage: "sampled",
    sampledAt: now - 3600000,
    stale: true,
  };
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    if (name !== "forumTerminalRefresh:refresh") {
      forbidden.push(name);
      throw Error("Unexpected action");
    }
    actions.push(name);
    return {
      state: "ready",
      checkedAt: now,
      nextRefreshAt: Date.now() + 600000,
    };
  }, [name]);
}
export function useMutation() {
  throw Error("No mutations permitted");
}
