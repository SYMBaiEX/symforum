// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(() => undefined) }));
vi.mock("convex-helpers/react/cache/hooks", () => ({ useQuery: mocks.query }));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/forum/research/example",
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/image", () => ({ default: () => null }));
import { ForumThreadView } from "./forum-thread-view";
import { forumRefs } from "./forum-refs";

test("opening a thread does not subscribe to an automatic full-text search", () => {
  renderToStaticMarkup(
    <ForumThreadView enabled categorySlug="research" threadSlug="example" />,
  );
  expect(mocks.query).toHaveBeenCalledWith(
    forumRefs.getThread,
    expect.anything(),
  );
  expect(mocks.query).not.toHaveBeenCalledWith(
    forumRefs.search,
    expect.anything(),
  );
});
