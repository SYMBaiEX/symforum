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
