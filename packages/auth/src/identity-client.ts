"use client";
import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { emailOTPClient, usernameClient } from "better-auth/client/plugins";

export const identityClient = createAuthClient({
  basePath: "/api/identity",
  sessionOptions: { refetchInterval: 15, refetchOnWindowFocus: true },
  plugins: [convexClient(), usernameClient(), emailOTPClient()],
});

/** Custom proof exchanges bypass Better Auth's built-in sign-in listeners.
 * Refresh the subscribed session, not just the independent getSession request.
 * hydrateSession is initial/SSR-only and cannot update an existing account.
 */
export async function refreshIdentitySession() {
  const session = identityClient.$store.atoms.session as {
    get: () => ReturnType<typeof identityClient.useSession>;
  };
  await session.get().refetch();
  const result = session.get();
  if (result.error || !result.data?.session?.id || !result.data?.user?.id)
    throw new Error("Session was not confirmed.");
  return result.data;
}

/** Safe HTTP metadata only: never expose a provider's raw response body. */
export class IdentityRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "IdentityRequestError";
  }
}

export async function identityRequest<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("/api/identity" + path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new IdentityRequestError(
      response.status,
      response.status === 429
        ? "Too many requests. Please try again later."
        : response.status === 401
          ? "Sign in again or restart verification."
          : "Unable to complete verification. No accounts were merged.",
    );
  }
  return response.json() as Promise<T>;
}

export async function signOutIdentity() {
  const result = await identityClient.signOut();
  if (result.error)
    throw new Error("Sign-out could not be confirmed. Please try again.");
  // A document reload discards cached authenticated subscriptions after logout.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/signin");
}
