import "server-only";

import { withAuth } from "@workos-inc/authkit-nextjs";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import type { ReactNode } from "react";

export { withAuth };

export async function AuthServerBoundary({
  children,
}: {
  children: ReactNode;
}) {
  if (
    process.env.NEXT_PUBLIC_WORKOS_ENABLED === "true" ||
    !process.env.NEXT_PUBLIC_CONVEX_URL
  ) {
    return children;
  }

  return (
    <ConvexAuthNextjsServerProvider storage="localStorage">
      {children}
    </ConvexAuthNextjsServerProvider>
  );
}

export function verifiedAuthKitEmail(user: unknown) {
  if (typeof user !== "object" || user === null) return null;
  const record = user as Record<string, unknown>;
  const email = typeof record.email === "string" ? record.email.trim() : "";
  const verified =
    record.emailVerified === true || record.email_verified === true;
  return verified && email.includes("@") ? email.toLowerCase() : null;
}
