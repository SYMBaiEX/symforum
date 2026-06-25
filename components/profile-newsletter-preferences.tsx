"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { convexRefs } from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import { Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

export function ProfileNewsletterPreferences() {
  const preferences = useQuery(convexRefs.newsletter.viewerPreferences, {});
  const requestSubscription = useMutation(
    convexRefs.newsletter.requestViewerSubscription,
  );
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!email && preferences?.userEmail) {
      setEmail(preferences.userEmail);
    }
  }, [email, preferences?.userEmail]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const token = createClientNewsletterToken();
      await requestSubscription({
        email,
        source: "profile",
        token,
        tokenHash: await sha256Hex(token),
        siteUrl: window.location.origin,
      });
      toast.success("Confirmation email queued");
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
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="email@domain.com"
          className="rounded-none"
          required
        />
        <Button type="submit" disabled={pending}>
          <Send aria-hidden="true" />
          {pending ? "Sending" : "Confirm"}
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
