import { expect, test, vi } from "vitest";
import {
  forumHomeHref,
  mergeFeedItems,
  refreshLoadedFeed,
  restoreLoadedFeed,
  resolveForumFeedSort,
  resolveForumHomeView,
} from "./forum-home-model";
import { forumHrefForPathname } from "./forum-refs";

test("view navigation accepts only supported views and preserves sort on either forum host", () => {
  expect(resolveForumHomeView("news")).toBe("news");
  expect(resolveForumHomeView("community")).toBe("community");
  expect(resolveForumHomeView()).toBe("feed");
  expect(resolveForumHomeView(["news", "boards"])).toBe("feed");
  expect(resolveForumHomeView("fake-for-you")).toBe("feed");
  expect(resolveForumFeedSort("new")).toBe("new");
  expect(resolveForumFeedSort("fake-top")).toBe("active");
  const href = forumHomeHref("community", "new");
  expect(forumHrefForPathname(href, "/forum")).toBe(
    "/forum?view=community&sort=new",
  );
  expect(forumHrefForPathname(href, "/")).toBe("/?view=community&sort=new");
  expect(forumHrefForPathname("/forum/stories/50002008", "/news", true)).toBe(
    "/forum/stories/50002008",
  );
});

test("cursor overlap does not duplicate articles or replace their loaded state", () => {
  const original = { _id: "one", title: "Original" };
  expect(
    mergeFeedItems(
      [original],
      [
        { _id: "one", title: "Changed" },
        { _id: "two", title: "Second" },
        { _id: "two", title: "Duplicate" },
      ],
    ),
  ).toEqual([original, { _id: "two", title: "Second" }]);
});

test("refresh rebuilds loaded pages including an empty visibility-filtered page", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      page: [{ _id: "first" }],
      continueCursor: "second",
      isDone: false,
    })
    .mockResolvedValueOnce({ page: [], continueCursor: "third", isDone: false })
    .mockResolvedValueOnce({
      page: [{ _id: "first" }, { _id: "last" }],
      continueCursor: "end",
      isDone: true,
    });
  const result = await refreshLoadedFeed(query, 3);
  expect(query.mock.calls).toEqual([[null], ["second"], ["third"]]);
  expect(result).toEqual({
    page: [{ _id: "first" }, { _id: "last" }],
    continueCursor: "end",
    isDone: true,
  });
});

test("refresh fails atomically if a later page fails and stops at terminal pages", async () => {
  const original = {
    page: [{ _id: "loaded" }],
    continueCursor: "saved",
    isDone: false,
  };
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      page: [{ _id: "updated" }],
      continueCursor: "second",
      isDone: false,
    })
    .mockRejectedValueOnce(new Error("offline"));
  await expect(refreshLoadedFeed(query, 2)).rejects.toThrow("offline");
  expect(original).toEqual({
    page: [{ _id: "loaded" }],
    continueCursor: "saved",
    isDone: false,
  });
  const done = vi
    .fn()
    .mockResolvedValue({ page: [], continueCursor: "end", isDone: true });
  await refreshLoadedFeed(done, 5);
  expect(done).toHaveBeenCalledTimes(1);
});

test("initial restoration publishes the first authorized page before a later page resolves", async () => {
  type Page = {
    page: { _id: string }[];
    continueCursor: string;
    isDone: boolean;
  };
  let complete!: (page: Page) => void;
  const next = new Promise<Page>((resolve) => {
    complete = resolve;
  });
  const first: Page = {
    page: [{ _id: "first" }],
    continueCursor: "second",
    isDone: false,
  };
  const query = vi.fn().mockResolvedValueOnce(first).mockReturnValueOnce(next);
  const publish = vi.fn();
  const restoration = restoreLoadedFeed(query, 2, publish, () => true);
  await Promise.resolve();
  expect(publish).toHaveBeenCalledExactlyOnceWith(first, 1);
  expect(query.mock.calls).toEqual([[null], ["second"]]);
  complete({
    page: [{ _id: "first" }, { _id: "last" }],
    continueCursor: "end",
    isDone: true,
  });
  const result = await restoration;
  expect(result?.page).toEqual([{ _id: "first" }, { _id: "last" }]);
  expect(publish).toHaveBeenLastCalledWith(result, 2);
});

test("a later initial-restore failure leaves the last published page and recovery cursor intact", async () => {
  const first = {
    page: [{ _id: "retained" }],
    continueCursor: "retry-second",
    isDone: false,
  };
  const query = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockRejectedValueOnce(new Error("offline"));
  const publish = vi.fn();
  await expect(
    restoreLoadedFeed(query, 3, publish, () => true),
  ).rejects.toThrow("offline");
  expect(publish).toHaveBeenCalledExactlyOnceWith(first, 1);
  expect(query.mock.calls).toEqual([[null], ["retry-second"]]);
});

test("initial restore counts empty filtered pages and stops at the real terminal cursor", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      page: [],
      continueCursor: "visible",
      isDone: false,
    })
    .mockResolvedValueOnce({
      page: [{ _id: "visible" }],
      continueCursor: "end",
      isDone: true,
    });
  const publish = vi.fn();
  const result = await restoreLoadedFeed(query, 20, publish, () => true);
  expect(query).toHaveBeenCalledTimes(2);
  expect(publish).toHaveBeenNthCalledWith(
    1,
    { page: [], continueCursor: "visible", isDone: false },
    1,
  );
  expect(publish).toHaveBeenLastCalledWith(result, 2);
});

test("cancellation fences an in-flight initial page before publishing or requesting more", async () => {
  type Page = {
    page: { _id: string }[];
    continueCursor: string;
    isDone: boolean;
  };
  let complete!: (page: Page) => void;
  let current = true;
  const query = vi.fn(
    () =>
      new Promise<Page>((resolve) => {
        complete = resolve;
      }),
  );
  const publish = vi.fn();
  const restoration = restoreLoadedFeed(query, 3, publish, () => current);
  current = false;
  complete({
    page: [{ _id: "previous-account" }],
    continueCursor: "private-next",
    isDone: false,
  });
  expect(await restoration).toBeUndefined();
  expect(publish).not.toHaveBeenCalled();
  expect(query).toHaveBeenCalledExactlyOnceWith(null);
});

test("initial restore stops pagination immediately after its generation becomes obsolete", async () => {
  let current = true;
  const query = vi
    .fn()
    .mockResolvedValue({
      page: [{ _id: "first" }],
      continueCursor: "second",
      isDone: false,
    });
  const publish = vi.fn(() => {
    current = false;
  });
  expect(
    await restoreLoadedFeed(query, 3, publish, () => current),
  ).toBeUndefined();
  expect(query).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledTimes(1);
});

test("initial restore cannot exceed the existing twenty-page reading-place bound", async () => {
  const query = vi.fn(async () => ({
    page: [],
    continueCursor: "next",
    isDone: false,
  }));
  const publish = vi.fn();
  await restoreLoadedFeed(query, 999, publish, () => true);
  expect(query).toHaveBeenCalledTimes(20);
  expect(publish).toHaveBeenLastCalledWith(
    { page: [], continueCursor: "next", isDone: false },
    20,
  );
});
