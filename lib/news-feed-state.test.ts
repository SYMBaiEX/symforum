import { describe, expect, test } from "vitest";

import { emptyNewsFeedState } from "./news-feed-state";

describe("emptyNewsFeedState", () => {
  test("stops showing loading after an empty query resolves", () => {
    expect(
      emptyNewsFeedState({
        queryResolved: false,
        fallbackStoryCount: 0,
      }),
    ).toBe("loading");
    expect(
      emptyNewsFeedState({
        queryResolved: true,
        fallbackStoryCount: 0,
      }),
    ).toBe("unavailable");
  });

  test("uses fallback stories only for the latest news view", () => {
    expect(
      emptyNewsFeedState({
        queryResolved: true,
        fallbackStoryCount: 3,
      }),
    ).toBe("fallback");
    expect(
      emptyNewsFeedState({
        queryResolved: true,
        fallbackStoryCount: 3,
        selectedDate: "2026-09-09",
      }),
    ).toBe("unavailable");
  });
});
