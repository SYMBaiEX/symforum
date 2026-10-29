"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { convexRefs } from "@/lib/convex-refs";
import { ConvexError } from "convex/values";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

export function AccountEmailVerification({
  contactEmail,
}: {
  contactEmail?: string;
}) {
  if (process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED === "true") return <section className="space-y-3 border border-row-border bg-background/50 p-4">
    <h3 className="text-sm font-semibold">Verify a recovery email</h3>
    <p className="text-sm text-muted-foreground">Add and verify your email in Account connections so it also works for signing in.</p>
    <a className="inline-block text-sm underline" href="/account/connections">Manage account connections</a>
  </section>;
  return <LegacyAccountEmailVerification contactEmail={contactEmail} />;
}

function LegacyAccountEmailVerification({ contactEmail }: {
  contactEmail?: string;
}) {
  const challengeStatus = useQuery(convexRefs.accountEmailVerification.status, {});
  const requestVerification = useMutation(
    convexRefs.accountEmailVerification.request,
  );
  const verifyEmail = useMutation(convexRefs.accountEmailVerification.verify);
  const [email, setEmail] = useState(contactEmail ?? "");
  const [code, setCode] = useState("");
  const [requested, setRequested] = useState(false);
  const [pending, setPending] = useState(false);

  async function sendCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequested(false);
    setPending(true);
    try {
      const result = await requestVerification({ email });
      if (result.status === "already_verified") {
        toast.success("This account already has a verified email.");
        return;
      }
      setRequested(true);
      toast.success("Verification requested. Check your inbox in a moment.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function confirmCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await verifyEmail({ code });
      if (result.verified) {
        toast.success("Email verified for this account.");
        return;
      }
      if (result.status === "expired" || result.status === "locked") {
        setRequested(false);
        setCode("");
        toast.error(
          result.status === "expired"
            ? "That code expired. Request a new one."
            : "Too many incorrect attempts. Request a new code later.",
        );
        return;
      }
      toast.error(
        result.status === "not_ready"
          ? "The verification email is not ready yet. Try again shortly."
          : "That code did not match. Check it and try again.",
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const codeReady = challengeStatus === "sent";
  const requestActive =
    requested || challengeStatus === "queued" || challengeStatus === "sent";
  const deliveryFailed = requested && challengeStatus === null;

  return (
    <section className="space-y-3 border border-row-border bg-background/50 p-4">
      <div>
        <h3 className="text-sm font-semibold">Verify your email</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Confirm an inbox you control to unlock trust-sensitive account
          actions. This does not connect the address as a sign-in identity.
        </p>
      </div>
      {!requestActive || deliveryFailed ? (
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => void sendCode(event)}
        >
          <label className="sr-only" htmlFor="account-verification-email">
            Email address
          </label>
          <Input
            autoComplete="email"
            id="account-verification-email"
            maxLength={254}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
          <Button disabled={pending} type="submit">
            {pending ? "Sending…" : "Send verification code"}
          </Button>
        </form>
      ) : null}
      {requestActive && !codeReady ? (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {deliveryFailed
            ? "The request is no longer active. Check sender configuration, then request a new code."
            : "Sending your verification email…"}
        </p>
      ) : null}
      {requestActive && codeReady ? (
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => void confirmCode(event)}
        >
          <label className="sr-only" htmlFor="account-verification-code">
            Eight-digit verification code
          </label>
          <Input
            autoComplete="one-time-code"
            id="account-verification-code"
            inputMode="numeric"
            maxLength={8}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 8))
            }
            pattern="[0-9]{8}"
            placeholder="8-digit code"
            required
            value={code}
          />
          <Button disabled={pending || code.length !== 8} type="submit">
            {pending ? "Checking…" : "Verify email"}
          </Button>
        </form>
      ) : null}
      {requestActive && codeReady ? (
        <p className="text-xs leading-5 text-muted-foreground">
          The code expires in 15 minutes. It can be tried five times and is
          never included in agent credentials.
        </p>
      ) : null}
    </section>
  );
}

function errorMessage(error: unknown) {
  if (error instanceof ConvexError) {
    if (
      typeof error.data === "object" &&
      error.data !== null &&
      "message" in error.data &&
      typeof error.data.message === "string"
    ) {
      return error.data.message;
    }
    if (typeof error.data === "string") return error.data;
  }
  return "Email verification could not be completed. Try again later.";
}
