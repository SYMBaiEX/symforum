// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  authorizationQuery: vi.fn(),
  authorization: { fingerprint: "guest-public" } as
    { fingerprint: string } | undefined,
  authLoading: false,
  authenticated: false,
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.query }),
  useMutation: () => vi.fn(),
  useConvexAuth: () => ({
    isAuthenticated: mocks.authenticated,
    isLoading: mocks.authLoading,
  }),
  useQuery: (...args: unknown[]) => {
    mocks.authorizationQuery(...args);
    return mocks.authorization;
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/forum" }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/image", () => ({ default: () => null }));

import { ForumFeedArticle, ForumFeedList } from "./forum-feed-list";
import { forumFeedRefs, type ForumFeedThread } from "./forum-feed-refs";

const thread: ForumFeedThread = {
  _id: "thread-one",
  slug: "a-conversation",
  categorySlug: "general",
  categoryName: "General",
  title: "A conversation",
  excerpt: "A real excerpt <script>alert(1)</script>",
  source: "community",
  authorIdentity: { username: "agent-one", name: "Agent One", isAgent: true },
  createdAt: 1,
  replyCount: 2,
};

test("feed article presents genuine identity, excerpt, and conversation link without fake votes", () => {
  const html = renderToStaticMarkup(<ForumFeedArticle thread={thread} />);
  expect(html).toContain(">AI</span>");
  expect(html).toContain("Agent One");
  expect(html).toContain('href="/forum/members/agent-one"');
  expect(html).toContain('href="/forum/general/a-conversation"');
  expect(html).toContain("2 replies");
  expect(html).toContain('dateTime="1970-01-01T00:00:00.001Z"');
  expect(html).toContain('aria-label="Posted Thu, 01 Jan 1970 00:00:00 GMT"');
  expect(html).toContain(">Jan 1</time>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("Upvote");
  expect(html).not.toContain("border-b");
});

test("ordinary members keep their identity and the empty conversation action", () => {
  const html = renderToStaticMarkup(
    <ForumFeedArticle
      thread={{
        ...thread,
        replyCount: 0,
        authorIdentity: {
          username: "member",
          name: "A Member",
          isAgent: false,
        },
      }}
    />,
  );
  expect(html).toContain('aria-label="Reply to A conversation"');
  expect(html).toContain(">Reply</a>");
  expect(html).not.toContain(">AI</span>");
});

test("authentication loading shows a loading state and does not request privileged feed data", () => {
  mocks.authLoading = true;
  mocks.query.mockClear();
  const html = renderToStaticMarkup(
    <ForumFeedList sort="active" communityOnly={false} />,
  );
  expect(html).toContain("Loading discussions");
  expect(html).toContain('aria-busy="true"');
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.authorizationQuery).toHaveBeenLastCalledWith(
    forumFeedRefs.authorizationFingerprint,
    "skip",
  );
  mocks.authLoading = false;
});

test("unresolved authorization hides the feed even when authentication is ready", () => {
  mocks.authorization = undefined;
  mocks.query.mockClear();
  const html = renderToStaticMarkup(
    <ForumFeedList sort="active" communityOnly={false} />,
  );
  expect(html).toContain("Loading discussions");
  expect(html).not.toContain("From the forum");
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.authorizationQuery).toHaveBeenLastCalledWith(
    forumFeedRefs.authorizationFingerprint,
    {},
  );
  mocks.authorization = { fingerprint: "guest-public" };
});

test("user switch and permission revocation replace the entire page-state boundary", () => {
  mocks.authenticated = true;
  mocks.authorization = { fingerprint: "user-a-staff" };
  const userA = ForumFeedList({ sort: "active", communityOnly: false });
  mocks.authorization = { fingerprint: "user-b-member" };
  const userB = ForumFeedList({ sort: "active", communityOnly: false });
  expect(userB.key).not.toBe(userA.key);
  mocks.authorization = { fingerprint: "user-b-restricted" };
  const restricted = ForumFeedList({ sort: "active", communityOnly: false });
  expect(restricted.key).not.toBe(userB.key);
  // Same authorization leaves LiveFeed mounted, so an ordinary network refresh
  // failure can retain the loaded discussions without leaking another scope.
  const unchanged = ForumFeedList({ sort: "active", communityOnly: false });
  expect(unchanged.key).toBe(restricted.key);
  mocks.authorization = { fingerprint: "guest-public" };
  mocks.authenticated = false;
});
