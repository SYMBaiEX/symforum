import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import {
  useQuery as useBaseQuery,
  useConvexAuth as useBaseAuth,
} from "./terminal-convex";
import type { TokenAlert } from "../../../components/trading/terminal-api";
export const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const mintB = "EPjFWdd5aufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const params = new URLSearchParams(location.search);
const listeners = new Set<() => void>();
let revision = 0,
  signedOut = false;
const seed: TokenAlert[] = [
  {
    id: "unread-above",
    mint: mintA,
    symbol: "DUP",
    direction: "above",
    thresholdUsd: 1,
    priceUsd: 2,
    observedAt: Date.now() - 1000,
    acknowledged: false,
  },
  {
    id: "unread-below",
    mint: mintB,
    symbol: "DUP",
    direction: "below",
    thresholdUsd: 1,
    priceUsd: 0.5,
    observedAt: Date.now() - 2000,
    acknowledged: false,
  },
  {
    id: "read-above",
    mint: mintA,
    symbol: "DUP",
    direction: "above",
    thresholdUsd: 3,
    priceUsd: 4,
    observedAt: Date.now() - 3000,
    acknowledged: true,
  },
  {
    id: "read-below",
    mint: mintB,
    symbol: "DUP",
    direction: "below",
    thresholdUsd: 3,
    priceUsd: 2,
    observedAt: Date.now() - 4000,
    acknowledged: true,
  },
];
let rows: TokenAlert[] | undefined = params.has("loading-alerts")
  ? undefined
  : params.has("empty-alerts")
    ? []
    : params.has("read-only-alerts")
      ? seed.filter((row) => row.acknowledged)
      : [...seed];
const subscriptions: string[] = [],
  operations: { name: string; args: unknown }[] = [],
  selected: { mint: string }[] = [];
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const publish = () => {
  revision++;
  listeners.forEach((listener) => listener());
};
export const fixture = {
  subscriptions,
  operations,
  selected,
  load(mode: "mixed" | "empty" | "above" | "read-only") {
    rows =
      mode === "empty"
        ? []
        : mode === "above"
          ? seed.filter((row) => row.direction === "above")
          : mode === "read-only"
            ? seed.filter((row) => row.acknowledged)
            : [...seed];
    publish();
  },
  logout() {
    signedOut = true;
    publish();
  },
};
declare global {
  interface Window {
    alertInboxFixture: typeof fixture;
  }
}
window.alertInboxFixture = fixture;
export function useConvexAuth() {
  const base = useBaseAuth();
  useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );
  return { ...base, isAuthenticated: base.isAuthenticated && !signedOut };
}
export function useQuery<Ref extends FunctionReference<"query">>(
  ref: Ref,
  args: FunctionArgs<Ref> | "skip",
): FunctionReturnType<Ref> | undefined {
  const base = useBaseQuery(ref, args);
  useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );
  const name = getFunctionName(ref),
    key = JSON.stringify([name, args]),
    active = args !== "skip";
  useEffect(() => {
    if (active) subscriptions.push(key);
  }, [key, active]);
  if (args === "skip") return undefined;
  if (name === "forumTerminal:listAlerts")
    return rows as FunctionReturnType<Ref>;
  if (name === "forumTerminal:listWatchlist")
    return [
      {
        mint: "So11111111111111111111111111111111111111112",
        symbol: "SOL",
        priceAboveUsd: 10,
        priceBelowUsd: 5,
        updatedAt: 1,
      },
    ] as FunctionReturnType<Ref>;
  return base;
}
export function useMutation<Ref extends FunctionReference<"mutation">>(
  ref: Ref,
) {
  const name = getFunctionName(ref);
  return useCallback(
    async (args: FunctionArgs<Ref>) => {
      operations.push({ name, args });
      if (name !== "forumTerminal:acknowledgeAlert")
        throw new Error(
          "Inbox fixtures prohibit watch writes, payments and all other operations",
        );
      const id = (args as { id: string }).id;
      rows = rows?.map((row) =>
        row.id === id ? { ...row, acknowledged: true } : row,
      );
      publish();
      return null as FunctionReturnType<Ref>;
    },
    [name],
  );
}
export function useAction<Ref extends FunctionReference<"action">>(ref: Ref) {
  const name = getFunctionName(ref);
  return useCallback(
    async (args: FunctionArgs<Ref>) => {
      operations.push({ name, args });
      throw new Error("Inbox fixtures prohibit provider and wallet actions");
    },
    [name],
  );
}
