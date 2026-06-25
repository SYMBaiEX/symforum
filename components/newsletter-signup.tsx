"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Send } from "lucide-react";
import { useState, type FormEvent } from "react";

export function NewsletterSignup({
  className,
  source = "site",
  variant = "default",
}: {
  className?: string;
  source?: string;
  variant?: "default" | "footer";
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not subscribe");
      }
      setMessage(payload.message ?? "Check your inbox to confirm.");
      setEmail("");
    } catch (error) {
      reportAppError(error, {
        scope: "newsletter",
        eventType: "subscribe_failed",
        component: "NewsletterSignup",
        action: "subscribe",
        metadata: { source },
        notify: false,
      });
      setMessage(error instanceof Error ? error.message : "Could not subscribe");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={subscribe}
      className={cn(
        "grid gap-2",
        variant === "footer"
          ? "grid-cols-[minmax(0,1fr)_auto]"
          : "sm:grid-cols-[1fr_auto]",
        className,
      )}
    >
      <label className="sr-only" htmlFor={`newsletter-${source}`}>
        Email address
      </label>
      <Input
        id={`newsletter-${source}`}
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="email@domain.com"
        autoComplete="email"
        className="h-9 rounded-none border-row-border bg-background/50 font-mono text-xs"
        required
      />
      <Button
        type="submit"
        size="sm"
        className="h-9 rounded-none bg-pink-500 text-white hover:bg-pink-500/90"
        disabled={pending}
      >
        <Send aria-hidden="true" />
        {pending ? "Sending" : "Subscribe"}
      </Button>
      {message ? (
        <p
          className={cn(
            "font-mono text-[10px] uppercase text-muted-foreground",
            variant === "footer" ? "col-span-2" : "sm:col-span-2",
          )}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
