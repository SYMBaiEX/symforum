// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  authenticated: true,
  allowed: true,
  detail: null as unknown,
  conversations: [] as unknown[],
  query: vi.fn(),
}));
vi.mock("convex-helpers/react/cache/hooks", () => ({ useQuery: mocks.query }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: mocks.authenticated,
    isLoading: false,
  }),
  useMutation: () => vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/forum/messages",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => mocks.params,
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("./forum-messages", () => ({
  ForumMessages: () => <div>Legacy mailbox preserved</div>,
}));
import { ForumMessaging } from "./forum-messaging";
import { ForumRuntimeContext } from "./forum-runtime-context";

const id = "a".repeat(32);
const participants = [
  {
    userId: "alice",
    username: "alice",
    name: "Alice",
    image: null,
    isAgent: false,
  },
  { userId: "bob", username: "bob", name: "Bob", image: null, isAgent: false },
];
const conversation = {
  _id: id,
  kind: "direct",
  title: "Bob",
  participants,
  canManage: true,
  archived: false,
  muted: false,
  unreadCount: 2,
  lastSequence: 2,
  preview: "A private hello",
  updatedAt: 1791200000000,
};
beforeEach(() => {
  mocks.params = new URLSearchParams();
  mocks.authenticated = true;
  mocks.allowed = true;
  mocks.detail = null;
  mocks.conversations = [conversation];
  mocks.query.mockClear();
  mocks.query.mockImplementation((ref, args) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    if (name.endsWith("getPrivateMessageAccess"))
      return { userId: "alice", allowed: mocks.allowed };
    if (name.endsWith("listPrivateMessageConversations"))
      return { conversations: mocks.conversations, limited: false };
    if (name.endsWith("getPrivateMessageConversation")) return mocks.detail;
    return [];
  });
});
test("inbox exposes discoverable new chat, filtering, unread count and legacy recovery", () => {
  const markup = renderToStaticMarkup(<ForumMessaging enabled />);
  expect(markup).toContain('aria-label="New conversation"');
  expect(markup).toContain('aria-label="Find a conversation"');
  expect(markup).toContain('aria-label="2 unread messages"');
  expect(markup).toContain("Older mailbox");
  expect(markup).toContain("A little more connected.");
});
test("existing mailbox deep links still open old messages with a route back to conversations", () => {
  for (const params of ["mail=1", "box=trash", "message=legacy-id"]) {
    mocks.params = new URLSearchParams(params);
    const markup = renderToStaticMarkup(<ForumMessaging enabled />);
    expect(markup).toContain("Legacy mailbox preserved");
    expect(markup).toContain("Conversations");
  }
});
test("missing membership renders a safe unavailable state with no message body", () => {
  mocks.params = new URLSearchParams({ conversation: id });
  const markup = renderToStaticMarkup(<ForumMessaging enabled />);
  expect(markup).toContain("Conversation unavailable");
  expect(markup).not.toContain('aria-label="Message"');
});
test("private attachment previews and assisted author labels use the shared renderer", () => {
  mocks.params = new URLSearchParams({ conversation: id });
  mocks.detail = {
    conversation,
    viewerId: "alice",
    hasOlder: false,
    messages: [
      {
        _id: "message",
        body: "An authorized hello",
        author: participants[0],
        sequence: 2,
        createdAt: 1791200000000,
        agentAssisted: true,
        readBy: ["Bob"],
        attachments: [
          {
            storageId: "file",
            filename: "preview.png",
            contentType: "image/png",
            size: 123,
            url: "https://strong-bee-384.convex.cloud/api/storage/file",
          },
        ],
      },
    ],
  };
  const markup = renderToStaticMarkup(<ForumMessaging enabled />);
  expect(markup).toContain("Agent assisted");
  expect(markup).toContain("An authorized hello");
  expect(markup).toContain("Seen by Bob");
  expect(markup).toContain('aria-label="View image 1 of 1: preview.png"');
  expect(markup).toContain('aria-label="Send message"');
});
test("messaging consent is gated before private queries for a plugin connection", () => {
  const markup = renderToStaticMarkup(
    <ForumRuntimeContext.Provider
      value={{ host: "plugin", capabilities: ["read"] }}
    >
      <ForumMessaging enabled />
    </ForumRuntimeContext.Provider>,
  );
  expect(markup).toContain("Enable private messaging");
  expect(mocks.query.mock.calls.every(([, args]) => args === "skip")).toBe(
    true,
  );
});
test("unapproved forum access and signed-out states offer existing routes", () => {
  mocks.allowed = false;
  expect(renderToStaticMarkup(<ForumMessaging enabled />)).toContain(
    'href="/forum/control-panel"',
  );
  mocks.authenticated = false;
  expect(renderToStaticMarkup(<ForumMessaging enabled />)).toContain(
    'href="/forum/login"',
  );
});
