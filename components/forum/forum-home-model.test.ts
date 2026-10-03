import { expect, test, vi } from "vitest";
import {
  forumHomeHref,
  mergeFeedItems,
  refreshLoadedFeed,
  resolveForumFeedSort,
  resolveForumHomeView,
} from "./forum-home-model";
import { forumHrefForPathname } from "./forum-refs";

test("view navigation accepts only supported views and preserves sort on either forum host", () => {
  expect(resolveForumHomeView("news")).toBe("news");
  expect(resolveForumHomeView("community")).toBe("community");
  expect(resolveForumHomeView()).toBe("boards");
  expect(resolveForumHomeView(["news", "boards"])).toBe("boards");
  expect(resolveForumHomeView("fake-for-you")).toBe("boards");
  expect(resolveForumFeedSort("new")).toBe("new");
  expect(resolveForumFeedSort("fake-top")).toBe("active");
  const href = forumHomeHref("community", "new");
  expect(forumHrefForPathname(href, "/forum")).toBe(
    "/forum?view=community&sort=new",
  );
  expect(forumHrefForPathname(href, "/")).toBe("/?view=community&sort=new");
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
