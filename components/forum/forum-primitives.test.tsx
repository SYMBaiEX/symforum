// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/forum/research" }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("./forum-webmcp", () => ({ ForumAgentContextStrip: () => null }));
vi.mock("next/image", () => ({ default: () => null }));

import {
  ForumIndexTable,
  ForumPostFrame,
  ForumThreadTable,
  ForumUtilityNav,
} from "./forum-primitives";
import type { ForumThreadSummaryRecord } from "./forum-refs";

const thread: ForumThreadSummaryRecord = {
  _id: "thread-one",
  slug: "a-shared-topic",
  title: "A shared topic",
  authorUsername: "first-author",
  lastPostAuthorName: "latest-author",
  createdAt: 100,
  lastActivityAt: 200,
  categorySlug: "research",
  replyCount: 12,
  viewCount: 21,
  excerpt: "A useful summary.",
  viewerUnread: true,
  firstUnreadPostNumber: 11,
  firstUnreadPage: 2,
  lastPostNumber: 13,
  lastPostPage: 2,
  isPinned: true,
  isLocked: true,
};

test("thread stream renders each topic once and preserves unread and last-post pagination", () => {
  const html = renderToStaticMarkup(
    <ForumThreadTable category={null} threads={[thread]} />,
  );
  expect(html.match(/>A shared topic<\/a>/g)).toHaveLength(1);
  expect(html).not.toContain("<table");
  expect(html).toContain("Important threads");
  expect(html).toContain("Pinned");
  expect(html).toContain("Locked");
  expect(html).toContain("A useful summary.");
  expect(html).toContain(
    'href="/forum/research/a-shared-topic?postPage=2#post-11"',
  );
  expect(html).toContain(
    'href="/forum/research/a-shared-topic?postPage=2#post-13"',
  );
});

test("board groups use a single accessible list with counts and restricted-access labels", () => {
  const html = renderToStaticMarkup(
    <ForumIndexTable
      categories={[
        {
          slug: "research",
          title: "Research",
          summary: "Read together.",
          threadsCount: 8,
          postsCount: 24,
          viewAccess: "trusted",
          viewerUnread: true,
        },
      ]}
    />,
  );
  expect(html.match(/>Research<\/a>/g)).toHaveLength(1);
  expect(html).toContain('aria-label="Main boards"');
  expect(html).toContain("8 threads");
  expect(html).toContain("24 posts");
  expect(html).toContain("trusted view");
  expect(html).not.toContain("<table");
});

test("post author disclosure preserves agent identity, stats, signature and member shortcuts", () => {
  const html = renderToStaticMarkup(
    <ForumPostFrame
      author="Research Agent"
      authorHref="/forum/members/research-agent"
      role="AI Agent"
      postNumber={2}
      id="post-2"
      timestamp="Oct 2"
      postCount={25}
      reputationScore={0}
      joinedAt={100}
      signature="Agent signature"
      actions={<button>Quote this reply</button>}
    >
      <p>The reply body.</p>
    </ForumPostFrame>,
  );
  expect(html).toContain("AI Agent");
  expect(html).toContain("<details");
  expect(html).toContain("About Research Agent");
  expect(html).toContain("<summary");
  expect(html).toContain("Reputation");
  expect(html).toContain("Agent signature");
  expect(html).toContain(
    'href="/forum/messages?compose=1&amp;recipient=research-agent"',
  );
  expect(html).toContain(
    'href="/forum/search?author=research-agent&amp;type=replies"',
  );
  expect(html).toContain(
    'href="/forum/search?author=research-agent&amp;type=threads"',
  );
  expect(html).toContain('aria-label="Permalink to post 2"');
  expect(html.indexOf("The reply body.")).toBeLessThan(
    html.indexOf("Quote this reply"),
  );
  expect(html).not.toContain("11rem");
});

test.each(["/forum/research", "/research"])(
  "compact forum navigation routes home tabs on %s and folds secondary links and board jump",
  (pathname) => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
    mocks.pathname = pathname;
    const html = renderToStaticMarkup(<ForumUtilityNav />);
    const root = pathname.startsWith("/forum") ? "/forum" : "/";
    for (const view of ["feed", "news", "community", "boards"])
      expect(html).toContain(`href="${root}?view=${view}"`);
    expect(html).toContain('aria-label="Forum navigation"');
    expect(html).toContain("Forum tools");
    expect(html).toContain('aria-label="Forum jump"');
    expect(html).toContain("Help / FAQ");
    expect(html).toContain("Sign in");
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).not.toContain("Quick forum search");
  },
);
