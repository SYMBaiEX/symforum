"use client";

import { shouldSendVercelAnalyticsEvent } from "@/lib/analytics-privacy";
import { Analytics } from "@vercel/analytics/next";

/** Keeps the callback on the client side instead of crossing the RSC boundary. */
export function VercelAnalytics() {
  return (
    <Analytics
      beforeSend={(event) =>
        shouldSendVercelAnalyticsEvent(event.url) ? event : null
      }
    />
  );
}
