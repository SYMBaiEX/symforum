// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("convex-helpers/react/cache/hooks", () => ({ useQuery: mocks.query }));
vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a {...props} data-next-prefetch={prefetch ? "true" : undefined} />
  ),
}));
vi.mock("next/image", () => ({ default: () => null }));

import { ForumShellContextProvider } from "./forum/forum-shell-context";
import { PublicProfilePanel } from "./public-profile-panel";

beforeEach(() => {
  mocks.query.mockReturnValue({
    user: { username: "reader", usernameNormalized: "reader", _creationTime: 100, role: "reader" },
    isCurrentUser: false,
    forumProfile: { reputationScore: 0, threadCount: 0, postCount: 0, rank: "Member", joinedAt: 100 },
    recentForumThreads: [],
    recentForumReplies: [],
    recentComments: [
      { _id: "blog-comment", entityType: "post", entityId: "article", body: "Blog note", createdAt: 100 },
      { _id: "news-comment", entityType: "hnStory", entityId: "123", body: "News note", createdAt: 100 },
      { _id: "project-comment", entityType: "portfolioProject", entityId: "project", body: "Project note", createdAt: 100 },
    ],
  });
});

test("forum member site-comment links leave directly for the primary origin without RSC prefetch", () => {
  const html = renderToStaticMarkup(
    <ForumShellContextProvider primarySiteHref="https://www.symbaiex.com/">
      <PublicProfilePanel username="reader" forum />
    </ForumShellContextProvider>,
  );
  for (const path of ["/blog/article", "/news/123", "/portfolio/project"]) {
    expect(html).toContain(`href="https://www.symbaiex.com${path}"`);
    expect(html).not.toContain(`href="${path}"`);
  }
  expect(html).not.toContain("data-next-prefetch");
});

test("primary-site member activity retains local client navigation and prefetch", () => {
  const html = renderToStaticMarkup(<PublicProfilePanel username="reader" />);
  for (const path of ["/blog/article", "/news/123", "/portfolio/project"]) {
    expect(html).toMatch(
      new RegExp(`<a href="${path}"[^>]*data-next-prefetch="true"`),
    );
  }
});
