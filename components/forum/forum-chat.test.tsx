// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { ForumChatMessage, ForumChatPage } from "./forum-chat-refs";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  data: undefined as unknown,
  authLoading: false,
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: true,
    isLoading: mocks.authLoading,
  }),
  useQuery: (reference: unknown, args: unknown) => {
    mocks.query(reference, args);
    return args === "skip" ? undefined : mocks.data;
  },
  useMutation: () => vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/forum",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/image", () => ({ default: () => null }));
import { ForumChat, ChatMessage, isForumChatAnchor } from "./forum-chat";
import { forumChatRefs } from "./forum-chat-refs";

function message(id: string, body: string, time: number): ForumChatMessage {
  return {
    _id: id,
    body,
    createdAt: time,
    updatedAt: time,
    status: "active",
    agentAssisted: false,
    authorIdentity: {
      userId: "actor",
      username: "austin",
      name: "Austin",
      isAgent: false,
    },
    canDelete: false,
  } as ForumChatMessage;
}
function page(): ForumChatPage {
  return {
    page: [],
    isDone: true,
    continueCursor: "",
    pending: [],
    pendingLimited: false,
    viewer: {
      canRead: true,
      canSend: false,
      canModerate: false,
      actingAs: null,
    },
  };
}
beforeEach(() => {
  mocks.data = page();
  mocks.authLoading = false;
  mocks.query.mockClear();
});

test("public chat presents an honest empty state, accessible collapse and sign-in entry", () => {
  const html = renderToStaticMarkup(<ForumChat defaultOpen />);
  expect(html).toContain('id="forum-chat"');
  expect(html).toContain('role="log"');
  expect(html).toContain("No messages yet.");
  expect(html).toContain("Sign in to join the public chat");
  expect(html).toContain('aria-expanded="true"');
  expect(mocks.query).toHaveBeenCalledWith(forumChatRefs.listChatMessages, {
    paginationOpts: { numItems: 40, cursor: null },
  });
});

test("descending server data displays chronologically and private pending content stays outside public log", () => {
  const data = page();
  data.page = [
    message("new", "Newer message", 2000),
    message("old", "Older message", 1000),
  ];
  data.isDone = false;
  data.pending = [
    {
      ...message("waiting", "Waiting privately", 3000),
      status: "pending",
      canDelete: true,
    },
  ];
  data.pendingLimited = true;
  data.viewer = {
    canRead: true,
    canSend: true,
    canModerate: false,
    actingAs: { userId: "actor", username: "austin", isAgent: false },
  };
  mocks.data = data;
  const html = renderToStaticMarkup(<ForumChat defaultOpen />);
  expect(html.indexOf("Older message")).toBeLessThan(
    html.indexOf("Newer message"),
  );
  expect(html).toContain("Showing the latest 2 messages");
  expect(html).toContain("Awaiting staff moderation");
  expect(html).toContain("10 most recent pending messages");
  expect(html.indexOf("Waiting privately")).toBeGreaterThan(
    html.indexOf("Awaiting staff moderation"),
  );
  expect(html).toContain('maxLength="2000"');
  expect(html).not.toContain("Your messages need moderator approval");
});

test("room access loss suppresses logs and composer instead of claiming an empty chat", () => {
  const data = page();
  data.viewer.canRead = false;
  data.viewer.canSend = false;
  mocks.data = data;
  const html = renderToStaticMarkup(<ForumChat defaultOpen />);
  expect(html).toContain("current General board permissions");
  expect(html).not.toContain('role="log"');
  expect(html).not.toContain("No messages yet");
  expect(html).not.toContain("<input");
});

test("auth loading skips the subscription and staff queue stays unsubscribed until expanded", () => {
  mocks.authLoading = true;
  let html = renderToStaticMarkup(<ForumChat defaultOpen />);
  expect(html).toContain("Loading chat");
  expect(mocks.query).toHaveBeenLastCalledWith(
    forumChatRefs.listChatMessages,
    "skip",
  );
  mocks.authLoading = false;
  const data = page();
  data.viewer.canModerate = true;
  mocks.data = data;
  html = renderToStaticMarkup(<ForumChat defaultOpen />);
  expect(html).toContain("Chat moderation");
  expect(mocks.query).toHaveBeenCalledWith(
    forumChatRefs.listChatPendingMessages,
    "skip",
  );
});

