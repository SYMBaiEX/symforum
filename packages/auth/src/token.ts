"use client";
import { useAuthToken as useLegacyAuthToken } from "@convex-dev/auth/react";
import { useEffect, useState } from "react";
import { identityClient } from "./identity-client";

function useIdentityToken() {
  const { data } = identityClient.useSession();
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    async function refresh() {
      if (!data?.session.id) {
        setToken(null);
        return;
      }
      const result = await identityClient.convex.token();
      if (active) setToken(result.data?.token ?? null);
    }
    void refresh().catch(() => {
      if (active) setToken(null);
    });
    const interval = window.setInterval(() => {
      void refresh().catch(() => {
        if (active) setToken(null);
      });
    }, 240_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [data?.session.id]);
  return data?.session.id ? token : null;
}
// Build-time provider selection never changes across renders.
export const usePlatformAuthToken =
  process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED === "true"
    ? useIdentityToken
    : useLegacyAuthToken;
