"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { convexRefs } from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import { Send } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

export function ProfileNewsletterPreferences() {
  const preferences = useQuery(convexRefs.newsletter.viewerPreferences, {});
  const requestSubscription = useMutation(
    convexRefs.newsletter.requestViewerSubscription,
  );
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const prefilled = useRef(false);

  useEffect(() => {
    if (!prefilled.current && preferences?.userEmail) {
      prefilled.current = true;
      setEmail(preferences.userEmail);
    }
  }, [preferences?.userEmail]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const token = createClientNewsletterToken();
      const subscriber = await requestSubscription({
        email,
        source: "profile",
        token,
        tokenHash: await sha256Hex(token),
        siteUrl: window.location.origin,
      });
      toast.success(
        subscriber.status === "confirmed"
          ? "You are already subscribed."
          : "Confirmation email queued",
      );
    } catch (error) {
      reportAppError(error, {
        scope: "newsletter",
        eventType: "profile_subscription_failed",
        component: "ProfileNewsletterPreferences",
        action: "newsletter:requestViewerSubscription",
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update newsletter preferences",
      );
    } finally {
      setPending(false);
    }
  }

  if (preferences === undefined) {
    return (
      <section className="mt-8 font-mono text-xs uppercase text-muted-foreground">
        Loading newsletter preferences
      </section>
    );
  }
  if (preferences === null) {
    return null;
  }

  return (
    <section className="mt-8">
      <p className="font-mono text-xs uppercase text-muted-foreground">
        Newsletter
      </p>
      <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="sr-only" htmlFor="profile-newsletter-email">
          Email address
        </label>
        <Input
          id="profile-newsletter-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Sign up for Newsletter"
          autoComplete="email"
          className="rounded-none"
          required
        />
        <Button type="submit" disabled={pending}>
          <Send aria-hidden="true" />
          {pending ? "Sending" : "Subscribe"}
        </Button>
      </form>
      <div className="mt-4 grid gap-2">
        {preferences.subscriptions.map((subscription) => (
          <div
            key={subscription._id}
            className="grid gap-1 font-mono text-[11px] uppercase text-muted-foreground sm:grid-cols-[1fr_auto]"
          >
            <span>{subscription.email}</span>
            <span>
              {subscription.status} / {formatDate(subscription.updatedAt)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function createClientNewsletterToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `sym_nl_${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
