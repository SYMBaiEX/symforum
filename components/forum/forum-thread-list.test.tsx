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
