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
    linked: false,
    connected: null,
    isAuthenticated: !location.search.includes("guest"),
    isLoading: false,
    session: { wallets: [], authUserId: "isolated-terminal-reader" },
  };
}
export function CommerceWalletButton() {
  return <button type="button">Sign in with wallet</button>;
}
