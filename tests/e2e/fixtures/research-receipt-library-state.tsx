import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import {
  RESEARCH_ASSET,
  RESEARCH_NETWORK,
  type ResearchState,
} from "../../../lib/forum-research";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
export const mintA = "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump";
export const mintB = "So11111111111111111111111111111111111111112";
export const at = Date.parse("2026-11-01T12:00:00Z");
const statuses: ResearchState[] = [
  "unknown",
  "verifying",
  "settlement_claimed",
  "fulfilled",
  "quoted",
  "rejected",
  "expired",
];
export const rows = statuses.map((state, index) => ({
  intentKey: (index + 1).toString(16).padStart(64, "0"),
  mint: state === "fulfilled" ? mintB : mintA,
  state,
  createdAt: at - 1000,
  expiresAt: at + 60000,
  signature: [
    "unknown",
    "verifying",
    "settlement_claimed",
    "fulfilled",
  ].includes(state)
    ? "1".repeat(64)
    : null,
  finalizedAt: state === "fulfilled" ? at - 500 : null,
  report: null,
}));
let value = {
  owner: "A" as string | null,
  mint: mintA,
  history: "loaded",
  mounted: true,
};
const listeners = new Set<() => void>();
export function update(patch: Partial<typeof value>) {
  value = { ...value, ...patch };
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useFixture = () => useSyncExternalStore(subscribe, () => value);
export const fixture = {
  update,
  rows,
  reads: [] as { name: string; args: unknown }[],
  forbidden: [] as string[],
};
Object.assign(window, { __researchReceiptLibrary: fixture });
export function useConvexAuth() {
  return { isAuthenticated: !!useFixture().owner, isLoading: false };
}
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  const state = useFixture(),
    name = getFunctionName(ref),
    serialized = JSON.stringify(args);
  useEffect(() => {
    if (serialized !== '"skip"')
      fixture.reads.push({ name, args: JSON.parse(serialized) });
  }, [name, serialized]);
  if (args === "skip") return undefined;
  if (name === "forumResearch:getConfig")
    return {
      enabled: true,
      reason: "ready",
      amountRaw: "100000",
      asset: RESEARCH_ASSET,
      network: RESEARCH_NETWORK,
      product: "solana-token-brief-v1",
      priceLabel: "$0.10 USDC",
    };
  if (
    name !== "forumResearch:listMine" ||
    !state.owner ||
    serialized !== "{}"
  ) {
    fixture.forbidden.push(name);
    throw new Error("Private or unexpected read denied");
  }
  if (state.history === "loading") return undefined;
  if (state.history === "empty") return [];
  return state.owner === "A"
    ? rows
    : [{ ...rows[3], intentKey: "b".repeat(64), mint: mintA }];
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    fixture.forbidden.push(name);
    throw new Error("All quote/check/prepare/settlement actions denied");
  }, [name]);
}
const client = new Proxy(
  {},
  {
    get() {
      fixture.forbidden.push("wallet");
      throw new Error("Wallet methods denied");
    },
  },
) as CommerceWalletClient;
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  const state = useFixture();
  return {
    linked: !!state.owner,
    connected: state.owner
      ? { account: { address: "11111111111111111111111111111111" } }
      : undefined,
    session: state.owner
      ? { authUserId: `fixture-owner-${state.owner}` }
      : null,
  };
}
export function CommerceWalletButton() {
  return <button disabled>Link mock wallet</button>;
}
