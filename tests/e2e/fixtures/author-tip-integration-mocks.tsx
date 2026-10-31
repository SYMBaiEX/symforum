import { useState, useSyncExternalStore, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
const parameters = new URLSearchParams(location.search);
const recipientWallet = "22222222222222222222222222222222";
const payerWallet = "11111111111111111111111111111111";
let resolved = !parameters.has("loading"),
  revision = 0;
const listeners = new Set<() => void>();
const queries: { name: string; args: unknown }[] = [],
  operations: { name: string; args: unknown }[] = [];
Object.assign(window, {
  authorTipQueries: queries,
  authorTipOperations: operations,
});
window.addEventListener("author-tip:resolve", () => {
  resolved = true;
  revision++;
  listeners.forEach((listener) => listener());
});
export function useQuery(reference: FunctionReference<"query">, args: unknown) {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => revision,
    () => revision,
  );
  if (args === "skip") return undefined;
  const name = getFunctionName(reference);
  queries.push({ name, args });
  if (name === "forumCommunity:getThreadRecipient") {
    if (parameters.has("error"))
      throw new Error(
        "Fixture recipient lookup failed; private details must not render.",
      );
    if (!resolved) return undefined;
    if (
      parameters.has("optout") ||
      parameters.has("private") ||
      (args as { threadId: string }).threadId !== "public-thread-one"
    )
      return null;
    // Presentation trusts this public query's opt-in result. The agent-author
    // variant does not assert that agents can enable tips through commerceActor.
    return {
      userId: "actual-thread-author",
      username: parameters.has("agentauthor")
        ? "public_agent_author"
        : "public_thread_author",
      wallet: recipientWallet,
    };
  }
  if (name === "forumCommerce:resolveThreadTokens")
    return parameters.has("mapped")
      ? [
          {
            mint: "So11111111111111111111111111111111111111112",
            name: "Invented mapped token",
            symbol: "FIX",
            decimals: 9,
            tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          },
        ]
      : [];
  if (name === "forumCommerce:getThreadMint")
    return parameters.has("unverified")
      ? "So11111111111111111111111111111111111111112"
      : null;
  if (name === "forumCommerce:getConfig")
    return {
      promotionsEnabled: true,
      swapsEnabled: false,
      signatureFirstEnabled: true,
      promotionAmountRaw: "10000000000",
    };
  if (
    name === "forumCommerce:searchTokens" ||
    name === "forumSwaps:listMine" ||
    name === "forumPromotions:listMine"
  )
    return [];
  throw new Error(`Unexpected author-tip query: ${name}`);
}
export function useConvexAuth() {
  return {
    isAuthenticated: !parameters.has("guest") && !parameters.has("agentviewer"),
    isLoading: false,
  };
}
function denied(name: string, args: unknown) {
  operations.push({ name, args });
  throw new Error(
    "Fixture forbids payment, signing, provider and delivery operations",
  );
}
export function useMutation(reference: FunctionReference<"mutation">) {
  const name = getFunctionName(reference);
  return (args: unknown) => {
    operations.push({ name, args });
    // Only admission tests may invoke this fake. It creates no intent, has no
    // transport, and stays pending so the same component can exercise its lock.
    if (parameters.has("admission") && name === "forumCommunity:preparePayment")
      return new Promise(() => {});
    throw new Error("Fixture forbids mutations");
  };
}
export function useAction(reference: FunctionReference<"action">) {
  return (args: unknown) => denied(getFunctionName(reference), args);
}
export function useWalletAction() {
  const [isRunning] = useState(false);
  return {
    isRunning,
    dispatch: (args: unknown) => denied("wallet:dispatch", args),
  };
}
export function useConnectedWallet() {
  return null;
}
const client = {
  wallet: {
    getState: () => ({
      connected:
        parameters.has("retained") || parameters.has("admission")
          ? {
              account: { address: payerWallet },
              supportedTransactionVersions: new Set([0]),
            }
          : null,
    }),
    subscribe: () => () => {},
  },
} as unknown as CommerceWalletClient;
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  const auth = useConvexAuth();
  return {
    ...auth,
    linked: parameters.has("admission") && !parameters.has("unlinked"),
    connected: client.wallet.getState().connected,
    session: null,
  };
}
export function CommerceWalletButton({ disabled }: { disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled}>
      Fixture wallet
    </button>
  );
}
export function usePathname() {
  return "/crypto-pumpfun/public-thread-one";
}
export function useSearchParams() {
  return new URLSearchParams(location.search);
}
