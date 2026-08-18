import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

import { WEB_VITAL_BUDGETS, publicRouteTemplate } from "./web-vitals";

describe("Web Vitals privacy boundary", () => {
  test("reduces public dynamic paths to route templates", () => {
    expect(publicRouteTemplate("/blog/release-notes?ref=private")).toBe(
      "/blog/[slug]",
    );
    expect(publicRouteTemplate("/forum/ai/prompt-patterns")).toBe(
      "/forum/[categorySlug]/[threadSlug]",
    );
    expect(publicRouteTemplate("/forum/announcements/release")).toBe(
      "/forum/announcements/[slug]",
    );
    expect(publicRouteTemplate("/u/symbaiex")).toBe("/u/[username]");
  });

  test("rejects private and unknown paths", () => {
    expect(publicRouteTemplate("/admin/telemetry")).toBeNull();
    expect(publicRouteTemplate("/newsletter/confirm")).toBeNull();
    expect(publicRouteTemplate("/unknown/private-value")).toBeNull();
  });

  test("publishes explicit Core Web Vitals budgets", () => {
    expect(WEB_VITAL_BUDGETS).toEqual({
      LCP: 2_500,
      INP: 200,
      CLS: 0.1,
      FCP: 1_800,
      TTFB: 800,
    });
  });

  test("registers one stable reporter while reading the latest route from refs", () => {
    const source = readFileSync(
      new URL("../components/web-vitals-reporter.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("const reportWebVital = useCallback<WebVitalsCallback>");
    expect(source).toContain("useReportWebVitals(reportWebVital)");
    expect(source).toContain("pathnameRef.current");
    expect(source).toContain("recordRef.current");
  });
});
