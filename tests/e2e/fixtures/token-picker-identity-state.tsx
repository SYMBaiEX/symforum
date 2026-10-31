// Inert public-token callbacks only. No client, RPC, signer or payment exists.
import { useCallback } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { TradeToken } from "../../../components/swap/token-swap";
export const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const mintB = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1V";
export const wallet = "11111111111111111111111111111111";
export const listed: TradeToken = {
  mint: "So11111111111111111111111111111111111111112",
  symbol: "SOL",
  name: "Listed fixture token",
  decimals: 9,
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
};
export const candidate = (
  mint: string,
  name = "Duplicate fixture token",
): TradeToken => ({
  mint,
  symbol: "DUP",
  name,
  decimals: 6,
  tokenProgram: listed.tokenProgram,
  icon: null,
  verified: false,
});
const pending = new Map<
  number,
  { resolve(value: unknown): void; reject(reason: Error): void }
>();
export const state = {
  calls: [] as { name: string; args: Record<string, unknown> }[],
  selected: [] as TradeToken[],
  forbidden: [] as string[],
  settle(index: number, success: boolean, rows?: unknown) {
    const callback = pending.get(index);
    if (!callback) throw new Error("Unknown fixture callback");
    pending.delete(index);
    if (success) callback.resolve(rows ?? []);
    else callback.reject(new Error("PRIVATE_PROVIDER_FIXTURE_ERROR"));
  },
};
Object.assign(window, { __pickerIdentity: state });
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(
    (args: Record<string, unknown>) => {
      if (
        name !== "forumTokenDiscovery:search" &&
        name !== "forumCommerce:resolveMint"
      ) {
        state.forbidden.push(name);
        throw new Error("Forbidden fixture action");
      }
      const index = state.calls.push({ name, args }) - 1;
      return new Promise((resolve, reject) =>
        pending.set(index, { resolve, reject }),
      );
    },
    [name],
  );
}
export function useQuery() {
  state.forbidden.push("query");
  throw new Error("Forbidden fixture query");
}
export function useMutation() {
  state.forbidden.push("mutation");
  throw new Error("Forbidden fixture mutation");
}
