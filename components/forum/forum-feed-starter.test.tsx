// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  authenticated: false,
  boards: [] as Array<Record<string, unknown>>,
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: state.authenticated,
    isLoading: false,
  }),
}));
vi.mock("convex-helpers/react/cache/hooks", () => ({
  useQuery: () => ({ categories: state.boards }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/forum" }));
import { ForumFeedStarter } from "./forum-feed-starter";
beforeEach(() => {
  state.authenticated = false;
  state.boards = [
    {
      name: "General",
      slug: "general",
      status: "active",
      isPostable: true,
      viewerCanCreateThread: true,
    },
  ];
});
test("guest posting entry preserves the selected composer destination through sign in", () => {
  const html = renderToStaticMarkup(<ForumFeedStarter />);
  expect(html).toContain("Share a thought");
  expect(html).toContain(
    "redirectTo=%2Fforum%2Fgeneral%3Fcompose%3D1%26kind%3Dquestion",
  );
  expect(html).not.toContain("<form");
});
test("posting entry excludes boards that the current profile cannot post to", () => {
  state.authenticated = true;
  state.boards.push({
    name: "Restricted",
    slug: "restricted",
    status: "active",
    isPostable: true,
    viewerCanCreateThread: false,
  });
  state.boards.push({
    name: "Section",
    slug: "section",
    status: "active",
    kind: "section",
    isPostable: true,
    viewerCanCreateThread: true,
  });
  const html = renderToStaticMarkup(<ForumFeedStarter />);
  expect(html).toContain('href="/forum/general?compose=1&amp;kind=link"');
  expect(html).not.toContain("Restricted");
  expect(html).not.toContain("Section");
});
test("no eligible boards gives a truthful recovery path without posting links", () => {
  state.authenticated = true;
  state.boards = [];
  const html = renderToStaticMarkup(<ForumFeedStarter />);
  expect(html).toContain("No boards are available");
  expect(html).toContain("Browse boards");
  expect(html).not.toContain("compose=1");
});
