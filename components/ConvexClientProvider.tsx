"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import { ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

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
    <ConvexAuthNextjsProvider client={convex}>
      <ConvexQueryCacheProvider expiration={15 * 60_000} maxIdleEntries={400}>
        {children}
      </ConvexQueryCacheProvider>
    </ConvexAuthNextjsProvider>
  );
}
