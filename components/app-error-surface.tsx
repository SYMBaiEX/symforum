"use client";

import { getBrowserStorage } from "@/lib/browser-storage";
import { isServiceAuthSensitiveLocation } from "@/lib/agent-service-auth-config";
import { convexRefs, type SystemLogRecord } from "@/lib/convex-refs";
import { useMutation } from "convex/react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
import { toast, Toaster } from "sonner";

type AppErrorLevel = SystemLogRecord["level"];
type AppErrorSource = SystemLogRecord["source"];

type AppErrorContext = {
  level?: AppErrorLevel;
  source?: AppErrorSource;
  scope?: string;
  eventType?: string;
  message?: string;
  component?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  notify?: boolean;
};

type NormalizedError = {
  name?: string;
  message: string;
  stack?: string;
};

const APP_ERROR_EVENT = "symbaiex:error";
const SESSION_KEY = "symbaiex:error-session";
const TOAST_DEDUPE_MS = 8_000;
const RECENT_TOASTS = new Map<string, number>();

export function AppErrorSurface() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <GlobalToaster />;
  }

  return <LiveAppErrorSurface />;
}

function LiveAppErrorSurface() {
  const pathname = usePathname();
  const recordLog = useMutation(convexRefs.systemLogs.record);
  const sessionId = useMemo(() => getSessionId(), []);

  useEffect(() => {
    function capture(error: unknown, context: AppErrorContext = {}) {
      // Check live location on every event: same-path search-only navigation
      // does not reinstall this effect. Never log the bearer attempt handle.
      if (
        isServiceAuthSensitiveLocation(
          window.location.pathname,
          window.location.search,
        )
      )
        return;
      const normalized = normalizeError(error, context.message);

      if (isIgnorableError(normalized, context)) {
        return;
      }

      const metadataJson = context.metadata
        ? safeStringify(context.metadata)
        : undefined;
      const path =
        typeof window !== "undefined"
          ? window.location.pathname
          : (pathname ?? undefined);
      const url =
        typeof window !== "undefined" ? window.location.href : undefined;
      const fingerprint = [
        context.source ?? "client",
        context.scope ?? "ui",
        context.eventType ?? "runtime_error",
        path ?? "",
        normalized.message.slice(0, 180),
      ].join("|");

      void recordLog(
        withoutUndefined({
          level: context.level ?? "error",
          source: context.source ?? "client",
          scope: context.scope ?? "ui",
          eventType: context.eventType ?? "runtime_error",
          message: normalized.message,
          name: normalized.name,
          stack: normalized.stack,
          fingerprint,
          path,
          url,
          sessionId,
          userAgent:
            typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          component: context.component,
          action: context.action,
          entityType: context.entityType,
          entityId: context.entityId,
          metadataJson,
        }),
      ).catch(() => {
        // Avoid recursive failures if the log write itself is unavailable.
      });

      if (context.notify !== false) {
        showErrorToast(normalized.message, fingerprint);
      }
    }

    function onWindowError(event: ErrorEvent) {
      capture(event.error ?? event.message, {
        scope: "browser",
        eventType: "window_error",
        metadata: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      capture(event.reason, {
        scope: "promise",
        eventType: "unhandled_rejection",
      });
    }

    function onAppError(event: Event) {
      const detail = (event as CustomEvent<AppErrorDetail>).detail;
      if (!detail) {
        return;
      }
      capture(detail.error, detail.context);
    }

    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener(APP_ERROR_EVENT, onAppError as EventListener);

    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener(APP_ERROR_EVENT, onAppError as EventListener);
    };
  }, [pathname, recordLog, sessionId]);

  return <GlobalToaster />;
}

function GlobalToaster() {
  return (
    <Toaster
      position="top-right"
      offset="calc(var(--site-header-offset, 4rem) + 0.75rem)"
      toastOptions={{
        classNames: {
          toast:
            "rounded-none border-row-border bg-background text-foreground shadow-none",
          title: "font-mono text-[11px] uppercase tracking-normal",
          description: "text-xs text-muted-foreground",
          actionButton: "rounded-none bg-primary text-primary-foreground",
          cancelButton: "rounded-none border border-row-border bg-background",
        },
      }}
    />
  );
}

type AppErrorDetail = {
  error: unknown;
  context?: AppErrorContext;
};

export function reportAppError(error: unknown, context: AppErrorContext = {}) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<AppErrorDetail>(APP_ERROR_EVENT, {
      detail: { error, context },
    }),
  );
}

function showErrorToast(message: string, fingerprint: string) {
  const now = Date.now();
  const lastSeen = RECENT_TOASTS.get(fingerprint) ?? 0;
  if (now - lastSeen < TOAST_DEDUPE_MS) {
    return;
  }
  RECENT_TOASTS.set(fingerprint, now);
  toast.error("Issue logged", {
    description: message.slice(0, 160),
  });
}

function normalizeError(error: unknown, fallback?: string): NormalizedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message || fallback || "Unexpected application error",
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return {
      message: error || fallback || "Unexpected application error",
    };
  }
  if (isRecord(error) && typeof error.message === "string") {
    return {
      name: typeof error.name === "string" ? error.name : undefined,
      message: error.message || fallback || "Unexpected application error",
      stack: typeof error.stack === "string" ? error.stack : undefined,
    };
  }
  return {
    message: fallback || "Unexpected application error",
  };
}

function isIgnorableError(error: NormalizedError, context: AppErrorContext) {
  const haystack = [
    error.name,
    error.message,
    error.stack,
    context.scope,
    context.eventType,
    context.component,
    context.action,
    context.metadata ? safeStringify(context.metadata) : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    /\bAbortError\b/i.test(haystack) ||
    /chrome-extension:\/\//i.test(haystack) ||
    /moz-extension:\/\//i.test(haystack) ||
    /safari-extension:\/\//i.test(haystack) ||
    /contentscript\.js/i.test(haystack) ||
    /MaxListenersExceededWarning/i.test(haystack) ||
    /ObjectMultiplex/i.test(haystack) ||
    /app-init-liveness|background-liveness/i.test(haystack)
  );
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, (_key, nextValue) => {
      if (typeof nextValue === "function") {
        return "[function]";
      }
      if (nextValue instanceof Error) {
        return {
          name: nextValue.name,
          message: nextValue.message,
          stack: nextValue.stack,
        };
      }
      return nextValue;
    }).slice(0, 2_000);
  } catch {
    return undefined;
  }
}

function getSessionId() {
  if (typeof window === "undefined") {
    return "server";
  }

  const storage = getBrowserStorage("sessionStorage");
  const value =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (storage === null) {
    return value;
  }

  try {
    const existing = storage.getItem(SESSION_KEY);
    if (existing) {
      return existing;
    }
    storage.setItem(SESSION_KEY, value);
  } catch {
    return value;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as T;
}
