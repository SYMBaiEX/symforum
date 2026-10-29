"use client";

import { AuthKitConvexProvider as AuthProvider } from "@symbaiex/auth/client";
import { SolanaWalletProvider } from "./auth/solana-wallet-provider";
import type { ReactNode } from "react";

export function AuthKitConvexProvider({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SolanaWalletProvider>{children}</SolanaWalletProvider>
    </AuthProvider>
  );
}
export default AuthKitConvexProvider;
export {
  CONVEX_QUERY_CACHE_EXPIRATION_MS,
  CONVEX_QUERY_CACHE_MAX_IDLE_ENTRIES,
} from "@symbaiex/auth/client";
