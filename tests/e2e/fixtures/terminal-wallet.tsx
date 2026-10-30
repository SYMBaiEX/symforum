import type { ReactNode } from "react";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";

const client = {} as CommerceWalletClient;
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  return {
    linked: location.search.includes("research"),
    connected: location.search.includes("research")
      ? {
          account: { address: "11111111111111111111111111111111" },
          supportedTransactionVersions: new Set([0]),
        }
      : null,
    isAuthenticated: !location.search.includes("guest"),
    isLoading: false,
    session: { wallets: [], authUserId: "isolated-terminal-reader" },
  };
}
export function CommerceWalletButton() {
  return <button type="button">Sign in with wallet</button>;
}
