"use client";

import { ConvexProviderWithAuthKit } from "@convex-dev/workos";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import {
  ConvexProviderWithAuth,
  ConvexReactClient,
  useConvexAuth,
  useMutation,
} from "convex/react";
import {
  AuthKitProvider,
  useAccessToken,
  useAuth,
} from "@workos-inc/authkit-nextjs/components";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import {
  CONVEX_QUERY_CACHE_EXPIRATION_MS,
  CONVEX_QUERY_CACHE_MAX_IDLE_ENTRIES,
} from "./query-cache";
import { authKitProviderProps } from "./provider-state";

export {
  CONVEX_QUERY_CACHE_EXPIRATION_MS,
  CONVEX_QUERY_CACHE_MAX_IDLE_ENTRIES,
};

export function AuthKitConvexProvider({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const workosEnabled = process.env.NEXT_PUBLIC_WORKOS_ENABLED === "true";
  const client = useMemo(
    () =>
      convexUrl ? new ConvexReactClient(convexUrl, { verbose: false }) : null,
    [convexUrl],
  );

  if (client === null) {
    return <ConvexUnavailable />;
  }

  return (
    <AuthKitProvider {...authKitProviderProps(workosEnabled)}>
      {workosEnabled ? (
        <ConvexProviderWithAuthKit client={client} useAuth={useAuthForConvex}>
          <ConvexQueryCacheProvider
            expiration={CONVEX_QUERY_CACHE_EXPIRATION_MS}
            maxIdleEntries={CONVEX_QUERY_CACHE_MAX_IDLE_ENTRIES}
          >
            <AuthKitIdentityBootstrap>{children}</AuthKitIdentityBootstrap>
          </ConvexQueryCacheProvider>
        </ConvexProviderWithAuthKit>
      ) : (
        <ConvexProviderWithAuth
          client={client}
          useAuth={useUnauthenticatedConvexAuth}
        >
          <ConvexQueryCacheProvider
            expiration={CONVEX_QUERY_CACHE_EXPIRATION_MS}
            maxIdleEntries={CONVEX_QUERY_CACHE_MAX_IDLE_ENTRIES}
          >
            {children}
          </ConvexQueryCacheProvider>
        </ConvexProviderWithAuth>
      )}
    </AuthKitProvider>
  );
}

function ConvexUnavailable() {
  return (
    <main className="min-h-dvh bg-background px-4 py-16 text-foreground">
      <section
        role="alert"
        className="mx-auto max-w-xl border border-row-border bg-card p-6"
      >
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          SYMBaiEX Forum
        </p>
        <h1 className="mt-3 text-2xl font-semibold">Forum is not configured</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The Forum backend is unavailable because this app has no Convex URL
          configured. Add NEXT_PUBLIC_CONVEX_URL to the app environment, then
          reload this page.
        </p>
      </section>
    </main>
  );
}

const unauthenticatedConvexAuth = {
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
};

function useUnauthenticatedConvexAuth() {
  return unauthenticatedConvexAuth;
}

function AuthKitIdentityBootstrap({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { user } = useAuth();
  const ensureIdentity = useMutation(api.authKitIdentity.ensureAuthKitIdentity);
  const completeLink = useMutation(api.authKitIdentity.completeAuthKitLink);
  const [problem, setProblem] = useState<string | null>(null);
  const attemptedUserId = useRef<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || !isAuthenticated || !user?.id) return;
    if (pathname === "/auth/complete-link") {
      const challenge = window.sessionStorage.getItem(
        "symbaiex.auth.link-challenge",
      );
      if (!challenge) {
        setProblem(
          "The account-link request is missing. Start again from account migration.",
        );
        return;
      }
      if (attemptedUserId.current === `link:${user.id}:${challenge}`) return;
      attemptedUserId.current = `link:${user.id}:${challenge}`;
      void completeLink({ challenge })
        .then(() => {
          window.sessionStorage.removeItem("symbaiex.auth.link-challenge");
          router.replace(
            safeReturnTo(
              window.sessionStorage.getItem("symbaiex.auth.link-returnTo"),
            ),
          );
          window.sessionStorage.removeItem("symbaiex.auth.link-returnTo");
        })
        .catch(() => {
          setProblem(
            "We could not link this WorkOS identity. Use the verified email entered during migration, then start again if the request expired.",
          );
        });
      return;
    }
    if (attemptedUserId.current === user.id) return;
    attemptedUserId.current = user.id;
    const requestedHandle =
      pathname === "/auth/complete-signup"
        ? (window.sessionStorage.getItem("symbaiex.auth.signup-handle") ??
          undefined)
        : undefined;
    void ensureIdentity({ requestedHandle })
      .then((result) => {
        if (result.status === "link_required") {
          router.replace("/account/migrate?status=link-required");
          return;
        }
        if (result.status === "verified_email_required") {
          router.replace("/account/migrate?status=verified-email-required");
          return;
        }
        if (result.status === "handle_unavailable") {
          router.replace("/signin?status=handle-unavailable");
          return;
        }
        if (result.status === "created" || result.status === "linked") {
          window.sessionStorage.removeItem("symbaiex.auth.signup-handle");
          if (pathname === "/auth/complete-signup") {
            router.replace(
              safeReturnTo(
                window.sessionStorage.getItem("symbaiex.auth.signup-returnTo"),
              ),
            );
            window.sessionStorage.removeItem("symbaiex.auth.signup-returnTo");
          }
        }
      })
      .catch(() => {
        setProblem(
          "We could not finish setting up your account. Refresh this page to retry.",
        );
        attemptedUserId.current = null;
      });
  }, [
    completeLink,
    ensureIdentity,
    isAuthenticated,
    isLoading,
    pathname,
    router,
    user?.id,
  ]);

  return (
    <>
      {problem ? (
        <div
          role="alert"
          className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm"
        >
          {problem}
        </div>
      ) : null}
      {children}
    </>
  );
}

function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

function useAuthForConvex() {
  const { user, loading } = useAuth();
  const { getAccessToken } = useAccessToken();
  const fetchToken = useCallback(
    async () => (await getAccessToken()) ?? null,
    [getAccessToken],
  );

  return { user, isLoading: loading, getAccessToken: fetchToken };
}
