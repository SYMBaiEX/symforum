// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/image", () => ({ default: () => null }));
import { ForumGroupedBoards } from "./forum-grouped-boards";
import type { ForumOverviewRecord } from "./forum-refs";

test("grouped board rows keep subforums, actual counts, read-state and latest-post links on the forum host", () => {
  const overview = {
    categories: [],
    totals: { categories: 1, threads: 5, posts: 12 },
    sections: [
      {
        section: { slug: "community", name: "Community" },
        boards: [
          {
            slug: "general",
            name: "General",
            description: "A place to talk",
            threadCount: 5,
            postCount: 12,
            viewerUnread: false,
            children: [
              {
                slug: "introductions",
                name: "Introductions",
                viewerUnread: true,
              },
            ],
            lastThread: {
              slug: "hello",
              title: "Hello everyone",
              categorySlug: "introductions",
              lastPostNumber: 26,
              lastPostPage: 2,
              lastPostAt: 1000,
              lastPostAuthorName: "Austin",
            },
          },
        ],
      },
    ],
  } as unknown as ForumOverviewRecord;
  const html = renderToStaticMarkup(<ForumGroupedBoards overview={overview} />);
  expect(html).toContain("Community");
  expect(html).toContain("A place to talk");
  expect(html).toContain('aria-label="Unread board"');
  expect(html).toContain('href="/introductions"');
  expect(html).toContain('href="/introductions/hello?postPage=2#post-26"');
  expect(html).toContain("Austin");
  expect(html).toContain("threads");
  expect(html).not.toContain("divide-y");
});
