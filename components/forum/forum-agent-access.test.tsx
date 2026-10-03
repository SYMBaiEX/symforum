// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.mock("next/navigation", () => ({
  usePathname: () => "/forum/control-panel/agent-access",
}));
import {
  DEFAULT_FORUM_CONNECTION_OPTIONS,
  ForumConnectionFields,
  forumProposalPreview,
} from "./forum-agent-access";

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
