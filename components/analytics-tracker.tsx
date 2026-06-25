"use client";

import { convexRefs } from "@/lib/convex-refs";
import { useMutation } from "convex/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

const VISITOR_KEY = "symbaiex:analytics:visitor";
const SESSION_KEY = "symbaiex:analytics:session";
const SESSION_AT_KEY = "symbaiex:analytics:sessionAt";
const SESSION_TTL_MS = 30 * 60 * 1000;

export function AnalyticsTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const record = useMutation(convexRefs.analytics.record);
  const previousPathRef = useRef<string | null>(null);
  const path = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  useEffect(() => {
    const ids = analyticsIds();
    const referrer = previousPathRef.current ?? document.referrer;
    previousPathRef.current = path;

    void record({
      name: "page_view",
      path,
      route: pathname,
      title: document.title,
      referrer: referrer || undefined,
      sessionId: ids.sessionId,
      visitorId: ids.visitorId,
      userAgent: navigator.userAgent,
      device: `${window.innerWidth}x${window.innerHeight}`,
      metadataJson: JSON.stringify({
        colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
      }),
    }).catch((error) => {
      if (process.env.NODE_ENV === "development") {
        console.warn("Analytics record failed", error);
      }
    });
  }, [path, pathname, record]);

  return null;
}

function analyticsIds() {
  const now = Date.now();
  const visitorId = getOrCreateStorageValue(VISITOR_KEY, "vis");
  const lastSessionAt = Number(window.localStorage.getItem(SESSION_AT_KEY) ?? 0);
  let sessionId = window.localStorage.getItem(SESSION_KEY);

  if (!sessionId || !Number.isFinite(lastSessionAt) || now - lastSessionAt > SESSION_TTL_MS) {
    sessionId = randomToken("ses");
    window.localStorage.setItem(SESSION_KEY, sessionId);
  }

  window.localStorage.setItem(SESSION_AT_KEY, String(now));
  return { visitorId, sessionId };
}

function getOrCreateStorageValue(key: string, prefix: string) {
  const existing = window.localStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const next = randomToken(prefix);
  window.localStorage.setItem(key, next);
  return next;
}

function randomToken(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}
