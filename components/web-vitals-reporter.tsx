"use client";

import { convexRefs } from "@/lib/convex-refs";
import {
  isWebVitalsEnabled,
  publicRouteTemplate,
  type WebVitalMetricName,
  type WebVitalNavigationType,
  type WebVitalRating,
} from "@/lib/web-vitals";
import { useMutation } from "convex/react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";

const SAMPLE_RATE = 0.1;

export function WebVitalsReporter() {
  const pathname = usePathname();
  const record = useMutation(convexRefs.webVitals.record);

  useReportWebVitals((metric) => {
    if (
      !isWebVitalsEnabled(process.env.NEXT_PUBLIC_WEB_VITALS_ENABLED) ||
      Math.random() >= SAMPLE_RATE
    ) {
      return;
    }
    const route = publicRouteTemplate(pathname);
    if (route === null || !isKnownMetric(metric.name)) return;
    void record({
      route,
      name: metric.name,
      value: metric.value,
      rating: metric.rating as WebVitalRating,
      navigationType: metric.navigationType as WebVitalNavigationType,
      timestamp: Date.now(),
    });
  });

  return null;
}

function isKnownMetric(name: string): name is WebVitalMetricName {
  return ["LCP", "INP", "CLS", "FCP", "TTFB"].includes(name);
}
