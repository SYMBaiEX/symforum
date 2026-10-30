// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/image", () => ({ default: () => null }));
import { ForumGroupedBoards } from "./forum-grouped-boards";
import type { ForumOverviewRecord } from "./forum-refs";

test("readable archive groups keep their canonical links and explicit read-only label", () => {
  const overview = {
    categories: [],
    totals: { categories: 1, threads: 4, posts: 5 },
    sections: [
      {
        section: { slug: "archive", name: "Archive" },
        boards: [
          {
            slug: "projects",
            name: "Projects",
            readOnlyArchive: true,
            threadCount: 4,
            postCount: 5,
          },
        ],
      },
    ],
  } as unknown as ForumOverviewRecord;
  const html = renderToStaticMarkup(<ForumGroupedBoards overview={overview} />);
  expect(html).toContain("Archive");
  expect(html).toContain("Read-only archive");
  expect(html).toContain('href="/projects"');
  expect(html).toContain(">4</dd>");
});

test("grouped board rows keep subforums, actual counts, read-state and latest-post links on the forum host", () => {
  const overview = {
    categories: [],
    totals: { categories: 1, threads: 5, posts: 12 },
    sections: [
      {
        section: { slug: "community", name: "Community" },
        boards: [
          {
            slug: "general",
            name: "General",
            description: "A place to talk",
            threadCount: 5,
            postCount: 12,
            viewerUnread: false,
            children: [
              {
                slug: "introductions",
                name: "Introductions",
                viewerUnread: true,
              },
            ],
            lastThread: {
              slug: "hello",
              title: "Hello everyone",
              categorySlug: "introductions",
              lastPostNumber: 26,
              lastPostPage: 2,
              lastPostAt: 1000,
              lastPostAuthorName: "Austin",
            },
          },
        ],
      },
    ],
  } as unknown as ForumOverviewRecord;
  const html = renderToStaticMarkup(<ForumGroupedBoards overview={overview} />);
  expect(html).toContain("Community");
  expect(html).toContain("A place to talk");
  expect(html).toContain('aria-label="Unread board"');
  expect(html).toContain('href="/introductions"');
  expect(html).toContain('href="/introductions/hello?postPage=2#post-26"');
  expect(html).toContain("Austin");
  expect(html).toContain("threads");
  expect(html).not.toContain("divide-y");
});

test("board filtering finds nested subforums without changing actual totals or last-post targets", () => {
  const overview = {
    categories: [],
    totals: { categories: 2, threads: 15, posts: 30 },
    sections: [
      {
        section: { slug: "community", name: "Community" },
        boards: [
          {
            slug: "general",
            name: "General",
            threadCount: 10,
            postCount: 20,
            children: [{ slug: "lounge", name: "Lounge", threadCount: 2 }],
            lastThread: {
              slug: "hello",
              title: "Hello",
              categorySlug: "lounge",
              lastPostNumber: 2,
              lastPostAuthorName: "Member",
            },
          },
          { slug: "projects", name: "Projects", threadCount: 5, postCount: 10 },
        ],
      },
    ],
  } as unknown as ForumOverviewRecord;
  const html = renderToStaticMarkup(
    <ForumGroupedBoards overview={overview} query="  LOUNGE  " />,
  );
  expect(html).toContain('href="/lounge"');
  expect(html).toContain('href="/lounge/hello#post-2"');
  expect(html).toContain('open=""');
  expect(html).not.toContain('href="/projects"');
  expect(html).toContain(">15</dd>");
  const empty = renderToStaticMarkup(
    <ForumGroupedBoards overview={overview} query="missing board" />,
  );
  expect(empty).toContain("No matching boards");
  expect(empty).not.toContain('href="/general"');
});

test("section shortcuts target the visible groups and never advertise filtered-out sections", () => {
  const overview = {
    totals: { categories: 2, threads: 1, posts: 1 },
    categories: [],
    sections: [
      {
        section: { slug: "build", name: "Build" },
        boards: [{ slug: "projects", name: "Projects" }],
      },
      {
        section: { slug: "talk", name: "Talk" },
        boards: [{ slug: "general", name: "General" }],
      },
    ],
  } as unknown as ForumOverviewRecord;
  const html = renderToStaticMarkup(<ForumGroupedBoards overview={overview} />);
  expect(html).toContain('aria-label="Jump to board section"');
  for (const section of ["build", "talk"]) {
    expect(html).toContain(`href="#board-group-${section}"`);
    expect(html).toContain(`id="board-group-${section}"`);
  }
  const filtered = renderToStaticMarkup(
    <ForumGroupedBoards overview={overview} query="projects" />,
  );
  expect(filtered).not.toContain('id="board-group-talk"');
  expect(filtered).not.toContain('href="#board-group-talk"');
  expect(filtered).toContain('id="board-group-build"');
});
