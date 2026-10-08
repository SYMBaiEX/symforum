import type { ReactNode } from "react";

export function AuthKitProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useAccessToken() {
  return { accessToken: null, getAccessToken: async () => null };
}

export function useAuth() {
  return {
    isAuthenticated: false,
    isLoading: false,
    loading: false,
    signOut: async () => undefined,
    user: null,
  };
}
