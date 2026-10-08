"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { LegacySignInPanel } from "@/components/auth/legacy-signin-panel";

export function SignInPanel() {
  return (
    <Suspense fallback={<PasswordPanelSkeleton />}>
      {process.env.NEXT_PUBLIC_WORKOS_ENABLED === "true" ? (
        <PasswordPanel />
      ) : (
        <LegacySignInPanel />
      )}
    </Suspense>
  );
}

function PasswordPanelSkeleton() {
  return (
    <div className="border border-row-border bg-card p-5" aria-busy="true">
      <div className="mb-6 flex gap-2" aria-hidden="true">
        <div className="h-8 w-20 border border-row-border bg-muted/45" />
        <div className="h-8 w-20 border border-row-border bg-muted/25" />
      </div>
      <div className="flex flex-col gap-4" aria-hidden="true">
        <div className="flex flex-col gap-2">
          <div className="h-3 w-20 bg-muted" />
          <div className="flex gap-2">
            <div className="h-9 min-w-0 flex-1 border border-row-border bg-background/65" />
            <div className="h-9 w-24 border border-row-border bg-background/65" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="h-3 w-28 bg-muted" />
          <div className="h-9 border border-row-border bg-background/65" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="h-3 w-16 bg-muted" />
          <div className="h-9 border border-row-border bg-background/65" />
        </div>
        <div className="h-9 border border-row-border bg-primary/40" />
      </div>
    </div>
  );
}

function PasswordPanel() {
  const searchParams = useSearchParams();
  const redirectTo = cleanRedirect(searchParams.get("redirectTo"));
  const initialMode =
    searchParams.get("mode") === "signIn" ? "signIn" : "signUp";
  const [mode, setMode] = useState<"signIn" | "signUp">(initialMode);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const status = searchParams.get("status");

  function selectMode(next: "signIn" | "signUp") {
    setMode(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    if (mode === "signUp") {
      const normalizedHandle = username.trim().toLowerCase();
      if (!HANDLE_PATTERN.test(normalizedHandle)) {
        toast.error("Use 3–32 letters, numbers, underscores, or dashes.");
        setPending(false);
        return;
      }
      if (!isValidEmail(email)) {
        toast.error("Enter an email address you can verify.");
        setPending(false);
        return;
      }
      window.sessionStorage.setItem("symbaiex.auth.signup-handle", normalizedHandle);
      window.sessionStorage.setItem("symbaiex.auth.signup-returnTo", redirectTo);
      // The API route must receive a document navigation so its WorkOS redirect is followed.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(
        `/api/auth/sign-up?email=${encodeURIComponent(email.trim())}&returnTo=${encodeURIComponent("/auth/complete-signup")}`,
      );
      return;
    }

    const identifier = username.trim();
    if (!identifier) {
      toast.error("Enter your email or SYM handle.");
      setPending(false);
      return;
    }
    // The API route must receive a document navigation so its WorkOS redirect is followed.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(
      `/api/auth/sign-in?identifier=${encodeURIComponent(identifier)}&returnTo=${encodeURIComponent(redirectTo)}`,
    );
  }

  return (
    <div className="border border-row-border bg-card p-5">
      <div className="mb-6 flex gap-2">
        <Button
          type="button"
          variant={mode === "signUp" ? "default" : "outline"}
          onClick={() => selectMode("signUp")}
        >
          Sign up
        </Button>
        <Button
          type="button"
          variant={mode === "signIn" ? "default" : "outline"}
          onClick={() => selectMode("signIn")}
        >
          Sign in
        </Button>
      </div>
      {status === "account-not-found" ? (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          We could not find a verified email for that identifier. Older accounts
          can connect an email through the account migration page.
        </p>
      ) : null}
      {status === "verified-email-required" ? (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          A verified email is required to create or connect an account.
        </p>
      ) : null}
      {status === "handle-unavailable" ? (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          That handle is already in use. Choose another handle or migrate the existing account.
        </p>
      ) : null}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm font-medium">
          {mode === "signUp" ? "Choose a handle" : "Email or SYM handle"}
          <div className="flex gap-2">
            <Input
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete={mode === "signUp" ? "username" : "username email"}
              placeholder={mode === "signUp" ? "your-handle" : "handle or email"}
              required
            />
          </div>
        </label>
        {mode === "signUp" ? (
          <label className="flex flex-col gap-2 text-sm font-medium">
            Verified email
            <Input
              name="contactEmail"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </label>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending
            ? "Opening WorkOS..."
            : mode === "signUp"
              ? "Continue with WorkOS"
              : "Continue with WorkOS"}
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          WorkOS securely handles passwords, social sign-in, and email
          verification. Existing SYM handles remain available for sign-in.
        </p>
      </form>
      <Button
        asChild
        className="mt-4 w-full"
        variant="ghost"
      >
        <a href="/account/migrate">Migrate an existing account</a>
      </Button>
    </div>
  );
}

const HANDLE_PATTERN = /^sym-\d{1,8}$|^[a-z0-9][a-z0-9_-]{2,31}$/i;

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function cleanRedirect(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}
