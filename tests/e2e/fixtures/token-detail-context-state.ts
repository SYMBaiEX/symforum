// Invented local snapshots only. No wallet/provider client exists in this fixture.
import { useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { TerminalMarket } from "../../../lib/forum-terminal-model";
export const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const mintB = "So11111111111111111111111111111111111111112";
export const now = Date.now();
const listeners = new Set<() => void>();
let selection = mintA;
export const reads: string[] = [];
export const forbidden: string[] = [];
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
const scenario = new URLSearchParams(location.search).get("scenario");
export function useQuery(
  ref: FunctionReference<"query">,
  args: { mint: string },
): TerminalMarket | null {
  const name = getFunctionName(ref);
  if (name !== "forumTerminal:getMarket") {
    forbidden.push(name);
    throw new Error(`Forbidden fixture query ${name}`);
  }
  if (!reads.includes(args.mint)) reads.push(args.mint);
  if (scenario === "missing") return null;
  return {
    mint: args.mint,
    symbol: "SAME",
    name: "Invented duplicate-symbol token",
    platform: "pumpfun",
    observedAt: now - 7200000,
    metricsAsOf: now - 7200000,
    priceUsd: null,
    marketCapUsd: null,
    fdvUsd: 1200000,
    liquidityUsd: 2000,
    volume1hUsd: null,
    volume24hUsd: null,
    holders: 25,
    priceChange1hPercent: null,
    imageUrl: null,
    website:
      scenario === "unsafe"
        ? "javascript:alert(1)"
        : "https://project.example.test",
    twitter:
      scenario === "unsafe"
        ? "https://user:password@social.example.test"
        : "https://social.example.test/project",
    telegram:
      scenario === "unsafe"
        ? "http://chat.example.test"
        : "https://chat.example.test/project",
    description: "Unverified project description",
    sourceUrl: "https://source.example.test/pool",
    sourceRank: null,
    threadId: null,
    threadUrl: null,
  };
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return async () => {
    forbidden.push(name);
    throw new Error(`Forbidden fixture action ${name}`);
  };
}
export function usePathname() {
  return "/trade";
}
