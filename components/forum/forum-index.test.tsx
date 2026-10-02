// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(reference: unknown) => unknown>(() => undefined),
  pointInTimeQuery: vi.fn(),
  onlineSnapshot: {
    snapshot: undefined as
      { key: string; data: unknown; refreshedAt: number } | undefined,
    refreshError: false,
    refreshNow: vi.fn(),
  },
}));

vi.mock("convex-helpers/react/cache/hooks", () => ({ useQuery: mocks.query }));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.pointInTimeQuery }),
  useMutation: () => vi.fn(),
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));
vi.mock("./use-foreground-snapshot", () => ({
  useForegroundSnapshot: () => mocks.onlineSnapshot,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/forum",
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/image", () => ({ default: () => null }));

import { ForumIndex } from "./forum-index";
import { forumRefs, type ForumOverviewRecord } from "./forum-refs";

const overview = {
  categories: [],
  sections: [],
  announcements: [],
  newestThreads: [],
  totals: { categories: 0, threads: 0, posts: 0 },
  statistics: {
    memberCount: 0,
    memberCountLimited: false,
    newestMember: {
      userId: "newest-user",
      username: "newest-member",
      displayName: "Newest Member",
      rank: "new",
      threadCount: 0,
      postCount: 0,
      reputationScore: 0,
      joinedAt: 1,
    },
    topPoster: null,
    reputationLeader: null,
  },
} as unknown as ForumOverviewRecord;

function renderForumIndex() {
  mocks.query.mockImplementation((reference) =>
    reference === forumRefs.overview ? overview : undefined,
  );
  return renderToStaticMarkup(<ForumIndex enabled />);
}

test("forum index does not subscribe to heartbeat-driven online summaries", () => {
  renderForumIndex();

  expect(mocks.query).toHaveBeenCalledWith(forumRefs.overview, {});
  expect(mocks.query).not.toHaveBeenCalledWith(
    forumRefs.onlineSummary,
    expect.anything(),
  );
  expect(mocks.pointInTimeQuery).not.toHaveBeenCalled();
});

test("shows loading instead of an empty online count before the first snapshot", () => {
  mocks.onlineSnapshot = {
    snapshot: undefined,
    refreshError: false,
    refreshNow: vi.fn(),
  };

  const html = renderForumIndex();

  expect(html).toContain("Checking online status");
  expect(html).toMatch(/<dt[^>]*>Online<\/dt><dd[^>]*>—<\/dd>/);
  expect(html).not.toContain("Newest member");
});

test("offers retry when the first online snapshot fails", () => {
  mocks.onlineSnapshot = {
    snapshot: undefined,
    refreshError: true,
    refreshNow: vi.fn(),
  };

  const html = renderForumIndex();

  expect(html).toContain("Online status unavailable.");
  expect(html).toContain(">Retry</button>");
  expect(html).toMatch(/<dt[^>]*>Online<\/dt><dd[^>]*>—<\/dd>/);
  expect(html).not.toContain("Newest member");
});

test("shows zero when an empty online snapshot loaded successfully", () => {
  mocks.onlineSnapshot = {
    snapshot: {
      key: "forum-index-online-summary",
      data: {
        activeSince: 1,
        registeredCount: 0,
        registeredCountLimited: false,
        members: [],
      },
      refreshedAt: 2,
    },
    refreshError: false,
    refreshNow: vi.fn(),
  };

  const html = renderForumIndex();

  expect(html).toMatch(/<dt[^>]*>Online<\/dt><dd[^>]*>0<\/dd>/);
  expect(html).toContain("Newest member");
  expect(html).not.toContain("Checking online status");
  expect(html).not.toContain("Online status unavailable.");
});
