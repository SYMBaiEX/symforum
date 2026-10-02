"use client";

import { convexRefs } from "@/lib/convex-refs";
import { getBrowserStorage } from "@/lib/browser-storage";
import { isPrivateAnalyticsPath } from "@/lib/analytics-privacy";
import {
  ANALYTICS_DEDUPE_WINDOW_MS,
  claimAnalyticsAttempt,
  releaseAnalyticsAttempt,
} from "@/lib/analytics-attempt-throttle";
import { useMutation } from "convex/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

const VISITOR_KEY = "symbaiex:analytics:visitor";
const SESSION_KEY = "symbaiex:analytics:session";
const SESSION_AT_KEY = "symbaiex:analytics:sessionAt";
const SESSION_TTL_MS = 30 * 60 * 1000;
const AUTOMATION_USER_AGENT =
  /(?:bot|crawler|spider|slurp|lighthouse|pagespeed|headlesschrome|adidx)/i;

export function AnalyticsTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const record = useMutation(convexRefs.analytics.record);
  const previousPathRef = useRef<string | null>(null);
  const attemptsRef = useRef<Map<string, number>>(new Map());
  const path = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (
      !shouldRecordClientAnalytics({
        pathname,
        doNotTrack: navigator.doNotTrack,
        userAgent: navigator.userAgent,
        webdriver: navigator.webdriver,
      })
    ) {
      return;
    }
    const ids = analyticsIds();
    if (ids === null) {
      return;
    }
    const referrer = previousPathRef.current ?? document.referrer;
    previousPathRef.current = path;

    // The mutation also dedupes by session + route. Avoid making a second
    // network request when React replays the same effect inside that window.
    const eventKey = JSON.stringify(["page_view", ids.sessionId, pathname]);
    const attemptedAt = Date.now();
    if (!claimAnalyticsAttempt(attemptsRef.current, eventKey, attemptedAt)) {
      return;
    }

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
      releaseAnalyticsAttempt(attemptsRef.current, eventKey, attemptedAt);
      if (process.env.NODE_ENV === "development") {
        console.warn("Analytics record failed", error);
      }
    });
  }, [path, pathname, record]);

  return null;
}

export function shouldRecordClientAnalytics({
  pathname,
  doNotTrack,
  userAgent,
  webdriver,
}: {
  pathname: string;
  doNotTrack?: string | null;
  userAgent: string;
  webdriver?: boolean;
}) {
  if (doNotTrack === "1" || webdriver === true) {
    return false;
  }
  if (AUTOMATION_USER_AGENT.test(userAgent)) {
    return false;
  }
  return !isPrivateAnalyticsPath(pathname);
}

function analyticsIds() {
  const storage = getBrowserStorage("localStorage");
  if (storage === null) {
    return null;
  }

  const now = Date.now();
  try {
    const visitorId = getOrCreateStorageValue(storage, VISITOR_KEY, "vis");
    const lastSessionAt = Number(storage.getItem(SESSION_AT_KEY) ?? 0);
    let sessionId = storage.getItem(SESSION_KEY);

    if (
      !sessionId ||
      !Number.isFinite(lastSessionAt) ||
      now - lastSessionAt > SESSION_TTL_MS
    ) {
      sessionId = randomToken("ses");
      storage.setItem(SESSION_KEY, sessionId);
    }

    storage.setItem(SESSION_AT_KEY, String(now));
    return { visitorId, sessionId };
  } catch {
    return null;
  }
}

function getOrCreateStorageValue(
  storage: Storage,
  key: string,
  prefix: string,
) {
  const existing = storage.getItem(key);
  if (existing) {
    return existing;
  }
  const next = randomToken(prefix);
  storage.setItem(key, next);
  return next;
}

function randomToken(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}
