import { getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useQuery: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
}));

import { AgentOAuthConnect } from "./agent-oauth-connect";
import { AgentServiceClaim } from "./agent-service-claim";

const surfaces = [
  {
    name: "service claim",
    path: "/agent/claim",
    parameter: "claim_attempt_token",
    render: (token: string | null) => (
      <AgentServiceClaim attemptToken={token} />
    ),
    privateQueries: [
      "agentServiceAuth:viewClaim",
      "agentIdentity:listMyAgentConsoleStatus",
      "agentServiceAuth:listMyRegistrations",
    ],
  },
  {
    name: "WorkOS connection",
    path: "/agent/connect",
    parameter: "external_auth_id",
    render: (token: string | null) => (
      <AgentOAuthConnect externalAuthId={token} />
    ),
    privateQueries: [
      "agentIdentity:listMyAgentConsoleStatus",
      "agentOAuth:listMyConnections",
    ],
  },
];

describe.each(surfaces)("$name public entry", (surface) => {
  let viewer: { isAgent: boolean } | null | undefined;

  beforeEach(() => {
    viewer = null;
    mocks.useQuery.mockReset();
    mocks.useQuery.mockImplementation((reference, args) => {
      const name = getFunctionName(reference);
      // Mirror the production distinction: the strict viewer crashes public
      // entry pages; only the nullable query supports a signed-out visitor.
      if (name === "users:viewer") throw new Error("Not signed in");
      if (name === "users:maybeViewer") return viewer;
      if (args === "skip") return undefined;
      if (name === "agentIdentity:listMyAgentConsoleStatus")
        return { agents: [] };
      if (name === "agentServiceAuth:viewClaim") return null;
      return [];
    });
  });

  function expectPrivateQueriesSkipped() {
    const calls = mocks.useQuery.mock.calls.map(([reference, args]) => [
      getFunctionName(reference),
      args,
    ]);
    expect(calls).toContainEqual(["users:maybeViewer", {}]);
    for (const name of surface.privateQueries) {
      expect(calls).toContainEqual([name, "skip"]);
    }
  }

  test.each([null, "opaque+/=&? value"])(
    "signed-out visitors can sign in without losing request %s",
    (token) => {
      const markup = renderToStaticMarkup(surface.render(token));
      const destination = token
        ? `${surface.path}?${surface.parameter}=${encodeURIComponent(token)}`
        : surface.path;
      expect(markup).toContain(
        `href="/signin?mode=signIn&amp;redirectTo=${encodeURIComponent(destination)}"`,
      );
      expect(markup).toContain("Sign in");
      expectPrivateQueriesSkipped();
    },
  );

  test("waits for authentication before querying owner data", () => {
    viewer = undefined;
    const markup = renderToStaticMarkup(surface.render("test-request"));
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Loading your account");
    expectPrivateQueriesSkipped();
  });

  test("agent sessions cannot initiate the human approval flow", () => {
    viewer = { isAgent: true };
    const markup = renderToStaticMarkup(surface.render("test-request"));
    expect(markup).toContain("Sign in with the human account");
    expect(markup).not.toContain("<form");
    expectPrivateQueriesSkipped();
  });

  test("human sessions still load their owner data", () => {
    viewer = { isAgent: false };
    const markup = renderToStaticMarkup(surface.render(null));
    expect(markup).not.toContain("/signin?");
    const calls = mocks.useQuery.mock.calls.map(([reference, args]) => [
      getFunctionName(reference),
      args,
    ]);
    expect(calls).toContainEqual([
      "agentIdentity:listMyAgentConsoleStatus",
      {},
    ]);
    expect(calls).toContainEqual([surface.privateQueries.at(-1), {}]);
  });
});
