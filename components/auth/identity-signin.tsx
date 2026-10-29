"use client";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  identityClient,
  identityRequest,
} from "@symbaiex/auth/identity-client";
import { safeIdentityReturnTo } from "@/lib/identity-config";
import { IdentityProviders } from "./identity-providers";

export function IdentitySignIn() {
  return (
    <Suspense fallback={<p role="status">Loading sign-in…</p>}>
      <IdentitySignInForm />
    </Suspense>
  );
}
function IdentitySignInForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"email" | "password" | "signup" | "legacy">(
    params.get("method") === "legacy" ? "legacy" : "email",
  );
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const destination = safeIdentityReturnTo(params.get("redirectTo"));
  function complete() {
    window.location.assign(destination);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      if (mode === "legacy") {
        await identityRequest("/sign-in/legacy", { username, password });
        complete();
      } else if (mode === "password") {
        const result = username.includes("@")
          ? await identityClient.signIn.email({ email: username, password })
          : await identityClient.signIn.username({ username, password });
        if (result.error)
          throw new Error(
            "Check your credentials. Existing username accounts should use “Existing account”.",
          );
        complete();
      } else if (mode === "signup") {
        if (!sent) {
          const result = await identityClient.emailOtp.sendVerificationOtp({
            email,
            type: "sign-in",
          });
          if (result.error)
            throw new Error("The verification code could not be sent.");
          setSent(true);
        } else {
          const result = await identityClient.signIn.emailOtp({
            email,
            otp: code,
          });
          if (result.error)
            throw new Error("The verification code is invalid or expired.");
          const handle = await identityClient.updateUser({ username });
          if (handle.error)
            throw new Error(
              "Email verified. Choose an available username in account connections.",
            );
          await identityRequest("/identity/password", { password });
          complete();
        }
      } else if (!sent) {
        const result = await identityClient.emailOtp.sendVerificationOtp({
          email,
          type: "sign-in",
        });
        if (result.error)
          throw new Error(
            "The verification email could not be sent. Try again later.",
          );
        setSent(true);
      } else {
        const result = await identityClient.signIn.emailOtp({
          email,
          otp: code,
        });
        if (result.error)
          throw new Error("The verification code is invalid or expired.");
        complete();
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Sign-in did not complete.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="max-w-xl space-y-6 rounded-2xl border border-row-border bg-card p-6">
      <div>
        <h2 className="text-xl font-semibold">
          One account. Your choice of sign-in.
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          For the forum and the entire SYMBaiEX platform.
        </p>
      </div>
      <IdentityProviders onComplete={complete} returnTo={destination} />
      <div className="flex flex-wrap gap-2" aria-label="Sign-in method">
        {(["email", "password", "signup", "legacy"] as const).map((value) => (
          <Button
            key={value}
            variant={mode === value ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setMode(value);
              setSent(false);
              setError("");
            }}
          >
            {
              {
                email: "Email code",
                password: "Username / email",
                signup: "Create account",
                legacy: "Existing account",
              }[value]
            }
          </Button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-4">
        {(mode === "email" || mode === "signup") && (
          <label className="block text-sm">
            Email
            <Input
              className="mt-2"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={sent}
            />
          </label>
        )}
        {mode !== "email" && (
          <label className="block text-sm">
            {mode === "password" ? "Username or email" : "Username"}
            <Input
              className="mt-2"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={sent}
            />
          </label>
        )}
        {mode !== "email" && !sent && (
          <label className="block text-sm">
            Password
            <Input
              className="mt-2"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              minLength={mode === "signup" ? 12 : undefined}
              maxLength={128}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {sent && (
          <label className="block text-sm">
            Verification code
            <Input
              className="mt-2"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        )}
        {mode === "legacy" && (
          <p className="text-sm text-muted-foreground">
            Use your original forum username and password once to migrate
            without losing your profile, posts or permissions. Google users can
            continue with Google above.
          </p>
        )}
        {mode === "signup" && (
          <p className="text-xs leading-5 text-muted-foreground">
            Your email must be verified before your username and password are
            saved.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full">
          {pending
            ? "Verifying…"
            : sent
              ? "Verify and continue"
              : mode === "email"
                ? "Send sign-in code"
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        You can link Google, email, username, Telegram and wallets in Account
        connections after signing in.
      </p>
    </section>
  );
}
