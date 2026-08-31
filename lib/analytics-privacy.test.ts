import { describe, expect, test } from "vitest";

import {
  isPrivateAnalyticsPath,
  shouldSendVercelAnalyticsEvent,
} from "./analytics-privacy";

describe("analytics privacy routes", () => {
  test("keeps ordinary public routes eligible for analytics", () => {
    expect(isPrivateAnalyticsPath("/research")).toBe(false);
    expect(shouldSendVercelAnalyticsEvent("/forum/announcements")).toBe(true);
  });

  test("excludes private owner, auth, and message routes", () => {
    for (const pathname of [
      "/admin/analytics",
      "/signin?next=/admin",
      "/forum/messages/thread-1",
      "/messages/thread-1",
      "/newsletter/preferences",
    ]) {
      expect(isPrivateAnalyticsPath(pathname)).toBe(true);
      expect(
        shouldSendVercelAnalyticsEvent(
          `https://www.symbaiex.com${pathname}`,
        ),
      ).toBe(false);
    }
  });
});
