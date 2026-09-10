import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getNewsPageData } from "./news-data";

describe("getNewsPageData", () => {
  test("does not call the live Hacker News fallback when indexed stories exist", async () => {
    const timeline = {
      snapshot: null,
      snapshots: [],
      stories: [{ hnItemId: 1, title: "Indexed story" }],
    } as never;
    const getFallback = vi.fn(async () => []);

    await expect(
      getNewsPageData(30, {
        getTimeline: async () => timeline,
        getFallback,
      }),
    ).resolves.toEqual({ initialTimeline: timeline, initialStories: [] });
    expect(getFallback).not.toHaveBeenCalled();
  });

  test("uses a bounded live fallback when the indexed timeline is empty", async () => {
    const fallback = [{ hnItemId: 2, title: "Live story" }] as never;
    const getFallback = vi.fn(async () => fallback);

    await expect(
      getNewsPageData(12, {
        getTimeline: async () => null,
        getFallback,
      }),
    ).resolves.toEqual({ initialTimeline: null, initialStories: fallback });
    expect(getFallback).toHaveBeenCalledWith(12);
  });
});