test("messages escape plain text and identify agents and agent-assisted humans", () => {
  const agent = {
    ...message("ai", "<script>bad</script>", 1000),
    authorIdentity: {
      userId: "agent",
      username: "agent",
      name: "Agent",
      isAgent: true,
    },
  };
  const html = renderToStaticMarkup(
    <ChatMessage message={agent} deleting={false} onDelete={() => {}} />,
  );
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain(">AI</span>");
  const assisted = renderToStaticMarkup(
    <ChatMessage
      message={{ ...message("human", "Hello", 1000), agentAssisted: true }}
      deleting={false}
      onDelete={() => {}}
    />,
  );
  expect(assisted).toContain("AI assisted");
});

test("chat starts collapsed and requests only one public preview message", () => {
  const html = renderToStaticMarkup(<ForumChat />);
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("Open chat");
  expect(html).not.toContain('role="log"');
  expect(mocks.query).toHaveBeenCalledWith(forumChatRefs.listChatMessages, {
    paginationOpts: { numItems: 1, cursor: null },
  });
});

test("collapsed preview respects revoked room access and never exposes pending messages", () => {
  const data = page();
  data.page = [message("public", "Public preview", 2000)];
  data.pending = [
    {
      ...message("pending", "Private waiting message", 3000),
      status: "pending",
    },
  ];
  mocks.data = data;
  const visible = renderToStaticMarkup(<ForumChat />);
  expect(visible).toContain("Austin: Public preview");
  expect(visible).not.toContain("Private waiting message");
  data.viewer.canRead = false;
  const revoked = renderToStaticMarkup(<ForumChat />);
  expect(revoked).toContain("Chat unavailable");
  expect(revoked).not.toContain("Public preview");
  expect(revoked).not.toContain("Private waiting message");
});

test("collapsed preview skips old message data while authentication changes", () => {
  const data = page();
  data.page = [message("old", "Previous identity message", 2000)];
  mocks.data = data;
  mocks.authLoading = true;
  const html = renderToStaticMarkup(<ForumChat />);
  expect(mocks.query).toHaveBeenLastCalledWith(
    forumChatRefs.listChatMessages,
    "skip",
  );
  expect(html).not.toContain("Previous identity message");
});

test("canonical lounge deep links open chat while unrelated anchors leave disclosure state alone", () => {
  expect(isForumChatAnchor("#forum-chat")).toBe(true);
  expect(isForumChatAnchor("")).toBe(false);
  expect(isForumChatAnchor("#post-1")).toBe(false);
  expect(isForumChatAnchor("#forum-chat-content")).toBe(false);
});

test("collapsed chat exposes the acting profile's pending count without disclosing pending text", () => {
  const data = page();
  data.viewer.actingAs = {
    userId: "actor",
    username: "austin",
    isAgent: false,
  };
  data.pending = [
    {
      ...message("pending", "Private pending content", 3000),
      status: "pending",
    },
  ];
  mocks.data = data;
  const html = renderToStaticMarkup(<ForumChat />);
  expect(html).toContain(
    'aria-label="Open your 1 lounge messages awaiting staff moderation"',
  );
  expect(html).toContain("1 pending");
  expect(html).not.toContain("Private pending content");
  data.viewer.canRead = false;
  expect(renderToStaticMarkup(<ForumChat />)).not.toContain("1 pending");
});

test("collapsed chat retains explicit agent identity in its public preview", () => {
  const data = page();
  data.page = [
    {
      ...message("agent", "Hello from an agent", 1000),
      authorIdentity: {
        userId: "agent",
        username: "agent",
        name: "Agent",
        isAgent: true,
      },
    },
  ];
  mocks.data = data;
  expect(renderToStaticMarkup(<ForumChat />)).toContain(
    "Agent (AI): Hello from an agent",
  );
});
