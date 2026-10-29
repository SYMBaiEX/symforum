"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  createIdentityWalletClient,
  type IdentityWalletClient,
} from "@/lib/identity-wallet-client";

const WalletContext = createContext<IdentityWalletClient | null | undefined>(
  undefined,
);

/** One browser-owned SDK instance for sign-in, linking and payments. Never an auth credential. */
export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<IdentityWalletClient | null>(null);
  useEffect(() => {
    const owned = createIdentityWalletClient();
    setClient(owned);
    return () => owned[Symbol.dispose]();
  }, []);
  return (
    <WalletContext.Provider value={client}>{children}</WalletContext.Provider>
  );
}
export function useSessionWalletClient() {
  return useContext(WalletContext);
}
/** Isolated embeds/tests can supply a boundary; website pages reuse the app root. */
export function SolanaWalletBoundary({ children }: { children: ReactNode }) {
  const shared = useSessionWalletClient();
  return shared === undefined ? (
    <SolanaWalletProvider>{children}</SolanaWalletProvider>
  ) : (
    children
  );
}
