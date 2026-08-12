"use client";

import { convexRefs } from "@/lib/convex-refs";
import { getBrowserStorage } from "@/lib/browser-storage";
import { useMutation } from "convex/react";
import { useEffect } from "react";

const VISITOR_KEY = "symbaiex-newsletter-visitor";

export function NewsletterIssueViewTracker({ slug }: { slug: string }) {
  const record = useMutation(convexRefs.newsletter.recordPublicEngagement);

  useEffect(() => {
    const storage = getBrowserStorage("localStorage");
    let visitorKey: string | null = null;
    try {
      visitorKey = storage?.getItem(VISITOR_KEY) ?? null;
      if (!visitorKey) {
        visitorKey = crypto.randomUUID();
        storage?.setItem(VISITOR_KEY, visitorKey);
      }
    } catch {
      visitorKey = crypto.randomUUID();
    }
    void record({
      slug,
      eventType: "archive_view",
      visitorKey,
    }).catch(() => undefined);
  }, [record, slug]);

  return null;
}
