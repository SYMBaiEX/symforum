import type { ReactNode } from "react";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";

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
  const loading = /authloading|walletloading/.test(location.search);
  return {
    linked: !loading && /research|orderinput/.test(location.search),
    connected:
      !loading && /research|orderinput/.test(location.search)
        ? {
            account: { address: "11111111111111111111111111111111" },
            supportedTransactionVersions: new Set([0]),
          }
        : null,
    isAuthenticated:
      !location.search.includes("guest") &&
      !location.search.includes("authloading"),
    isLoading: loading,
    session: { wallets: [], authUserId: "isolated-terminal-reader" },
  };
}
export function CommerceWalletButton() {
  return <button type="button">Sign in with wallet</button>;
}
