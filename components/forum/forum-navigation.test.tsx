// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import type { ForumOverviewRecord } from "./forum-refs";

const location = vi.hoisted(() => ({ pathname: "/forum" }));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <button>Theme</button>,
}));
vi.mock("@/components/ui/dropdown-menu", () => {
  // Expose closed menu contents in this SSR-only harness so posting choices
  // are checked too. Production keeps the existing Radix interaction/focus.
  const content = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: content,
    DropdownMenuContent: content,
    DropdownMenuGroup: content,
    DropdownMenuItem: content,
    DropdownMenuLabel: content,
    DropdownMenuRadioGroup: content,
    DropdownMenuRadioItem: content,
    DropdownMenuTrigger: content,
  };
});

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
  "/symf",
  "/forum/symf",
  "/trade",
  "/forum/trade",
  "/community",
  "/forum/community",
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
    expect(html).toContain(
      `href="${path.startsWith("/forum") ? "/forum" : ""}/symf"`,
    );
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
  for (const name of [
    "Start here",
    "$SYMF",
    "Swap tokens",
    "Trading terminal",
    "Community utilities",
  ]) {
    expect(html).toContain(`aria-label="${name}"`);
    expect(html).toContain(
      `class="forum-nav-label min-w-0 flex-1">${name}</span>`,
    );
  }
});

function archiveOverview(): ForumOverviewRecord {
  const main: ForumOverviewRecord["categories"][number] = {
    _id: "main", slug: "symbaiex", kind: "section", status: "active",
  };
  const archive: ForumOverviewRecord["categories"][number] = {
    _id: "archive", slug: "archive", kind: "section", status: "active",
    title: "Archive", readOnlyArchive: true,
  };
  // The public contract keeps only boards in categories. Sections, including
  // Archive, are represented separately, not duplicated in categories.
  const categories: ForumOverviewRecord["categories"] = [
      {
        _id: "projects", slug: "projects", title: "Projects", kind: "board",
        status: "active", parentCategoryId: "archive", position: 2,
        readOnlyArchive: true,
        // Cached posting permissions must not offer a new archived post.
        isPostable: true, viewerCanCreateThread: true,
      },
      {
        _id: "build-logs", slug: "projects-build-logs", title: "Build Logs",
        kind: "board", status: "active", parentCategoryId: "projects",
        readOnlyArchive: true, isPostable: true, viewerCanCreateThread: true,
      },
      ...[
        ["general", "General", 60], ["music", "Music", 50],
        ["hacking", "Hacking", 40], ["crypto", "Web3", 30],
        ["gaming", "Gaming", 20], ["ai", "AI", 10],
      ].map(([slug, title, position]) => ({
        _id: String(slug), slug: String(slug), title: String(title),
        position: Number(position), kind: "board" as const,
        status: "active" as const, parentCategoryId: "main",
        isPostable: true, viewerCanCreateThread: true,
      })),
  ];
  return {
    categories,
    sections: [
      { section: main, boards: categories.filter((board) => board.parentCategoryId === "main"), threadCount: 0, postCount: 0 },
      { section: archive, boards: categories.filter((board) => board.parentCategoryId === "archive"), threadCount: 0, postCount: 0 },
    ],
    announcements: [], newestThreads: [],
    totals: { categories: 10, threads: 0, posts: 0 },
    statistics: {
      memberCount: 0, memberCountLimited: false, newestMember: null,
      topPoster: null, reputationLeader: null,
    },
  };
}

function renderArchiveNavigation(overview = archiveOverview()) {
  return renderToStaticMarkup(
    <ForumNavigationLayout active="boards" overview={overview}
      navState={{ authenticated: true, username: "reader", trusted: true,
        unreadNotifications: 0, unreadPrivateMessages: 0 }} />,
  );
}

test("active pillars stay ordered while archived boards leave navigation and posting choices", () => {
  location.pathname = "/forum/ai";
  const html = renderArchiveNavigation();
  const primaryBoards = html.match(/<nav aria-label="Boards"[\s\S]*?<\/nav>/)?.[0] ?? "";
  const titles = ["AI", "Gaming", "Web3", "Hacking", "Music", "General"];
  for (const title of titles) expect(primaryBoards).toContain(`aria-label="${title}"`);
  for (let i = 1; i < titles.length; i++)
    expect(primaryBoards.indexOf(`aria-label="${titles[i]}"`)).toBeGreaterThan(
      primaryBoards.indexOf(`aria-label="${titles[i - 1]}"`),
    );
  expect(primaryBoards).not.toContain('href="/forum/projects"');
  expect(primaryBoards).not.toContain('href="/forum/projects-build-logs"');
  expect(html).not.toContain('href="/forum/projects?compose=1"');
  expect(html).not.toContain('href="/forum/projects-build-logs?compose=1"');
  expect(html).toContain('href="/forum/ai?compose=1"');
  expect(primaryBoards.match(/aria-label="Archive"/g)).toHaveLength(1);
  expect(primaryBoards).toContain('title="Archive"');
  expect(primaryBoards).toContain('class="forum-nav-label min-w-0 flex-1">Archive</span>');
});

test.each(["/forum/archive", "/forum/projects/topic", "/forum/projects-build-logs/topic"])(
  "Archive is the current destination for %s without changing old URLs",
  (path) => {
    location.pathname = path;
    const html = renderArchiveNavigation();
    const archiveLink = html.match(/<a[^>]*aria-label="Archive"[^>]*>/)?.[0] ?? "";
    expect(archiveLink).toContain('href="/forum/archive"');
    expect(archiveLink).toContain('aria-current="page"');
  },
);

test("Archive is not offered when its active section is not visible", () => {
  location.pathname = "/forum/ai";
  const overview = archiveOverview();
  overview.sections = overview.sections.filter(({ section }) => section?.slug !== "archive");
  expect(renderArchiveNavigation(overview)).not.toContain('aria-label="Archive"');
});

test("an empty visible Archive remains reachable without inventing an active board", () => {
  location.pathname = "/forum/archive";
  const overview = archiveOverview();
  overview.categories = [];
  overview.sections = overview.sections
    .filter(({ section }) => section?.slug === "archive")
    .map(({ section }) => ({ section, boards: [], threadCount: 0, postCount: 0 }));
  const html = renderArchiveNavigation(overview);
  expect(html).toContain('aria-label="Archive"');
  expect(html).toContain('href="/forum/archive"');
});
