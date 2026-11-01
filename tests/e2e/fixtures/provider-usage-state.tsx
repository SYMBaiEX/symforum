// Invented fixed counters only. All other queries/mutations/actions are denied.
import { useCallback } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import {
  providerLedgerRequests,
  providerUsageSnapshot,
} from "../../../lib/provider-usage-model";
const at = Date.parse("2026-11-01T12:00:00Z");
const raw = providerLedgerRequests(at).map((request) => ({
  value: request.config.capacity,
  ts: 0,
}));
raw[0] = { value: 0, ts: at };
raw[2] = { value: 0, ts: at };
const sample = providerUsageSnapshot(at, raw);
export const state = {
  calls: [] as string[],
  forbidden: [] as string[],
  mode: new URLSearchParams(location.search).get("scenario") ?? "",
  pending: [] as {
    resolve(value: typeof sample): void;
    reject(reason: Error): void;
  }[],
};
export const controls = {
  state,
  resolve: () => state.pending.shift()?.resolve(sample),
  reject: () =>
    state.pending
      .shift()
      ?.reject(new Error("INERT private provider body must stay hidden")),
  setMode: (mode: string) => {
    state.mode = mode;
  },
  mount: () => {},
  unmount: () => {},
};
Object.assign(window, { __providerUsage: controls });
export function useAction(reference: FunctionReference<"action">) {
  const name = getFunctionName(reference);
  return useCallback(async () => {
    if (name !== "forumProviderUsage:snapshot") {
      state.forbidden.push(name);
      throw Error("Forbidden fixture action");
    }
    state.calls.push(name);
    if (state.mode === "error")
      throw Error("INERT private provider body must stay hidden");
    if (state.mode === "deferred")
      return new Promise<typeof sample>((resolve, reject) =>
        state.pending.push({ resolve, reject }),
      );
    if (state.mode === "partial")
      return providerUsageSnapshot(
        at,
        raw.map((value, index) => (index === 0 ? null : value)),
      );
    if (state.mode === "empty")
      return providerUsageSnapshot(
        at,
        providerLedgerRequests(at).map((request) => ({
          ts: 0,
          value: request.config.capacity,
        })),
      );
    return sample;
  }, [name]);
}
export function useQuery() {
  state.forbidden.push("query");
  throw Error("Forbidden fixture query");
}
export function useMutation() {
  state.forbidden.push("mutation");
  throw Error("Forbidden fixture mutation");
}
