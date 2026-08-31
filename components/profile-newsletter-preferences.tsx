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
  const updateTopics = useMutation(convexRefs.newsletter.updateViewerTopics);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [topicPendingId, setTopicPendingId] = useState<string | null>(null);
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

  async function setTopics(
    subscriberId: string,
    dailyOptIn: boolean,
    weeklyOptIn: boolean,
  ) {
    setTopicPendingId(subscriberId);
    try {
      await updateTopics({ subscriberId, dailyOptIn, weeklyOptIn });
      toast.success("Newsletter topics updated");
    } catch (error) {
      reportAppError(error, {
        scope: "newsletter",
        eventType: "profile_topics_failed",
        component: "ProfileNewsletterPreferences",
        action: "newsletter:updateViewerTopics",
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update newsletter topics",
      );
    } finally {
      setTopicPendingId(null);
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
      <form
        onSubmit={submit}
        className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"
      >
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
            className="grid gap-3 border-y border-row-border py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div>
              <p className="font-medium">{subscription.email}</p>
              <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                {subscription.status} / {formatDate(subscription.updatedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <TopicToggle
                checked={subscription.dailyOptIn}
                disabled={topicPendingId === subscription._id}
                label="Daily signal"
                onChange={(checked) =>
                  setTopics(subscription._id, checked, subscription.weeklyOptIn)
                }
              />
              <TopicToggle
                checked={subscription.weeklyOptIn}
                disabled={topicPendingId === subscription._id}
                label="Weekly field note"
                onChange={(checked) =>
                  setTopics(subscription._id, subscription.dailyOptIn, checked)
                }
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TopicToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
      <input
        checked={checked}
        className="size-4 accent-primary"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
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
