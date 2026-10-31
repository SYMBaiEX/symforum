// Invented private UI records only. No Convex client, wallet, or transport exists.
import { useCallback, useSyncExternalStore } from "react";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import type {
  TokenAlert,
  WatchToken,
} from "../../../components/trading/terminal-api";

export const fixtureMint = "So11111111111111111111111111111111111111112";
let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => revision;
const publish = () => {
  revision++;
  listeners.forEach((listener) => listener());
};
const precise = location.search.includes("precision");
let watches: WatchToken[] = [
  {
    mint: fixtureMint,
    symbol: "SOL",
    priceAboveUsd: precise ? 0.1234567890123456 : 10,
    priceBelowUsd: precise ? 0.0000000123456789 : 5,
    updatedAt: 1,
  },
];
let serverWatches = watches.map((watch) => ({ ...watch }));
let alerts: TokenAlert[] = [
  {
    id: "fixture-alert",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "SAME",
    direction: "above",
    thresholdUsd: 1,
    priceUsd: 2,
    observedAt: 1_800_000_000_000,
    acknowledged: false,
  },
];
type Call = { name: string; args: Record<string, unknown> };
export const editor = {
  calls: [] as Call[],
  selected: [] as { mint: string }[],
  mode: "success" as "success" | "reject" | "defer",
  serverOnlyUpdate: (
    bounds: Partial<Pick<WatchToken, "priceAboveUsd" | "priceBelowUsd">>,
  ) => {
    // Deliberately withhold the query echo to model another tab's newer commit.
    serverWatches = serverWatches.map((watch) =>
      watch.mint === fixtureMint ? { ...watch, ...bounds } : watch,
    );
  },
  settle: (_success: boolean): void => {
    throw new Error("No pending fixture mutation");
  },
};
Object.assign(window, { __watchEditor: editor });

export function useQuery<Ref extends FunctionReference<"query">>(ref: Ref) {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const name = getFunctionName(ref);
  if (name === "forumTerminal:listWatchlist")
    return watches as FunctionReturnType<Ref>;
  if (name === "forumTerminal:listAlerts")
    return alerts as FunctionReturnType<Ref>;
  throw new Error(`Unexpected fixture query: ${name}`);
}

export function useMutation<Ref extends FunctionReference<"mutation">>(
  ref: Ref,
) {
  const name = getFunctionName(ref);
  return useCallback(
    async (args: FunctionArgs<Ref>) => {
      const values = args as Record<string, unknown>;
      editor.calls.push({ name, args: values });
      if (!/^forumTerminal:(setWatchlist|acknowledgeAlert)$/.test(name))
        throw new Error(`Unexpected fixture mutation: ${name}`);
      const finish = () => {
        if (name === "forumTerminal:acknowledgeAlert") {
          alerts = alerts.map((alert) =>
            alert.id === values.id ? { ...alert, acknowledged: true } : alert,
          );
        } else {
          const existing = serverWatches.find(
            (watch) => watch.mint === values.mint,
          );
          const high =
            values.priceAboveUsd === undefined
              ? (existing?.priceAboveUsd ?? null)
              : (values.priceAboveUsd as number | null);
          const low =
            values.priceBelowUsd === undefined
              ? (existing?.priceBelowUsd ?? null)
              : (values.priceBelowUsd as number | null);
          if (
            values.enabled &&
            ([high, low].some(
              (value) =>
                value != null && (!Number.isFinite(value) || value <= 0),
            ) ||
              (high != null && low != null && high <= low))
          )
            throw new Error(
              "Invented server merged-state validation rejection",
            );
          serverWatches = serverWatches.filter(
            (watch) => watch.mint !== values.mint,
          );
          if (values.enabled)
            serverWatches.push({
              mint: String(values.mint),
              symbol: "SOL",
              priceAboveUsd: high,
              priceBelowUsd: low,
              updatedAt: Date.now(),
            });
          watches = serverWatches.map((watch) => ({ ...watch }));
        }
        publish();
      };
      if (editor.mode === "reject")
        throw new Error("Invented fixture rejection");
      if (editor.mode === "defer")
        await new Promise<void>((resolve, reject) => {
          editor.settle = (success) => {
            editor.mode = "success";
            if (success) {
              try {
                finish();
                resolve();
              } catch (error) {
                reject(error);
              }
            } else reject(new Error("Invented fixture rejection"));
          };
        });
      else finish();
      return null as FunctionReturnType<Ref>;
    },
    [name],
  );
}
