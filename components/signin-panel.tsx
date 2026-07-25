"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthActions } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";

export function SignInPanel() {
  return (
    <Suspense fallback={<PasswordPanelSkeleton />}>
      <PasswordPanel />
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
  const [generated, setGenerated] = useState(() =>
    initialMode === "signUp" ? randomSymHandle() : "",
  );
  const [username, setUsername] = useState(generated);
  const [pendingMethod, setPendingMethod] = useState<
    "google" | "password" | null
  >(null);
  const { signIn } = useAuthActions();
  const router = useRouter();

  function selectMode(next: "signIn" | "signUp") {
    setMode(next);
    if (next === "signIn" && username === generated) {
      setUsername("");
    } else if (next === "signUp" && username.trim() === "") {
      const handle = randomSymHandle();
      setGenerated(handle);
      setUsername(handle);
    }
  }

  async function submit(formData: FormData) {
    setPendingMethod("password");
    formData.set("flow", mode);
    formData.set("username", username);
    formData.set("email", usernameCredential(username));
    formData.set("redirectTo", redirectTo);
    try {
      await signIn("password", formData);
      toast.success(mode === "signUp" ? "Account created" : "Signed in");
      router.push(redirectTo);
    } catch (error) {
      reportAppError(error, {
        scope: "auth",
        eventType: "signin_failed",
        component: "PasswordPanel",
        action: mode,
        level: "warn",
        notify: false,
      });
      const data = error instanceof ConvexError ? error.data : null;
      const message =
        typeof data === "string" && data.trim()
          ? data
          : mode === "signIn"
            ? "Wrong username or password."
            : "Could not create account. Try a different username.";
      toast.error(message);
    } finally {
      setPendingMethod(null);
    }
  }

  async function continueWithGoogle() {
    setPendingMethod("google");
    try {
      const oauthRedirectTo = new URL(
        redirectTo,
        window.location.origin,
      ).toString();
      await signIn("google", { redirectTo: oauthRedirectTo });
    } catch (error) {
      reportAppError(error, {
        scope: "auth",
        eventType: "google_signin_failed",
        component: "PasswordPanel",
        action: mode,
        level: "warn",
        notify: false,
      });
      toast.error("Google sign-in could not start. Please try again.");
      setPendingMethod(null);
    }
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
      <Button
        className="w-full"
        disabled={pendingMethod !== null}
        onClick={() => void continueWithGoogle()}
        type="button"
        variant="outline"
      >
        <GoogleMark />
        {pendingMethod === "google"
          ? "Opening Google..."
          : "Continue with Google"}
      </Button>
      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-row-border" />
        <span className="font-mono text-[10px] uppercase text-muted-foreground">
          Or use a SYM handle
        </span>
        <span className="h-px flex-1 bg-row-border" />
      </div>
      <form action={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm font-medium">
          Username
          <div className="flex gap-2">
            <Input
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
            {mode === "signUp" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const handle = randomSymHandle();
                  setGenerated(handle);
                  setUsername(handle);
                }}
              >
                Random
              </Button>
            ) : null}
          </div>
        </label>
        {mode === "signUp" ? (
          <label className="flex flex-col gap-2 text-sm font-medium">
            Email (optional)
            <Input
              name="contactEmail"
              type="email"
              autoComplete="email"
              placeholder="austin@example.com"
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-2 text-sm font-medium">
          Password
          <Input
            name="password"
            type="password"
            autoComplete={
              mode === "signUp" ? "new-password" : "current-password"
            }
            minLength={8}
            required
          />
        </label>
        <Button type="submit" disabled={pendingMethod !== null}>
          {pendingMethod === "password"
            ? "Working..."
            : mode === "signUp"
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24">
      <path
        d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.2c1.9-1.8 3.1-4.4 3.1-7.6Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 5-.9 6.7-2.3l-3.2-2.6c-.9.6-2 1-3.5 1a5.9 5.9 0 0 1-5.5-4.1H3.2v2.6A10.1 10.1 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.5 14a6 6 0 0 1 0-3.9V7.5H3.2a10 10 0 0 0 0 9.1L6.5 14Z"
        fill="#FBBC05"
      />
      <path
        d="M12 6a5.4 5.4 0 0 1 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 12 2a10.1 10.1 0 0 0-8.8 5.5l3.3 2.6A5.9 5.9 0 0 1 12 6Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function randomSymHandle() {
  return `SYM-${Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0")}`;
}

function usernameCredential(username: string) {
  return `${username.trim().toLowerCase()}@users.symbaiex.local`;
}

function cleanRedirect(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}
