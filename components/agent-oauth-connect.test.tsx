// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: mocks.query,
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
}));
import { AgentOAuthConnect } from "./agent-oauth-connect";

test("shared WorkOS login requires explicit forum/evidence choice and preserves request ID", () => {
  mocks.query
    .mockReturnValueOnce({ _id: "human-user", isAgent: false })
    .mockReturnValueOnce({ agents: [] })
    .mockReturnValueOnce([]);
  const request = "auth_request_0123456789";
  const html = renderToStaticMarkup(
    <AgentOAuthConnect externalAuthId={request} />,
  );
  expect(html).toContain("Connect forum access");
  expect(html).toContain("Connect evidence access");
  expect(html).toContain(`/agent/forum-connect?external_auth_id=${request}`);
  expect(html).not.toContain("Continue to authorization");
});
