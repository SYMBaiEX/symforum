import type { ReactNode } from "react";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
import { useConvexAuth } from "./terminal-convex";

// No signer or transport is implemented, including in the input-state scenario.
const client = {
  wallet: { getState: () => ({ connected: null }) },
} as unknown as CommerceWalletClient;
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  // Production useCommerceIdentity returns these exact Convex auth fields.
  // A wallet connection status is not a separate identity-loading signal.
  const { isAuthenticated, isLoading } = useConvexAuth();
  const linked =
    isAuthenticated &&
    !isLoading &&
    /research|orderinput/.test(location.search);
  return {
    linked,
    connected: linked
      ? {
          account: { address: "11111111111111111111111111111111" },
          supportedTransactionVersions: new Set([0]),
        }
      : null,
    isAuthenticated,
    isLoading,
    session: { wallets: [], authUserId: "isolated-terminal-reader" },
  };
}
export function CommerceWalletButton() {
  return <button type="button">Sign in with wallet</button>;
}
