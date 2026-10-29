"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { identityClient } from "./identity-client";

export function IdentityBootstrap({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { data } = identityClient.useSession();
  const ensure = useMutation(api.identityData.ensureIdentity);
  const [ready, setReady] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!isAuthenticated || !data?.user.id) return;
    let active = true;
    setError(false);
    void ensure({})
      .then(() => {
        if (active) setReady(data.user.id);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [
    isAuthenticated,
    data?.user.id,
    data?.user.email,
    data?.user.emailVerified,
    data?.user.username,
    ensure,
  ]);
  // A popup focus refresh can make a guest session pending again. Never
  // unmount an active public sign-in flow. This does not grant Convex access;
  // identity creation still waits for verified authentication above.
  if (pathname === "/signin") return children;
  if (error)
    return (
      <main className="mx-auto max-w-lg p-8" role="alert">
        <h1 className="text-xl font-semibold">
          Your existing account needs verification
        </h1>
        <p className="mt-3">
          Nothing was merged or removed. Use your existing-account sign-in to
          keep your profile and content.
        </p>
        <a href="/signin?method=legacy" className="mt-4 block underline">
          Verify existing account
        </a>
      </main>
    );
  if (isLoading || (isAuthenticated && ready !== data?.user.id))
    return (
      <p role="status" className="p-6">
        Verifying your account…
      </p>
    );
  return children;
}
