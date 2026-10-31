// Inert owner-bound records only; no RPC, signer, payment or API transport.
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
import type { TerminalWalletReadState } from "../../../lib/forum-terminal-model";
export const walletA = "EULE1PmLm452j4sfNTn4HrzEWa957Zdf3tZCtmjoaTtF";
export const walletB = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
export const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const mintB = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1V";
const params = new URLSearchParams(location.search);
const listeners = new Set<() => void>();
let snapshot = {
  wallet: walletA,
  mint: mintA,
  auth: params.get("auth") ?? "linked",
  mounted: true,
  host: params.has("native") ? ("plugin" as const) : ("website" as const),
};
export function change(patch: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}
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
type Read = { name: string; args: { wallet: string; selectedMint?: string } };
const reads: Read[] = [],
  queries: { name: string; args: unknown }[] = [],
  forbidden: string[] = [];
const pending: {
  resolve(value: TerminalWalletReadState | null): void;
  reject(error: Error): void;
  settled: boolean;
}[] = [];
export const fixture = {
  change,
  reads,
  queries,
  forbidden,
  settle(
    index: number,
    result: TerminalWalletReadState | null,
    failed = false,
  ) {
    if (!pending[index] || pending[index].settled)
      throw new Error("Invalid fixture settlement");
    pending[index].settled = true;
    if (failed)
      pending[index].reject(new Error("Invented delayed wallet read failure"));
    else pending[index].resolve(result);
  },
};
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(
    (args: Read["args"]) => {
      if (name !== "forumTerminal:getWalletReadState") {
        forbidden.push(name);
        throw new Error(`Forbidden action ${name}`);
      }
      reads.push({ name, args });
      return new Promise<TerminalWalletReadState | null>((resolve, reject) =>
        pending.push({ resolve, reject, settled: false }),
      );
    },
    [name],
  );
}
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  const name = getFunctionName(ref);
  if (!queries.some((query) => query.name === name))
    queries.push({ name, args });
  if (
    [
      "forumTerminal:listWatchlist",
      "forumTerminal:listAlerts",
      "forumSwaps:listMine",
    ].includes(name)
  )
    return [];
  forbidden.push(name);
  throw new Error(`Forbidden query ${name}`);
}
export function useMutation(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref);
  return async () => {
    forbidden.push(name);
    throw new Error(`Forbidden mutation ${name}`);
  };
}
export function useConvexAuth() {
  const state = useFixtureState();
  return {
    isAuthenticated: state.auth !== "guest" && state.auth !== "loading",
    isLoading: state.auth === "loading",
  };
}
export function useCommerceIdentity() {
  const state = useFixtureState(),
    auth = useConvexAuth(),
    linked = auth.isAuthenticated && !auth.isLoading && state.auth === "linked";
  return {
    ...auth,
    linked,
    connected: linked
      ? {
          account: { address: state.wallet },
          supportedTransactionVersions: new Set([0]),
        }
      : null,
    session: { wallets: [], authUserId: "isolated-wallet-reader" },
  };
}
export const client = {
  wallet: {
    getState: () => ({ connected: { account: { address: snapshot.wallet } } }),
  },
} as unknown as CommerceWalletClient;
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function useCommerceWallet() {
  return client;
}
export function CommerceWalletButton() {
  return (
    <button
      type="button"
      onClick={() => {
        forbidden.push("wallet-connect");
        throw new Error("Wallet connection forbidden");
      }}
    >
      Fixture wallet connection unavailable
    </button>
  );
}
export function usePathname() {
  return "/trade";
}
