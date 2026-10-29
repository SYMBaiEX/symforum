"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  identityClient,
  identityRequest,
  signOutIdentity,
} from "@symbaiex/auth/identity-client";
import { isRecoveryEmail } from "@/lib/identity-config";
import { IdentityProviders } from "./identity-providers";

type Account = { id: string; providerId: string; accountId: string };
export function IdentityConnections() {
  const { data: session, isPending } = identityClient.useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  async function refresh() {
    const result = await identityClient.listAccounts();
    if (result.error) throw new Error("Could not load account connections.");
    setAccounts(result.data ?? []);
  }
  const sessionUserId = session?.user.id;
  useEffect(() => {
    if (sessionUserId)
      void refresh().catch(() =>
        setError("Could not load account connections."),
      );
  }, [sessionUserId]);
  async function run(task: () => Promise<void>) {
    setPending(true);
    setError("");
    setStatus("");
    try {
      await task();
      await refresh();
      await identityClient.getSession();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Account change did not complete.",
      );
    } finally {
      setPending(false);
    }
  }
  if (isPending) return <p role="status">Loading account connections…</p>;
  if (!session)
    return (
      <p>
        <a className="underline" href="/signin?redirectTo=/account/connections">
          Sign in to manage your connections.
        </a>
      </p>
    );
  return (
    <section className="space-y-6 rounded-2xl border border-row-border bg-card p-6">
      <div>
        <h2 className="text-xl font-semibold">Account connections</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          One profile across the platform and forum. Sign in again before
          changing connections if your current session is more than five minutes
          old.
        </p>
        <a
          href="/signin?redirectTo=/account/connections"
          className="mt-2 inline-block text-sm underline"
        >
          Sign in again
        </a>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Email</dt>
          <dd>
            {isRecoveryEmail(session.user.email) && session.user.emailVerified
              ? session.user.email
              : "No verified recovery email"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Username</dt>
          <dd>{session.user.username ?? "Not set"}</dd>
        </div>
      </dl>
      <ul className="divide-y divide-row-border">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex min-w-0 items-center justify-between gap-3 py-3 text-sm"
          >
            <span className="min-w-0">
              <span className="font-medium">
                {(
                  {
                    google: "Google",
                    solana: "Solana wallet",
                    telegram: "Telegram",
                    credential: "Password",
                  } as Record<string, string>
                )[account.providerId] ?? account.providerId}
              </span>
              {account.providerId === "solana" && (
                <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                  {account.accountId}
                </span>
              )}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || accounts.length < 2}
              onClick={() =>
                void run(async () => {
                  await identityRequest("/identity/unlink", {
                    providerId: account.providerId,
                    accountId: account.accountId,
                  });
                  setStatus("Connection removed.");
                })
              }
            >
              Unlink
            </Button>
          </li>
        ))}
      </ul>
      <IdentityProviders
        purpose="link"
        onComplete={() => {
          void refresh();
          setStatus("Connection verified.");
        }}
      />
      <form
        className="space-y-3 border-t border-row-border pt-5"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void run(async () => {
            const result = sent
              ? await identityClient.emailOtp.changeEmail({
                  newEmail: email,
                  otp,
                })
              : await identityClient.emailOtp.requestEmailChange({
                  newEmail: email,
                });
            if (result.error)
              throw new Error(
                "Sign in again, then verify the new email. An email already attached to another account cannot be merged here.",
              );
            if (sent) {
              setStatus("Recovery email verified.");
              setSent(false);
              setOtp("");
            } else {
              setSent(true);
              setStatus("Check your new email for a verification code.");
            }
          });
        }}
      >
        <h3 className="font-medium">Add or change recovery email</h3>
        <label className="block text-sm">
          New email
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
        {sent && (
          <label className="block text-sm">
            Verification code
            <Input
              className="mt-2"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
          </label>
        )}
        <Button type="submit" variant="outline" disabled={pending}>
          {sent ? "Verify new email" : "Send verification code"}
        </Button>
      </form>
      <form
        className="space-y-3 border-t border-row-border pt-5"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void run(async () => {
            const result = await identityClient.updateUser({ username });
            if (result.error)
              throw new Error(
                "This username is unavailable or your session needs a fresh sign-in.",
              );
            setStatus("Username updated.");
          });
        }}
      >
        <label className="block text-sm">
          Sign-in username
          <Input
            className="mt-2"
            autoComplete="username"
            minLength={3}
            maxLength={30}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <Button type="submit" variant="outline" disabled={pending}>
          Set username
        </Button>
      </form>
      <form
        className="space-y-3 border-t border-row-border pt-5"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void run(async () => {
            if (
              accounts.some((account) => account.providerId === "credential")
            ) {
              const result = await identityClient.changePassword({
                currentPassword: oldPassword,
                newPassword: password,
                revokeOtherSessions: true,
              });
              if (result.error)
                throw new Error(
                  "Check your current password and sign in again.",
                );
            } else await identityRequest("/identity/password", { password });
            setPassword("");
            setOldPassword("");
            setStatus(
              accounts.some((account) => account.providerId === "credential")
                ? "Password updated. Other sessions were revoked."
                : "Password added.",
            );
          });
        }}
      >
        <h3 className="font-medium">Username and email password sign-in</h3>
        {accounts.some((account) => account.providerId === "credential") && (
          <label className="block text-sm">
            Current password
            <Input
              className="mt-2"
              type="password"
              autoComplete="current-password"
              required
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </label>
        )}
        <label className="block text-sm">
          New password
          <Input
            className="mt-2"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <Button type="submit" variant="outline" disabled={pending}>
          Save password
        </Button>
      </form>
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => void run(signOutIdentity)}
      >
        Sign out across the platform
      </Button>
    </section>
  );
}
