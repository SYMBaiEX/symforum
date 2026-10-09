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
  const [result, setResult] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const webMcpFormAttributes =
    variant === "footer"
      ? {
          toolname: "subscribe_symbaiex_newsletter",
          tooldescription:
            "Prepare a SYMBaiEX newsletter subscription using the email address the user provides. The user must review and manually submit the visible form.",
        }
      : {};
  const webMcpEmailAttributes =
    variant === "footer"
      ? {
          toolparamdescription:
            "Email address to subscribe after the user reviews and submits the visible form.",
        }
      : {};

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult(null);
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
      setResult({
        text: payload.message ?? "Check your inbox to confirm.",
        isError: false,
      });
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
      setResult({
        text: error instanceof Error ? error.message : "Could not subscribe",
        isError: true,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      {...webMcpFormAttributes}
      onSubmit={subscribe}
      className={cn(
        "grid gap-2",
        variant === "footer"
          ? "relative grid-cols-[minmax(0,1fr)_auto]"
          : "grid-cols-1",
        className,
      )}
    >
      <label className="sr-only" htmlFor={`newsletter-${source}`}>
        Email address
      </label>
      <Input
        {...webMcpEmailAttributes}
        id={`newsletter-${source}`}
        name="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Sign up for Newsletter"
        autoComplete="email"
        className="h-9 w-full rounded-lg border-border bg-background/70 font-mono text-xs"
        required
      />
      <Button
        type="submit"
        size="sm"
        className={cn(
          "forum-primary-action h-9 rounded-lg",
          variant === "footer" ? "sm:px-2.5" : "w-full dark:!text-white",
        )}
        disabled={pending}
        aria-label={pending ? "Sending subscription" : "Subscribe"}
      >
        <Send aria-hidden="true" />
        <span className={cn(variant === "footer" && "hidden sm:inline")}>
          {pending ? "Sending" : "Subscribe"}
        </span>
      </Button>
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "min-h-4 font-mono text-[10px] uppercase",
          result?.isError ? "text-destructive" : "text-muted-foreground",
          variant === "footer"
            ? result
              ? "absolute bottom-[calc(100%+0.5rem)] left-0 z-10 max-w-full border border-row-border bg-background px-2 py-1 shadow-sm"
              : "sr-only"
            : "col-span-full",
        )}
      >
        {result?.text ?? ""}
      </p>
    </form>
  );
}
