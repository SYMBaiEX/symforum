import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams("q=signal"),
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
  useSearchParams: () => mocks.params,
}));
vi.mock("next/image", () => ({
  default: () => null,
}));

import { forumRefs } from "./forum-refs";
import { ForumSearchPage, ForumSearchResults } from "./forum-search-page";

beforeEach(() => {
  mocks.params = new URLSearchParams("q=signal");
  mocks.cachedUseQuery.mockClear();
});

describe("ForumSearchPage request ownership", () => {
  test("keeps only board navigation on the reactive query cache", () => {
    renderToStaticMarkup(<ForumSearchPage enabled />);

    expect(mocks.cachedUseQuery).toHaveBeenCalledTimes(1);
    expect(mocks.cachedUseQuery).toHaveBeenCalledWith(
      forumRefs.listCategoryOptions,
      { limit: 200 },
    );
    expect(mocks.cachedUseQuery).not.toHaveBeenCalledWith(
      forumRefs.search,
      expect.anything(),
    );
  });
});

test("a URL with an author filter exposes the exact advanced search value", () => {
  mocks.params = new URLSearchParams("author=reader-one&days=7");
  const html = renderToStaticMarkup(<ForumSearchPage enabled />);
  expect(html).toMatch(/<details[^>]*open=""/);
  expect(html).toContain('value="reader-one"');
  expect(html).toContain("Advanced filters");
});

test("a basic search keeps advanced fields available without expanding them", () => {
  const html = renderToStaticMarkup(<ForumSearchPage enabled />);
  expect(html).toMatch(/<details[^>]*>/);
  expect(html).not.toMatch(/<details[^>]*open=""/);
  expect(html).toContain("Author");
  expect(html).toContain('aria-label="Filter forum search by board"');
});

test("failed search offers a retry using the existing filter context", () => {
  const onRetry = vi.fn();
  const params = new URLSearchParams("q=signal&author=reader-one&days=7");
  const element = ForumSearchResults({
    query: "signal",
    author: "reader-one",
    categoryLookup: new Map(),
    pageSize: 12,
    result: undefined,
    error: "Search could not be completed.",
    onRetry,
    searchParams: params,
  });
  const html = renderToStaticMarkup(element);
  expect(html).toContain("Retry search");
  element.props.action.props.onClick();
  expect(onRetry).toHaveBeenCalledOnce();
  expect(params.toString()).toBe("q=signal&author=reader-one&days=7");
});
