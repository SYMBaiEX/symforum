// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const location = vi.hoisted(() => ({ pathname: "/forum" }));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <button>Theme</button>,
}));

import { activeForumSection, ForumNavigationLayout } from "./forum-navigation";

test.each(["/forum", "/"])("home selection is preserved on %s", (path) => {
  expect(activeForumSection(path, "news")).toBe("news");
  expect(activeForumSection(path, "feed")).toBe("feed");
  expect(activeForumSection(path, "unrecognized")).toBe("feed");
});

test.each(["/forum/general", "/general/lounge/topic"])(
  "board and conversation %s retain Boards context",
  (path) => {
    expect(activeForumSection(path, "feed")).toBe("boards");
  },
);

test.each(["/members/member", "/forum/agents", "/online"])(
  "member destinations %s retain Community context",
  (path) => {
    expect(activeForumSection(path, null)).toBe("community");
  },
);

test.each([
  "/start-here",
  "/forum/start-here",
  "/messages",
  "/forum/control-panel/agent-access",
  "/forum/search",
  "/help/article",
  "/forum/moderation",
])(
  "secondary destination %s does not select an unrelated primary view",
  (path) => {
    expect(activeForumSection(path, null)).toBeNull();
  },
);

test.each(["/forum/general", "/general"])(
  "navigation adapts links to host route %s without introducing a page heading",
  (path) => {
    location.pathname = path;
    const html = renderToStaticMarkup(
      <ForumNavigationLayout
        active="boards"
        navState={{
          authenticated: false,
          username: null,
          trusted: false,
          unreadNotifications: 0,
          unreadPrivateMessages: 0,
        }}
      />,
    );
    const prefix = path.startsWith("/forum") ? "/forum" : "/";
    expect(html).toContain(`href="${prefix}?view=boards"`);
    expect(html).toContain(
      `href="${path.startsWith("/forum") ? "/forum" : ""}/search"`,
    );
    expect(html).toContain('aria-label="Forum menu"');
    expect(html).toContain(
      `href="${path.startsWith("/forum") ? "/forum" : ""}/start-here"`,
    );
    expect(html).toContain('aria-label="Forum sections on mobile"');
    expect(html).toContain(`redirectTo=${encodeURIComponent(path)}`);
    expect(html).not.toContain("<h1");
  },
);

test("compact navigation preserves named primary and permitted personal destinations", () => {
  location.pathname = "/forum/saved";
  const html = renderToStaticMarkup(
    <ForumNavigationLayout
      active={null}
      navState={{
        authenticated: true,
        username: "member",
        trusted: false,
        unreadNotifications: 0,
        unreadPrivateMessages: 0,
      }}
    />,
  );
  expect(html).toContain('aria-controls="forum-navigation-rail"');
  expect(html).toContain('aria-label="Quick personal tools"');
  expect(html).toContain('aria-label="Saved threads"');
  expect(html).toContain('title="Agent access"');
  expect(html).not.toContain('href="/forum/messages"');
  expect(html).not.toContain('href="/forum/moderation"');
  for (const name of ["Feed", "News", "Community", "Boards"])
    expect(html).toContain(`aria-label="${name}"`);
});
