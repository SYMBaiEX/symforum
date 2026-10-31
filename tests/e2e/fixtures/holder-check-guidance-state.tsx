// Inert fixed-time profile fixtures. No wallet, RPC, payment or model client.
import { useCallback, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
const params = new URLSearchParams(location.search),
  mode = params.get("mode") ?? "absent";
const wallet = "11111111111111111111111111111111",
  now = Date.parse("2026-10-31T14:40:00.000Z");
export const queries: { name: string; args: unknown }[] = [],
  operations: string[] = [];
export const client = {} as CommerceWalletClient;
Object.assign(window, { __holderGuidance: { queries, operations } });
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  if (args === "skip") return undefined;
  const name = getFunctionName(ref),
    key = JSON.stringify({ name, args });
  if (!queries.some((query) => JSON.stringify(query) === key))
    queries.push({ name, args });
  if (name === "forumCommunity:listTipRecipients") return [];
  if (name !== "forumCommunity:getMine")
    throw new Error(`Unexpected holder fixture query ${name}`);
  if (mode === "settings-loading") return undefined;
  return {
    userId: "inert-profile-owner",
    recipient: { wallet, accepting: false },
    supporter:
      mode === "absent"
        ? null
        : {
            eligible: mode !== "expired",
            optedIn: mode === "expired",
            proofSlot: 12345,
            checkedAt: now - (mode === "expired" ? 660000 : 60000),
          },
  };
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    operations.push(name);
    throw new Error("All holder fixture actions denied");
  }, [name]);
}
export function useMutation(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    operations.push(name);
    throw new Error("All holder fixture mutations denied");
  }, [name]);
}
export function useCommerceIdentity() {
  const isLoading = mode === "loading",
    isAuthenticated = mode !== "guest" && !isLoading,
    linked = isAuthenticated && mode !== "unlinked";
  return {
    isLoading,
    isAuthenticated,
    linked,
    connected: linked ? { account: { address: wallet } } : null,
    session: { authUserId: "inert-profile-owner" },
  };
}
export function useConvexAuth() {
  const identity = useCommerceIdentity();
  return {
    isAuthenticated: identity.isAuthenticated,
    isLoading: identity.isLoading,
  };
}
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
        operations.push("wallet-connect");
        throw new Error("Wallet connection denied");
      }}
    >
      Inert wallet boundary
    </button>
  );
}
export function usePathname() {
  return "/community";
}
export function useSearchParams() {
  return params;
}
