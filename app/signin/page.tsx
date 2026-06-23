"use client";

import ConvexClientProvider from "@/components/ConvexClientProvider";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast, Toaster } from "sonner";

export default function SignInPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <SiteShell>
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
            <ConvexClientProvider>
              <PasswordPanel />
            </ConvexClientProvider>
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
    </SiteShell>
  );
}

function PasswordPanel() {
  const [mode, setMode] = useState<"signIn" | "signUp">("signUp");
  const [username, setUsername] = useState(() => randomSymHandle());
  const [pending, setPending] = useState(false);
  const { signIn } = useAuthActions();
  const router = useRouter();

  async function submit(formData: FormData) {
    setPending(true);
    formData.set("flow", mode);
    formData.set("username", username);
    formData.set("redirectTo", "/news");
    try {
      await signIn("password", formData);
      toast.success(mode === "signUp" ? "Account created" : "Signed in");
      router.push("/news");
    } catch (error) {
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
      <Toaster />
    </div>
  );
}

function randomSymHandle() {
  return `SYM-${Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0")}`;
}
