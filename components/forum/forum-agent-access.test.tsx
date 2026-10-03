// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authenticated: true,
  viewer: { isAgent: false },
  commands: [] as unknown[],
  pendingContent: { items: [] as unknown[], limited: false },
  query: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: mocks.authenticated,
    isLoading: false,
  }),
  useMutation: () => vi.fn(),
  useQuery: mocks.query,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/forum/control-panel/agent-access",
  useSearchParams: () => new URLSearchParams(),
}));
import {
  DEFAULT_FORUM_CONNECTION_OPTIONS,
  ForumConnectionFields,
  ForumApprovalQueue,
  ForumAgentApprovalNotice,
  ForumAgentModerationQueue,
  forumProposalState,
  forumProposalTarget,
  forumProposalPreview,
} from "./forum-agent-access";
import { forumPluginRefs, type ForumProposal } from "./forum-plugin-refs";

beforeEach(() => {
  mocks.authenticated = true;
  mocks.viewer = { isAgent: false };
  mocks.commands = [];
  mocks.pendingContent = { items: [], limited: false };
  mocks.query.mockReset();
  mocks.query.mockImplementation((reference, args) =>
    args === "skip"
      ? undefined
      : reference === forumPluginRefs.listCommands
        ? mocks.commands
        : reference === forumPluginRefs.listMyPendingContent
          ? mocks.pendingContent
          : mocks.viewer,
  );
});
const command: ForumProposal = {
  _id: "command-one",
  connectionId: "connection-one",
  actorUserId: "original-actor",
  operation: "createThread",
  argsJson: JSON.stringify({
    title: "Sample thread",
    categoryId: "board-one",
    body: "<script>unsafe()</script>",
  }),
  status: "pending",
  createdAt: 100,
  expiresAt: Date.now() + 86_400_000,
};

test("consent defaults exclude private messages and staff capabilities", () => {
  expect(DEFAULT_FORUM_CONNECTION_OPTIONS.actorMode).toBe("human");
  expect(DEFAULT_FORUM_CONNECTION_OPTIONS.executionMode).toBe("direct");
  expect(DEFAULT_FORUM_CONNECTION_OPTIONS.capabilities).not.toEqual(
    expect.arrayContaining(["messages"]),
  );
  for (const capability of ["messages", "moderate", "administer", "accounts"])
    expect(DEFAULT_FORUM_CONNECTION_OPTIONS.capabilities).not.toContain(
      capability,
    );
  const html = renderToStaticMarkup(
    <ForumConnectionFields
      value={DEFAULT_FORUM_CONNECTION_OPTIONS}
      agents={[]}
      onChange={() => {}}
    />,
  );
  expect(html).toContain("My own profile");
  expect(html).toContain("New agent profile");
  expect(html).toContain("Require review");
  expect(html).toContain("<legend");
  expect(html).toContain('type="radio"');
  expect(html).toContain('type="checkbox"');
});

test("settings cannot select capabilities beyond the granted ceiling", () => {
  const html = renderToStaticMarkup(
    <ForumConnectionFields
      value={{ ...DEFAULT_FORUM_CONNECTION_OPTIONS, capabilities: ["read"] }}
      agents={[]}
      ceiling={["read"]}
      onChange={() => {}}
    />,
  );
  expect(html).toContain("Needs new consent");
  expect((html.match(/disabled=""/g) ?? []).length).toBe(9);
});

test("approval previews preserve exact requested content without executing markup", () => {
  const preview = forumProposalPreview(
    JSON.stringify({
      body: '<script>alert("hi")</script>',
      threadId: "thread-123",
    }),
  );
  expect(preview).toContain("<script>");
  expect(preview).toContain('"threadId": "thread-123"');
  expect(forumProposalPreview("broken-json")).toContain("Reject it");
});

