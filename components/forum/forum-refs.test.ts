import { afterEach, describe, expect, test, vi } from "vitest";

import {
  adjacentForumCalendarMonth,
  forumCalendarMonthFromDate,
  forumMemberProfilePath,
  getRenderablePosts,
  normalizeForumCalendarMonthParam,
} from "./forum-refs";

describe("forum calendar refs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("normalizes invalid and pre-1970 months to the current forum month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));

    expect(normalizeForumCalendarMonthParam("1969-12")).toBe("2026-07");
    expect(normalizeForumCalendarMonthParam("1970-00")).toBe("2026-07");
    expect(normalizeForumCalendarMonthParam("not-a-month")).toBe("2026-07");
  });

  test("returns null when adjacent month navigation crosses the supported range", () => {
    expect(adjacentForumCalendarMonth("1970-01", -1)).toBeNull();
    expect(adjacentForumCalendarMonth("1970-01", 1)).toBe("1970-02");
  });

  test("uses the forum timezone for month fallback boundaries", () => {
    expect(
      forumCalendarMonthFromDate(new Date("2026-07-01T00:30:00.000Z")),
    ).toBe("2026-06");
  });

  test("builds forum-native member profile paths", () => {
    expect(forumMemberProfilePath("Austin Hamilton")).toBe(
      "/forum/members/Austin%20Hamilton",
    );
  });

  test("preserves root-post author presentation details", () => {
    const [rootPost] = getRenderablePosts(
      {
        _id: "thread-1",
        slug: "signal-log",
        title: "Signal log",
        body: "Thread body",
        author: "Suki",
        authorImage: "/images/forum/suki-space-pirate.png",
        authorLocation: "The Info Sea",
        authorJoinedAt: 1_754_000_000_000,
        createdAt: 1_754_000_000_000,
      },
      [],
    );

    expect(rootPost).toMatchObject({
      author: "Suki",
      authorImage: "/images/forum/suki-space-pirate.png",
      authorLocation: "The Info Sea",
    });
  });
});
