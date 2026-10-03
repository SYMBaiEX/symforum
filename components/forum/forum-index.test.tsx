// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/forum",
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
  usePathname: () => mocks.pathname,
}));
vi.mock("./forum-feed-list", () => ({
  ForumFeedList: ({
    sort,
    communityOnly,
  }: {
    sort: string;
    communityOnly: boolean;
  }) => <div data-feed-sort={sort} data-community-only={communityOnly} />,
}));
vi.mock("./forum-chat", () => ({
  ForumChat: () => <section id="forum-chat">Lounge chat</section>,
}));
vi.mock("@/components/news-feed", () => ({
  NewsFeed: ({ variant }: { variant?: string }) => (
    <section data-news-variant={variant}>News stories</section>
  ),
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

beforeEach(() => {
  mocks.pathname = "/forum";
  mocks.query.mockClear();
  mocks.pointInTimeQuery.mockClear();
});

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

test("default forum home starts with lounge chat and grouped boards while keeping feed navigation", () => {
  const html = renderForumIndex();
  expect(html).toContain("Lounge chat");
  expect(html).toContain("Forum index");
  expect(html.indexOf('id="forum-chat"')).toBeLessThan(
    html.indexOf("Forum index"),
  );
  expect(html).toContain('href="/forum?view=feed"');
  expect(html).not.toContain("data-feed-sort");
});

test.each(["feed", "news", "community"] as const)(
  "%s keeps Lounge chat before its content and the current forum navigation",
  (view) => {
    mocks.query.mockImplementation((reference) =>
      reference === forumRefs.overview ? overview : undefined,
    );
    const html = renderToStaticMarkup(<ForumIndex enabled view={view} />);
    expect(html).toContain('id="forum-chat"');
    expect(html).toContain(`href="/forum?view=${view}"`);
    if (view === "news") {
      expect(html).toContain('data-news-variant="forum"');
      expect(html.indexOf('id="forum-chat"')).toBeLessThan(
        html.indexOf('data-news-variant="forum"'),
      );
    } else {
      expect(html.indexOf('id="forum-chat"')).toBeLessThan(
        html.indexOf("data-feed-sort"),
      );
    }
  },
);

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

test("home exposes real view URLs on the forum host and community filtering", () => {
  mocks.pathname = "/";
  mocks.query.mockImplementation(() => overview);
  const html = renderToStaticMarkup(
    <ForumIndex enabled view="community" sort="new" />,
  );
  expect(html).toContain('href="/?view=news&amp;sort=new"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('data-community-only="true"');
  expect(html).toContain('data-feed-sort="new"');
  expect(html).not.toContain("Mark all read");
  expect(html).not.toContain("border-b");
  expect(html).not.toContain("divide-y");
});

test("create post routes to the existing board composer; boards preserve mark all read", () => {
  mocks.query.mockImplementation(() => ({
    ...overview,
    categories: [
      {
        slug: "general",
        name: "General",
        kind: "board",
        status: "active",
        isPostable: true,
      },
    ],
  }));
  const html = renderToStaticMarkup(<ForumIndex enabled view="boards" />);
  expect(html).toContain("Create post");
  expect(html).toContain('href="/forum/general?compose=1"');
  expect(html).toContain("Mark all read");
  expect(html).not.toContain("data-feed-sort");
});

test("feed news preview links the real local discussion without combining HN and local scores", () => {
  mocks.query.mockImplementation(() => overview);
  const html = renderToStaticMarkup(
    <ForumIndex
      enabled
      view="feed"
      initialStories={[
        {
          hnItemId: 42,
          rank: 1,
          title: "A real headline",
          host: "example.com",
          score: 99,
          descendants: 12,
          platformStats: { score: 3, saves: 1, comments: 2 },
        },
      ]}
    />,
  );
  expect(html).toContain("On Hacker News");
  expect(html).toContain("99 HN points");
  expect(html).toContain("12 HN comments");
  expect(html).toMatch(/href="https:\/\/www\.symbaiex\.com\/news\//);
  expect(html).not.toContain("102");
});

test("disabled forum uses a clear local fallback with functional view links", () => {
  const html = renderToStaticMarkup(<ForumIndex enabled={false} />);
  expect(html).toContain("Forum unavailable locally");
  expect(html).toContain('href="/forum?view=news"');
  expect(html).not.toContain("Loading discussions");
});
