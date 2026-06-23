"use client";

import { ConvexReactClient } from "convex/react";
import { ComponentType, lazy, ReactNode, Suspense, useMemo } from "react";

type ConvexAuthProviderProps = {
  client: ConvexReactClient;
  children: ReactNode;
};

const ConvexAuthProvider = lazy(async () => {
  const authModule = await import("@convex-dev/auth/nextjs");
  return {
    default:
      authModule.ConvexAuthNextjsProvider as ComponentType<ConvexAuthProviderProps>,
  };
});

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const convex = useMemo(
    () =>
      convexUrl ? new ConvexReactClient(convexUrl, { verbose: false }) : null,
    [convexUrl],
  );

  if (convex === null) {
    return <>{children}</>;
  }

  return (
    <Suspense fallback={null}>
      <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>
    </Suspense>
  );
}
