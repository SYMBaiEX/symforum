// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pointInTimeQuery: vi.fn(),
  query: vi.fn(() => undefined),
}));

vi.mock("convex-helpers/react/cache/hooks", () => ({ useQuery: mocks.query }));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.pointInTimeQuery }),
  useMutation: () => vi.fn(),
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/forum/research",
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
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
