"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";

export default function SignInPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-12 md:px-8 md:py-24">
        <div className="md:col-span-5">
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Reader identity
          </p>
          <h1 className="mt-5 text-5xl font-bold leading-none md:text-7xl">
            Sign in with a SYM handle.
          </h1>
          <p className="mt-6 text-lg leading-8 text-muted-foreground">
            Accounts start with a random SYM number, and can also use a chosen
            handle. Comments, saves, and votes all attach to this identity.
          </p>
        </div>
        <div className="md:col-span-5 md:col-start-8">
          {configured ? (
            <Suspense fallback={<PasswordPanelSkeleton />}>
              <PasswordPanel />
            </Suspense>
          ) : (
            <div className="border border-row-border p-5">
              <h2 className="text-xl font-semibold">
                Convex is not connected locally yet.
              </h2>
              <p className="mt-3 leading-7 text-muted-foreground">
                Run <code className="font-mono">npx convex dev</code> to create
                the local deployment and write{" "}
                <code className="font-mono">NEXT_PUBLIC_CONVEX_URL</code>.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
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
  const [username, setUsername] = useState(() => randomSymHandle());
  const [pending, setPending] = useState(false);
  const { signIn } = useAuthActions();
  const router = useRouter();

  async function submit(formData: FormData) {
    setPending(true);
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
      toast.error(
        error instanceof Error ? error.message : "Could not authenticate",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border border-row-border bg-card p-5">
      <div className="mb-6 flex gap-2">
        <Button
          type="button"
          variant={mode === "signUp" ? "default" : "outline"}
          onClick={() => setMode("signUp")}
        >
          Sign up
        </Button>
        <Button
          type="button"
          variant={mode === "signIn" ? "default" : "outline"}
          onClick={() => setMode("signIn")}
        >
          Sign in
        </Button>
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
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setUsername(randomSymHandle())}
            >
              Random
            </Button>
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
        <Button type="submit" disabled={pending}>
          {pending
            ? "Working..."
            : mode === "signUp"
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>
    </div>
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
    return "/news";
  }
  return value;
}
