// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(() => undefined) }));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
  useMutation: () => vi.fn(),
  useQuery: mocks.query,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/image", () => ({ default: () => null }));

import { NewsFeed } from "./news-feed";
import { convexRefs } from "@/lib/convex-refs";

test("uses the server timeline snapshot without a duplicate client subscription", () => {
  const initialTimeline = {
    snapshots: [],
    snapshot: {
      _id: "snapshot-1",
      _creationTime: 1,
      snapshotDate: "2026-10-02",
      status: "complete" as const,
      startedAt: 1,
      storyCount: 0,
    },
    stories: [],
  };

  renderToStaticMarkup(
    <NewsFeed enabled initialStories={[]} initialTimeline={initialTimeline} />,
  );

  expect(mocks.query).toHaveBeenCalledWith(convexRefs.news.timeline, "skip");
  expect(mocks.query).not.toHaveBeenCalledWith(convexRefs.news.timeline, {});
});

test("shows the live fallback for a successful empty timeline without re-querying it", () => {
  mocks.query.mockClear();
  const initialTimeline = {
    snapshots: [],
    snapshot: null,
    stories: [],
  };
  const initialStories = [
    { hnItemId: 7, rank: 1, title: "Live fallback story" },
  ];

  const html = renderToStaticMarkup(
    <NewsFeed
      enabled
      initialStories={initialStories}
      initialTimeline={initialTimeline}
    />,
  );

  expect(html).toContain("Live fallback story");
  expect(mocks.query).toHaveBeenCalledWith(convexRefs.news.timeline, "skip");
  expect(mocks.query).not.toHaveBeenCalledWith(convexRefs.news.timeline, {});
});

test("keeps the browser retry when the server timeline was unavailable", () => {
  mocks.query.mockClear();
  const html = renderToStaticMarkup(
    <NewsFeed
      enabled
      initialStories={[
        { hnItemId: 8, rank: 1, title: "Fallback while retrying" },
      ]}
      initialTimeline={null}
    />,
  );

  expect(html).toContain("Fallback while retrying");
  expect(mocks.query).toHaveBeenCalledWith(convexRefs.news.timeline, {});
});

test("keeps Hacker News activity separate from SYMBaiEX interactions", () => {
  const html = renderToStaticMarkup(
    <NewsFeed
      enabled={false}
      initialStories={[
        {
          hnItemId: 42,
          rank: 1,
          title: "An interesting story",
          host: "example.com",
          url: "https://example.com/story",
          score: 321,
          descendants: 87,
          platformStats: { score: 4, comments: 2, saves: 1 },
        },
      ]}
    />,
  );

  expect(html).toContain("321 HN points");
  expect(html).toContain("87 HN comments");
  expect(html).toContain("4 SYMBaiEX votes");
  expect(html).toContain("2 SYMBaiEX comments");
  expect(html).toContain(
    'href="https://www.symbaiex.com/news/an-interesting-story-42"',
  );
  expect(html).toContain('href="https://example.com/story"');
  expect(html).toContain('rel="noopener noreferrer"');
});

test("does not invent missing HN activity or turn unsafe sources into links", () => {
  const html = renderToStaticMarkup(
    <NewsFeed
      enabled={false}
      initialStories={[
        {
          hnItemId: 43,
          rank: 2,
          title: "A story with no counts",
          url: "javascript:alert(1)",
        },
      ]}
    />,
  );

  expect(html).toContain("Discuss on SYMBaiEX");
  expect(html).not.toContain("HN points");
  expect(html).not.toContain("HN comments");
  expect(html).not.toContain("Read source");
  expect(html).not.toContain("javascript:");
});

test("labels interactive votes as local community votes rather than HN votes", () => {
  mocks.query.mockClear();
  const html = renderToStaticMarkup(
    <NewsFeed
      enabled
      initialStories={[]}
      initialTimeline={{
        snapshots: [],
        snapshot: null,
        stories: [
          { hnItemId: 44, rank: 1, title: "Community votes", score: 800 },
        ],
      }}
    />,
  );

  expect(html).toContain('aria-label="SYMBaiEX votes for Community votes"');
  expect(html).toContain("800 HN points");
  expect(html).toContain('aria-label="Upvote Community votes"');
});

test("shows a resolved empty snapshot without falling back to stale initial stories", () => {
  mocks.query.mockClear();
  const html = renderToStaticMarkup(
    <NewsFeed
      enabled
      initialStories={[]}
      initialTimeline={{ snapshots: [], snapshot: null, stories: [] }}
    />,
  );

  expect(html).toContain("No indexed stories for this snapshot yet.");
  expect(html).toContain('role="status"');
  expect(mocks.query).toHaveBeenCalledWith(convexRefs.news.timeline, "skip");
});