test("approval queue distinguishes owner proposals from staff moderation and focuses exact request", () => {
  const html = renderToStaticMarkup(
    <ForumApprovalQueue
      commands={[command]}
      connections={[]}
      selectedCommandId={command._id}
      onResolved={() => {}}
    />,
  );
  expect(html).toContain('id="review-queue"');
  expect(html).toContain("1 waiting for you");
  expect(html).toContain("Not executed");
  expect(html).toContain("Approve and execute");
  expect(html).toContain("Forum moderation is separate");
  expect(html).toContain('id="forum-command-command-one"');
  expect(html).toContain('tabindex="-1"');
  expect(html).toContain('<details open="">');
  expect(html).toContain("title: Sample thread");
  expect(html).toContain("categoryId: board-one");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("expired and policy-invalidated requests remain discoverable but cannot be approved", () => {
  const expired = { ...command, expiresAt: 10 };
  const invalidated = {
    ...command,
    _id: "command-two",
    status: "invalidated" as const,
  };
  expect(forumProposalState(expired, 11)).toBe("expired");
  expect(forumProposalState(invalidated, 11)).toBe("invalidated");
  const html = renderToStaticMarkup(
    <ForumApprovalQueue
      commands={[expired, invalidated]}
      connections={[]}
      onResolved={() => {}}
    />,
  );
  expect(html).toContain("0 waiting for you");
  expect(html).toContain("This request expired and did not run");
  expect(html).toContain("This request cannot run");
  expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
});

test("command links do not reveal another owner's request and malformed previews stay safe", () => {
  const html = renderToStaticMarkup(
    <ForumApprovalQueue
      commands={[]}
      connections={[]}
      selectedCommandId="another-owner-command"
      onResolved={() => {}}
    />,
  );
  expect(html).toContain("belongs to another account");
  expect(html).not.toContain("Approve and execute");
  expect(forumProposalTarget("broken")).toBe("Request unavailable");
});

test("only authenticated human owners query the approval notice", () => {
  mocks.viewer = { isAgent: true };
  expect(renderToStaticMarkup(<ForumAgentApprovalNotice />)).toBe("");
  expect(mocks.query).toHaveBeenCalledWith(
    forumPluginRefs.listCommands,
    "skip",
  );
  mocks.viewer = { isAgent: false };
  mocks.commands = [command];
  const html = renderToStaticMarkup(<ForumAgentApprovalNotice />);
  expect(html).toContain("1 agent request waiting for your approval");
  expect(html).toContain("Review agent requests");
  expect(html).toContain("/forum/control-panel/agent-access#review-queue");
});

test("execution mode radios belong to their own connection, while direct retains moderation", () => {
  const fields = (
    <ForumConnectionFields
      value={DEFAULT_FORUM_CONNECTION_OPTIONS}
      agents={[]}
      onChange={() => {}}
    />
  );
  const html = renderToStaticMarkup(
    <>
      {fields}
      {fields}
    </>,
  );
  const groups = [...html.matchAll(/name="(executionMode-[^"]+)"/g)].map(
    (match) => match[1],
  );
  expect(groups).toHaveLength(4);
  expect(new Set(groups).size).toBe(2);
  expect(html).toContain("Forum moderation may still apply");
});

test("agent-owned submitted posts have a visible moderation queue without owner approval controls", () => {
  const pendingContent = {
    items: [
      {
        id: "pending-agent-thread",
        kind: "thread" as const,
        title: "Sample pending thread",
        body: "<script>untrusted()</script>",
        categoryName: "General",
        actingAs: {
          userId: "agent-profile",
          username: "my-agent",
          isAgent: true,
        },
        createdAt: 10,
        url: "https://forum.symbaiex.com/general/sample-pending-thread",
      },
    ],
    limited: true,
  };
  const html = renderToStaticMarkup(
    <ForumAgentModerationQueue
      pendingContent={pendingContent}
      canModerate={false}
    />,
  );
  expect(html).toContain('id="moderation-queue"');
  expect(html).toContain("my-agent · AI");
  expect(html).toContain("Not public");
  expect(html).toContain("Sample pending thread");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("Approve");
  expect(html).not.toContain("Review in Moderator CP");
  expect(html).toContain("limited set");
  const staffHtml = renderToStaticMarkup(
    <ForumAgentModerationQueue pendingContent={pendingContent} canModerate />,
  );
  expect(staffHtml).toContain("Review in Moderator CP");
  expect(staffHtml).toContain("/forum/moderation");
});

test("pending submission queue has distinct loading, empty and restriction states", () => {
  expect(
    renderToStaticMarkup(<ForumAgentModerationQueue canModerate={false} />),
  ).toContain("Loading pending submissions");
  expect(
    renderToStaticMarkup(
      <ForumAgentModerationQueue
        pendingContent={{ items: [], limited: false }}
        canModerate={false}
      />,
    ),
  ).toContain("No visible posts");
  expect(
    renderToStaticMarkup(
      <ForumAgentModerationQueue
        pendingContent={{ items: [], limited: false, restricted: true }}
        canModerate={false}
      />,
    ),
  ).toContain("You can still manage or disconnect");
});

test("a policy change never relabels the original proposal as the newly selected profile", () => {
  const connections = [
    {
      _id: command.connectionId,
      actorMode: "human" as const,
      transport: "oauth" as const,
      actingAs: {
        userId: "different-profile",
        username: "new-profile",
        isAgent: false,
      },
      credentialAgentId: "agent-credential",
      capabilities: ["read" as const],
      capabilityCeiling: ["read" as const],
      executionMode: "direct" as const,
      policyVersion: 2,
      status: "active" as const,
      createdAt: 100,
    },
  ];
  const html = renderToStaticMarkup(
    <ForumApprovalQueue
      commands={[{ ...command, status: "invalidated" }]}
      connections={connections}
      selectedCommandId={command._id}
      onResolved={() => {}}
    />,
  );
  expect(html).toContain("Acting as original-actor");
  expect(html).not.toContain("new-profile");
  expect(html).toContain("cannot run");
  expect(html).toContain('disabled=""');
});

test("outstanding requests stay ahead of history and a selected previous request remains visible", () => {
  const pending = { ...command, _id: "pending-two" };
  const previous = {
    ...command,
    _id: "completed-one",
    status: "completed" as const,
  };
  const html = renderToStaticMarkup(
    <ForumApprovalQueue
      commands={[previous, pending]}
      connections={[]}
      selectedCommandId={previous._id}
      onResolved={() => {}}
    />,
  );
  expect(html).toContain("1 waiting for you");
  expect(html.indexOf('id="forum-command-pending-two"')).toBeLessThan(
    html.indexOf('id="forum-command-completed-one"'),
  );
  expect(html).toMatch(/<details[^>]*open=""[^>]*>/);
  expect(html).toContain("Previous requests (1)");
});
