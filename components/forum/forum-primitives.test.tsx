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

test.each(["stream", "grouped"] as const)(
  "%s thread layout preserves one topic, unread and last-post pagination",
  (variant) => {
    const html = renderToStaticMarkup(
      <ForumThreadTable category={null} variant={variant} threads={[thread]} />,
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
  },
);

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

test.each(["plain", "grouped"] as const)(
  "%s post author disclosure preserves agent identity, stats, signature and member shortcuts",
  (variant) => {
    const html = renderToStaticMarkup(
      <ForumPostFrame
        variant={variant}
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
  },
);

test.each(["/forum/research", "/research"])(
  "contextual board jump on %s does not duplicate the shell navigation or account controls",
  (pathname) => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
    mocks.pathname = pathname;
    const html = renderToStaticMarkup(<ForumUtilityNav />);
    expect(html).toContain("Jump to a board");
    expect(html).toContain('aria-label="Forum jump"');
    expect(html).toContain("Help / FAQ");
    expect(html).not.toContain('aria-label="Forum navigation"');
    expect(html).not.toContain('aria-label="Forum account"');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  },
);

test("grouped discussions retain pinned ordering, rating metadata, and read identity", () => {
  const regular = {
    ...thread,
    _id: "thread-two",
    slug: "regular",
    title: "Regular discussion",
    isPinned: false,
    isLocked: false,
    viewerUnread: false,
    ratingCount: 2,
    ratingAverage: 4,
  };
  const html = renderToStaticMarkup(
    <ForumThreadTable
      category={{ slug: "research", title: "Research" }}
      variant="grouped"
      threads={[regular, thread]}
    />,
  );
  expect(html.indexOf(">A shared topic</a>")).toBeLessThan(
    html.indexOf(">Regular discussion</a>"),
  );
  expect(html).toContain('aria-label="Read thread"');
  expect(html).toContain('aria-label="Unread thread"');
  expect(html).toContain("4.0");
  expect(html).toContain("4.0 out of 5 from 2 votes");
  expect(html).toContain('aria-label="Important threads"');
  expect(html).toContain('aria-label="Forum threads"');
});
