// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  trusted: true,
  query: vi.fn(),
}));
vi.mock("convex-helpers/react/cache/hooks", () => ({ useQuery: mocks.query }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/forum/messages",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => mocks.params,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/image", () => ({ default: () => null }));

import { ForumMessages } from "./forum-messages";
import { forumRefs } from "./forum-refs";

beforeEach(() => {
  mocks.params = new URLSearchParams();
  mocks.trusted = true;
  mocks.query.mockReset();
  mocks.query.mockImplementation((reference, args) => {
    if (args === "skip") return undefined;
    if (reference === forumRefs.getMyForumProfile)
      return { trusted: mocks.trusted };
    if (reference === forumRefs.getPrivateMessage) return null;
    if (reference === forumRefs.listMyForumRelationships)
      return { buddies: [] };
    if (reference === forumRefs.listPrivateMessages)
      return {
        messages: [],
        unreadCount: 0,
        quota: { used: 0, limit: 100, percent: 0 },
        pagination: {
          page: 1,
          totalPages: 1,
          totalItems: 0,
          startItem: 0,
          endItem: 0,
        },
      };
    return undefined;
  });
});

test("a stale selected message has a path back to its mailbox", () => {
  mocks.params = new URLSearchParams(
    "box=sent&message=removed&page=2&q=project",
  );
  const html = renderToStaticMarkup(<ForumMessages enabled />);
  expect(html).toContain('aria-label="Selected private message"');
  expect(html).toContain(
    "That message is not available in this mailbox anymore.",
  );
  expect(html).toContain("Back to sent");
  const backHref = html.match(/href="([^"]+)"[^>]*>← Back to sent/)?.[1];
  expect(backHref).toBeDefined();
  const backUrl = new URL(
    backHref!.replaceAll("&amp;", "&"),
    "https://forum.symbaiex.com",
  );
  expect(backUrl.searchParams.get("box")).toBe("sent");
  expect(backUrl.searchParams.get("page")).toBe("2");
  expect(backUrl.searchParams.get("q")).toBe("project");
  expect(backUrl.searchParams.has("message")).toBe(false);
  expect(html).toContain('aria-label="Search messages"');
  expect(html).toContain('role="progressbar"');
});

test("an untrusted member cannot load private mailbox or message data", () => {
  mocks.trusted = false;
  mocks.params = new URLSearchParams("message=private");
  const html = renderToStaticMarkup(<ForumMessages enabled />);
  expect(html).toContain("Private messages locked");
  expect(mocks.query).toHaveBeenCalledWith(
    forumRefs.listPrivateMessages,
    "skip",
  );
  expect(mocks.query).toHaveBeenCalledWith(forumRefs.getPrivateMessage, "skip");
});
