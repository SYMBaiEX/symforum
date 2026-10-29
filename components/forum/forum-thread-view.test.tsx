// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(reference: unknown) => unknown>(() => undefined),
  authenticated: false,
}));
vi.mock("convex-helpers/react/cache/hooks", () => ({ useQuery: mocks.query }));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
  useConvexAuth: () => ({
    isAuthenticated: mocks.authenticated,
    isLoading: false,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/forum/research/example",
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/image", () => ({ default: () => null }));
import { ForumThreadView } from "./forum-thread-view";
import { forumRefs } from "./forum-refs";

test("opening a thread does not subscribe to an automatic full-text search", () => {
  renderToStaticMarkup(
    <ForumThreadView enabled categorySlug="research" threadSlug="example" />,
  );
  expect(mocks.query).toHaveBeenCalledWith(
    forumRefs.getThread,
    expect.anything(),
  );
  expect(mocks.query).not.toHaveBeenCalledWith(
    forumRefs.search,
    expect.anything(),
  );
});

beforeEach(() => {
  mocks.authenticated = false;
  mocks.query.mockReset();
  mocks.query.mockReturnValue(undefined);
});

function configureThread(locked: boolean, totalPages = 1) {
  mocks.authenticated = true;
  mocks.query.mockImplementation((reference) =>
    reference === forumRefs.getThread
      ? {
          category: { slug: "research", title: "Research" },
          thread: {
            _id: "thread-one",
            slug: "example",
            title: "A shared discussion",
            body: "Opening message.",
            authorUsername: "research-agent",
            role: "AI Agent",
            authorDisplayName: "Research Agent",
            viewerCanReply: true,
            viewerCanEdit: true,
            locked,
            viewerCanDelete: false,
            authorShowSignatures: false,
            authorSignature: "A hidden signature",
            createdAt: 100,
          },
          replies: {
            page: [
              {
                _id: "reply-two",
                body: "First reply.",
                authorUsername: "reader-one",
                postNumber: 2,
                createdAt: 200,
              },
              {
                _id: "reply-three",
                body: "Second reply.",
                authorUsername: "reader-two",
                postNumber: 3,
                createdAt: 300,
              },
            ],
            isDone: true,
            pagination: {
              page: 1,
              totalPages,
              hasNextPage: totalPages > 1,
              startItem: 1,
              endItem: 3,
              totalItems: 3,
            },
          },
          poll: null,
          rules: null,
          announcements: [],
        }
      : [],
  );
}

test("thread reading preserves one title, chronological post identities and contextual actions", () => {
  configureThread(false);
  const html = renderToStaticMarkup(
    <ForumThreadView enabled categorySlug="research" threadSlug="example" />,
  );
  expect(html.match(/>A shared discussion<\/h1>/g)).toHaveLength(1);
  expect(html).toContain('id="post-1"');
  expect(html).toContain('id="post-2"');
  expect(html).toContain('id="post-3"');
  expect(html.indexOf("Opening message.")).toBeLessThan(
    html.indexOf("First reply."),
  );
  expect(html.indexOf("First reply.")).toBeLessThan(
    html.indexOf("Second reply."),
  );
  expect(html).toContain("AI Agent");
  expect(html).not.toContain("A hidden signature");
  // A summary-less details element inserts a browser-generated "Details" toggle and hides posts.
  expect(html).not.toMatch(/<details[^>]*><article/);
  expect(html).toContain(">Quote</button>");
  expect(html).toContain(">Report</button>");
  expect(html).toContain(">Edit</button>");
  expect(html).not.toContain(">Delete</button>");
});

test("a newly locked thread removes quote actions without hiding existing content or reports", () => {
  configureThread(false);
  const openHtml = renderToStaticMarkup(
    <ForumThreadView enabled categorySlug="research" threadSlug="example" />,
  );
  expect(openHtml).toContain(">Quote</button>");
  expect(openHtml).toContain('href="#forum-reply-composer"');
  configureThread(true);
  const lockedHtml = renderToStaticMarkup(
    <ForumThreadView enabled categorySlug="research" threadSlug="example" />,
  );
  expect(lockedHtml).not.toContain(">Quote</button>");
  expect(lockedHtml).not.toContain('href="#forum-reply-composer"');
  expect(lockedHtml).toContain("Thread closed");
  expect(lockedHtml).toContain("First reply.");
  expect(lockedHtml).toContain(">Report</button>");
});

test("server-rendered thread heading suppresses duplicate client heading while preserving the starter", () => {
  configureThread(false);
  const html = renderToStaticMarkup(
    <ForumThreadView
      enabled
      categorySlug="research"
      threadSlug="example"
      showHeading={false}
    />,
  );
  expect(html).not.toContain("<h1");
  expect(html).toContain('href="#forum-reply-composer"');
  expect(html).toContain('aria-label="More actions for post 2"');
  expect(html).toContain("Opening message.");
  expect(html).toContain("First reply.");
  expect(html).toContain('aria-label="Forum breadcrumb"');
});

test("a single-page reader puts posts before optional board context and avoids empty pagination", () => {
  configureThread(false);
  const html = renderToStaticMarkup(
    <ForumThreadView
      enabled
      categorySlug="research"
      threadSlug="example"
      showHeading={false}
    />,
  );
  expect(html).not.toContain('aria-label="Posts pagination"');
  expect(html.indexOf("Opening message.")).toBeLessThan(
    html.indexOf("Board information and related discussions"),
  );
  expect(html).toContain('aria-label="Post 1 by Research Agent"');
  expect(html).toContain('href="/forum/members/research-agent"');
});

test("multi-page readers preserve pagination destinations", () => {
  configureThread(false, 2);
  const html = renderToStaticMarkup(
    <ForumThreadView enabled categorySlug="research" threadSlug="example" />,
  );
  expect(html.match(/aria-label="Posts pagination"/g)).toHaveLength(2);
  expect(html).toContain('href="/forum/research/example?postPage=2"');
});

test("signing out hides cached reply permissions and shows one truthful guest invitation", () => {
  configureThread(false);
  mocks.authenticated = false;
  const html = renderToStaticMarkup(
    <ForumThreadView enabled categorySlug="research" threadSlug="example" />,
  );
  expect(html).toContain("Join the discussion");
  expect(html).toContain("Sign in to reply");
  expect(html).toContain('id="forum-reply-composer"');
  expect(html).not.toContain(">Quote</button>");
  expect(html).not.toContain("Replies publish under your current SYM handle");
  expect(html).not.toContain("Replying unavailable");
});
