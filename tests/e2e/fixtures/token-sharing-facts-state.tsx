// Invented fixed-time records only. No provider/wallet/financial client is present.
import { useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { TerminalMarket } from "../../../lib/forum-terminal-model";
import type { TokenRisk } from "../../../components/trading/terminal-api";
import { SYMF_TOKEN } from "../../../lib/symf-token";
export const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const mintB = "So11111111111111111111111111111111111111112";
export const program = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const symfMint = SYMF_TOKEN.mint;
export const now = Date.parse("2026-10-31T13:00:00.000Z");
export const reads: { name: string; mint: string }[] = [];
export const forbidden: string[] = [];
const params = new URLSearchParams(location.search);
const scenario = params.get("scenario");
const listeners = new Set<() => void>();
let snapshot = {
  mint: mintA,
  path: "/forum/crypto/recorded-discussion#post-2" as string | null,
  mounted: true,
};
function change(patch: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}
export const select = (mint: string) => change({ mint });
export const setPath = (path: string | null) => change({ path });
export const setMounted = (mounted: boolean) => change({ mounted });
export function useFixtureState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
  );
}
export function useQuery(
  ref: FunctionReference<"query">,
  args: { mint: string },
): TerminalMarket | TokenRisk | null | undefined {
  const name = getFunctionName(ref);
  if (!reads.some((read) => read.name === name && read.mint === args.mint))
    reads.push({ name, mint: args.mint });
  if (name === "forumTerminal:getMarket")
    return {
      mint: args.mint,
      symbol: "SAME",
      name: "Invented duplicate symbol",
      platform: "pumpfun",
      observedAt: now - 7200000,
      metricsAsOf: now - 7200000,
      priceUsd: 0.000000000123456789,
      marketCapUsd: null,
      fdvUsd: 1234567.89,
      liquidityUsd: 12345.6789,
      volume1hUsd: 765.4321,
      volume24hUsd: 54321.1234,
      holders: 1234,
      priceChange1hPercent: -0.00123456789,
      imageUrl: null,
      website: null,
      twitter: null,
      telegram: null,
      description: null,
      sourceUrl: "https://source.example.test/not-a-discussion",
      sourceRank: null,
      threadId: null,
      threadUrl: snapshot.path,
    };
  if (name === "forumTerminal:getRisk") {
    if (scenario === "loading") return undefined;
    if (scenario === "missing") return null;
    return {
      mint: args.mint,
      checkedAt: scenario === "fresh" ? now - 60000 : now - 7200000,
      mintAuthority:
        scenario === "null" ? null : args.mint === mintA ? mintA : mintB,
      freezeAuthority:
        scenario === "null" ? null : args.mint === mintA ? mintB : mintA,
      tokenProgram: program,
      unsupportedExtensions: [],
      status: "checked",
    };
  }
  forbidden.push(name);
  throw new Error(`Forbidden fixture query ${name}`);
}
export function useAction(ref: FunctionReference<"action">) {
  return async () => {
    const name = getFunctionName(ref);
    forbidden.push(name);
    throw new Error(`Forbidden fixture action ${name}`);
  };
}
export function usePathname() {
  return params.has("native") ? "/trade" : "/forum/trade";
}
export function TokenPriceChart() {
  return (
    <div aria-label="Inert chart fixture" style={{ minHeight: 200 }}>
      Chart transport denied
    </div>
  );
}
