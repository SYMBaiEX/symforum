import {
  createElement,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
type Mode =
  "loading" | "setup" | "exhausted" | "ready" | "inconsistent" | "failure";
let state = {
  mode: "loading" as Mode,
  authenticated: false,
  linked: false,
  walletLoading: false,
  expired: false,
  held: false,
};
const listeners = new Set<() => void>();
export const actions: string[] = [];
export const reads: string[] = [];
export function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
function useStateSnapshot() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
}
export function useConvexAuth() {
  const value = useStateSnapshot();
  return { isAuthenticated: value.authenticated, isLoading: false };
}
export function useQuery(reference: FunctionReference<"query">, args: unknown) {
  const value = useStateSnapshot();
  if (args === "skip") return undefined;
  const name = getFunctionName(reference);
  reads.push(name);
  if (name === "forumResearch:getConfig") {
    if (value.mode === "loading") return undefined;
    if (value.mode === "failure")
      throw new Error("PRIVATE_FIXTURE_CONFIG_ERROR");
    return {
      enabled: value.mode === "ready",
      reason:
        value.mode === "exhausted"
          ? "free_credits_exhausted"
          : ["ready", "inconsistent"].includes(value.mode)
            ? "ready"
            : "setup_required",
      amountRaw: "100000",
      priceLabel: "$0.10 USDC",
      asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      network: "solana:mainnet",
      product: "solana-token-brief-v1",
    };
  }
  if (name === "forumResearch:listMine") {
    if (!value.authenticated)
      throw new Error("Private receipt query while signed out");
    return value.expired || value.held
      ? [
          {
            intentKey: "fixture-existing-receipt",
            mint: "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump",
            state: value.held ? "unknown" : "quoted",
            createdAt: Date.now() - 180000,
            expiresAt: Date.now() - 120000,
            signature: null,
            finalizedAt: null,
            report: null,
          },
        ]
      : [];
  }
  throw new Error(`Unexpected research query: ${name}`);
}
export function useAction(reference: FunctionReference<"action">) {
  const name = getFunctionName(reference);
  return useCallback(async () => {
    actions.push(name);
    throw new Error("Research actions forbidden in readiness fixture");
  }, [name]);
}
const client = new Proxy(
  {},
  {
    get() {
      actions.push("wallet");
      throw new Error("Wallet methods forbidden");
    },
  },
) as CommerceWalletClient;
export function useCommerceWallet() {
  return useStateSnapshot().walletLoading ? null : client;
}
export function useCommerceIdentity() {
  const value = useStateSnapshot();
  return {
    linked: value.linked,
    connected: value.linked
      ? { account: { address: "11111111111111111111111111111111" } }
      : undefined,
  };
}
export function CommerceWalletButton({
  disabled,
  ...props
}: {
  disabled?: boolean;
  requiredFeature?: string;
  "aria-describedby"?: string;
}) {
  return createElement(
    "button",
    {
      type: "button",
      disabled,
      "aria-describedby": props["aria-describedby"],
      onClick() {
        actions.push("wallet-link");
        throw new Error("Wallet linking forbidden");
      },
    },
    "Link community wallet",
  );
}
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
