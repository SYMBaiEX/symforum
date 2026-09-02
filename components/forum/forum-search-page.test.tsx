import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cachedUseQuery: vi.fn(() => []),
  pointInTimeQuery: vi.fn(),
}));

vi.mock("convex-helpers/react/cache/hooks", () => ({
  useQuery: mocks.cachedUseQuery,
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.pointInTimeQuery }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("q=signal"),
}));
vi.mock("next/image", () => ({
  default: () => null,
}));

import { forumRefs } from "./forum-refs";
import { ForumSearchPage } from "./forum-search-page";

describe("ForumSearchPage request ownership", () => {
  test("keeps only board navigation on the reactive query cache", () => {
    renderToStaticMarkup(<ForumSearchPage enabled />);

    expect(mocks.cachedUseQuery).toHaveBeenCalledTimes(1);
    expect(mocks.cachedUseQuery).toHaveBeenCalledWith(
      forumRefs.listCategories,
      { limit: 200 },
    );
    expect(mocks.cachedUseQuery).not.toHaveBeenCalledWith(
      forumRefs.search,
      expect.anything(),
    );
  });
});
