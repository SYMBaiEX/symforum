import { describe, expect, test } from "vitest";

import { shouldRecordClientAnalytics } from "./analytics-tracker";

describe("client analytics privacy gate", () => {
  test("records ordinary public navigation", () => {
    expect(
      shouldRecordClientAnalytics({
        pathname: "/research",
        userAgent: "Mozilla/5.0 Safari/605.1.15",
      }),
    ).toBe(true);
  });

  test("respects do-not-track and browser automation", () => {
    expect(
      shouldRecordClientAnalytics({
        pathname: "/",
        doNotTrack: "1",
        userAgent: "Mozilla/5.0",
      }),
    ).toBe(false);
    expect(
      shouldRecordClientAnalytics({
        pathname: "/",
        userAgent: "Mozilla/5.0",
        webdriver: true,
      }),
    ).toBe(false);
  });

  test("does not retain crawlers or private site and forum navigation", () => {
    for (const pathname of [
      "/admin/evidence",
      "/profile",
      "/newsletter/preferences",
      "/forum/messages",
      "/messages/thread-1",
      "/search",
    ]) {
      expect(
        shouldRecordClientAnalytics({
          pathname,
          userAgent: "Mozilla/5.0",
        }),
      ).toBe(false);
    }
    expect(
      shouldRecordClientAnalytics({
        pathname: "/",
        userAgent: "Mozilla/5.0 (compatible; adidxbot/2.0)",
      }),
    ).toBe(false);
  });
});
