// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("convex-helpers/react/cache/hooks", () => ({ useQuery: mocks.query }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/forum/members",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/image", () => ({ default: () => null }));

import { ForumMembers } from "./forum-members";

beforeEach(() => mocks.query.mockReset());

test("member activity preserves identity, rank, statistics and presence in one list entry", () => {
  mocks.query.mockReturnValue({
    members: [
      {
        _id: "member-one",
        username: "reader-one",
        displayName: "Reader One",
        rank: "Contributor",
        customTitle: "Community builder",
        location: "Austin",
        threadCount: 3,
        postCount: 12,
        reputationScore: 5,
        joinedAt: 100,
        isOnline: true,
        onlineLocation: { label: "Reading General" },
      },
    ],
    pagination: {
      page: 1,
      totalPages: 1,
      totalItems: 1,
      startItem: 1,
      endItem: 1,
    },
  });
  const html = renderToStaticMarkup(<ForumMembers enabled />);
  expect(html.match(/<article\b/g)).toHaveLength(1);
  for (const text of [
    "Reader One",
    "Contributor",
    "Community builder",
    "Austin",
    "posts",
    "threads",
    "reputation",
    "Online",
    "Reading General",
  ])
    expect(html).toContain(text);
  expect(html).toContain('href="/forum/members/reader-one"');
  expect(html).toContain('type="search"');
  expect(html).toContain("Sort by");
});

test("the directory preserves its heading and controls while data loads", () => {
  mocks.query.mockReturnValue(undefined);
  const html = renderToStaticMarkup(<ForumMembers enabled />);
  expect(html.match(/<h1\b/g)).toHaveLength(1);
  expect(html).toContain('type="search"');
  expect(html).toContain("Syncing members");
});
