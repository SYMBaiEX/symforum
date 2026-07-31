"use client";

import { convexRefs } from "@/lib/convex-refs";
import { useMutation } from "convex/react";
import { useEffect } from "react";

const VISITOR_KEY = "symbaiex-newsletter-visitor";

export function NewsletterIssueViewTracker({ slug }: { slug: string }) {
  const record = useMutation(convexRefs.newsletter.recordPublicEngagement);

  useEffect(() => {
    let visitorKey = window.localStorage.getItem(VISITOR_KEY);
    if (!visitorKey) {
      visitorKey = crypto.randomUUID();
      window.localStorage.setItem(VISITOR_KEY, visitorKey);
    }
    void record({
      slug,
      eventType: "archive_view",
      visitorKey,
    }).catch(() => undefined);
  }, [record, slug]);

  return null;
}
