// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pointInTimeQuery: vi.fn(),
  query: vi.fn<(reference: unknown) => unknown>(() => undefined),
  authenticated: false,
  params: "",
}));

vi.mock("convex-helpers/react/cache/hooks", () => ({ useQuery: mocks.query }));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.pointInTimeQuery }),
  useMutation: () => vi.fn(),
  useConvexAuth: () => ({
    isAuthenticated: mocks.authenticated,
    isLoading: false,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.params),
  usePathname: () => "/forum/research",
}));
vi.mock("next/dynamic", () => ({
  default: () => () => <div data-testid="composer" />,
}));
vi.mock("next/image", () => ({ default: () => null }));

import { forumRefs } from "./forum-refs";
import { ForumThreadList } from "./forum-thread-list";

test("board search is point-in-time and does not subscribe while rendering", () => {
  renderToStaticMarkup(<ForumThreadList categorySlug="research" enabled />);

  expect(mocks.query).not.toHaveBeenCalledWith(
    forumRefs.search,
    expect.anything(),
  );
  expect(mocks.pointInTimeQuery).not.toHaveBeenCalled();
});

beforeEach(() => {
  mocks.authenticated = false;
  mocks.params = "";
  mocks.query.mockReset();
  mocks.query.mockReturnValue(undefined);
});

function configureBoard(canCreate: boolean) {
  mocks.params = "compose=1";
  mocks.query.mockImplementation((reference) =>
    reference === forumRefs.listThreads
      ? {
          category: {
            slug: "research",
            title: "Research",
            viewerCanCreateThread: canCreate,
          },
          threads: [],
          announcements: [],
          rules: null,
          pagination: {
            page: 1,
            totalPages: 1,
            startItem: 0,
            endItem: 0,
            totalItems: 0,
          },
        }
      : [],
  );
}

test("create-post deep link opens the existing composer only with current authentication and board permission", () => {
  configureBoard(true);
  mocks.authenticated = true;
  const html = renderToStaticMarkup(
    <ForumThreadList categorySlug="research" enabled />,
  );
  expect(html).toContain('data-testid="composer"');
  expect(html).toContain("Close thread form");
});

test.each([false, true])(
  "create-post deep link cannot bypass guest or board permissions (authenticated %s)",
  (authenticated) => {
    configureBoard(!authenticated);
    mocks.authenticated = authenticated;
    const html = renderToStaticMarkup(
      <ForumThreadList categorySlug="research" enabled />,
    );
    expect(html).not.toContain('data-testid="composer"');
    expect(html).toContain("New thread");
  },
);

test("server-rendered board heading suppresses duplicate client title and description while retaining metadata", () => {
  configureBoard(false);
  const html = renderToStaticMarkup(
    <ForumThreadList categorySlug="research" enabled showHeading={false} />,
  );
  expect(html).not.toContain("<h1");
  expect(html).toContain('aria-label="Forum breadcrumb"');
  expect(html).toContain("Threads");
  expect(html).toContain("Posts");
});

test("board navigation carries sub-board and latest post targets while retaining current filters", () => {
  mocks.params = "sort=replies&order=asc&days=7&page=2";
  mocks.query.mockImplementation((reference) =>
    reference === forumRefs.listThreads
      ? {
          category: {
            slug: "research",
            title: "Research",
            children: [
              {
                slug: "systems",
                title: "Systems",
                threadsCount: 3,
                postsCount: 9,
                viewerUnread: true,
                children: [{ slug: "compilers", title: "Compilers" }],
                latestThread: {
                  slug: "build-tools",
                  title: "Build tools",
                  lastPostNumber: 11,
                  lastPostPage: 2,
                  lastPostAuthorName: "latest-reader",
                  createdAt: 100,
                },
              },
              {
                slug: "updates",
                title: "Updates",
                threadsCount: 2,
                postsCount: 2,
                latestThread: null,
              },
            ],
          },
          threads: [
            {
              _id: "thread-one",
              slug: "topic",
              title: "A research topic",
              createdAt: 100,
            },
          ],
          rules: { title: "Research guidelines", body: "Cite your sources." },
          announcements: [],
          pagination: {
            page: 2,
            totalPages: 3,
            startItem: 26,
            endItem: 50,
            totalItems: 60,
          },
        }
      : [],
  );
  const html = renderToStaticMarkup(
    <ForumThreadList categorySlug="research" enabled />,
  );
  expect(html).toContain('aria-label="Research sub-boards"');
  expect(html).toMatch(/<details[^>]*aria-label="Sub-board selector"[^>]*>/);
  const subboardDisclosureTag = html.match(
    /<details[^>]*aria-label="Sub-board selector"[^>]*>/,
  )?.[0];
  expect(subboardDisclosureTag).not.toMatch(/\sopen(?:[=\s>])/);
  expect(html).toContain("Systems, Updates");
  expect(html).toContain('href="/forum/systems"');
  expect(html).toContain('href="/forum/compilers"');
  expect(html).toContain(
    'href="/forum/systems/build-tools?postPage=2#post-11"',
  );
  expect(html).toContain("latest-reader");
  expect(html).not.toContain("Latest activity unavailable");
  expect(html).toContain(
    'href="/forum/research?sort=replies&amp;order=asc&amp;days=7&amp;page=3"',
  );
  expect(html).toContain('aria-label="Board information"');
  expect(html).toContain("Cite your sources.");
  expect(html.match(/>Research<\/h1>/g)).toHaveLength(1);
  expect(mocks.query).toHaveBeenCalledWith(forumRefs.listThreads, {
    categorySlug: "research",
    page: 2,
    pageSize: 25,
    sortKey: "replies",
    sortOrder: "asc",
    days: 7,
  });
});
