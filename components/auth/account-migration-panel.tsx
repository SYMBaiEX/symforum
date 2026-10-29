"use client";

import { ConvexAuthProvider, useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { ConvexReactClient } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IdentitySignIn } from "./identity-signin";

const SYNTHETIC_EMAIL_SUFFIX = "@users.symbaiex.local";

export function AccountMigrationPanel({ status }: { status?: string }) {
  if (process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED === "true") return <IdentitySignIn />;
  return <WorkOSAccountMigrationPanel status={status} />;
}

function WorkOSAccountMigrationPanel({ status }: { status?: string }) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const client = useMemo(
    () => (url ? new ConvexReactClient(url) : null),
    [url],
  );
  if (!client) {
    return <p role="alert">Account migration is unavailable until Convex is configured.</p>;
  }
  if (process.env.NEXT_PUBLIC_WORKOS_ENABLED !== "true") {
    return <p role="alert">WorkOS account linking is not enabled on this deployment yet.</p>;
  }
  return (
    <ConvexAuthProvider client={client}>
      <LegacyAccountLinkFlow status={status} />
    </ConvexAuthProvider>
  );
}

function LegacyAccountLinkFlow({ status }: { status?: string }) {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { user: workosUser } = useAuth();
  const beginLink = useMutation(api.authKitIdentity.beginAuthKitLink);
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading || !isAuthenticated || pending) return;
    const desiredEmail =
      email || window.sessionStorage.getItem("symbaiex.auth.link-email") || "";
    if (!desiredEmail) return;
    setPending(true);
    void beginLink({ email: desiredEmail })
      .then(({ challenge }) => {
        window.sessionStorage.setItem("symbaiex.auth.link-challenge", challenge);
        window.sessionStorage.setItem(
          "symbaiex.auth.link-returnTo",
          window.sessionStorage.getItem("symbaiex.auth.link-returnTo") || "/",
        );
        if (workosUser?.id) {
          router.replace("/auth/complete-link");
        } else {
          // The API route must receive a document navigation so its WorkOS redirect is followed.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign(
            `/api/auth/sign-in?identifier=${encodeURIComponent(desiredEmail)}&returnTo=${encodeURIComponent("/auth/complete-link")}`,
          );
        }
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "The account-link request could not be started.",
        );
        setPending(false);
      });
  }, [beginLink, email, isAuthenticated, isLoading, pending, router, workosUser?.id]);

  async function loginWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    window.sessionStorage.setItem("symbaiex.auth.link-email", email.trim().toLowerCase());
    window.sessionStorage.setItem("symbaiex.auth.link-returnTo", "/");
    const normalizedHandle = handle.trim().toLowerCase();
    const form = new FormData();
    form.set("flow", "signIn");
    form.set("username", normalizedHandle);
    form.set(
      "email",
      normalizedHandle.includes("@")
        ? normalizedHandle
        : `${normalizedHandle}${SYNTHETIC_EMAIL_SUFFIX}`,
    );
    form.set("password", password);
    try {
      await signIn("password", form);
      setPending(false);
    } catch {
      setError("The existing account could not be verified. Check the handle and password.");
      setPending(false);
    }
  }

  async function loginWithGoogle() {
    if (!isValidEmail(email)) {
      setError("Enter the verified email you want to use with WorkOS first.");
      return;
    }
    setError(null);
    setPending(true);
    window.sessionStorage.setItem("symbaiex.auth.link-email", email.trim().toLowerCase());
    window.sessionStorage.setItem("symbaiex.auth.link-returnTo", "/");
    try {
      await signIn("google");
    } catch {
      setError("The existing Google account could not be verified.");
      setPending(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-5 rounded-2xl border border-row-border bg-card p-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Account migration</p>
        <h1 className="mt-2 text-2xl font-semibold">Connect your existing SYM account</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Sign in to the old account first. Then verify its email with WorkOS. Your existing Convex user ID and owned content stay attached to that account.
        </p>
      </div>
      {status === "link-required" ? (
        <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          This WorkOS email already belongs to a SYMBaiEX account. Sign in to that account here to link it safely.
        </p>
      ) : null}
      {status === "verified-email-required" ? (
        <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          WorkOS must verify the email before the account can be connected.
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <form onSubmit={loginWithPassword} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm font-medium">
          Existing handle or email
          <Input value={handle} onChange={(event) => setHandle(event.target.value)} autoComplete="username" required />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Existing password
          <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Email to verify with WorkOS
          <Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
        </label>
        <Button type="submit" disabled={pending || !email.trim()}>
          {pending ? "Connecting accounts…" : "Verify existing account"}
        </Button>
      </form>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-row-border" />
        or use the old Google login
        <span className="h-px flex-1 bg-row-border" />
      </div>
      <Button type="button" variant="outline" onClick={loginWithGoogle} disabled={pending || !email.trim()}>
        Continue with legacy Google
      </Button>
    </section>
  );
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
