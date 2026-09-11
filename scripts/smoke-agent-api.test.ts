import { afterEach, describe, expect, test, vi } from "vitest";
import { publicSmoke } from "./smoke-agent-api.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const issuer = "https://test.authkit.app";
function mockResponses(
  oauth: boolean,
  advertisedIssuer = issuer,
  challengeScope = oauth ? "openid offline_access" : "evidence",
  serviceAuth = false,
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/agent"))
      return Response.json({
        version: "v1",
        monetization: { enabled: false },
        graphql: { enabled: false },
        authentication: { oauth2: oauth ? { issuer } : false },
      });
    if (url.endsWith("/openapi.json"))
      return Response.json({
        paths: {
          "/v1/entitlements": {
            get: { operationId: "getEvidenceEntitlements" },
          },
        },
      });
    if (url.endsWith("/oauth-protected-resource"))
      return Response.json({
        resource: "https://www.symbaiex.com/api/agent/mcp",
        scopes_supported: oauth
          ? ["openid", "offline_access", ...(serviceAuth ? ["evidence"] : [])]
          : ["evidence"],
        "x-symbaiex-authentication": { oauth2: false },
        ...(oauth
          ? {
              authorization_servers: [
                advertisedIssuer,
                ...(serviceAuth ? ["https://www.symbaiex.com/agent-auth"] : []),
              ],
            }
          : {}),
      });
    if (url.endsWith("/symbaiex-agent-authentication"))
      return Response.json({
        protocol: "symbaiex_ed25519_challenge_v1",
        protocol_type: "custom",
      });
    if (url.endsWith("/oauth-authorization-server"))
      return Response.json({
        issuer,
        code_challenge_methods_supported: ["S256"],
        response_types_supported: ["code"],
      });
    if (url.endsWith("/v1/status")) return Response.json({}, { status: 401 });
    if (url.endsWith("/mcp")) {
      const message = JSON.parse(String(init?.body));
      if (message.method === "tools/list")
        return Response.json({
          result: { tools: [{ name: "evidence_search" }] },
        });
      return Response.json(
        {},
        {
          status: 401,
          headers: {
            "www-authenticate": `Bearer error="invalid_token", scope="${challengeScope}", resource_metadata="https://www.symbaiex.com/.well-known/oauth-protected-resource"`,
          },
        },
      );
    }
    throw new Error("Unexpected smoke request.");
  });
}
describe("public authentication release smoke", () => {
  test.each([false, true])(
    "checks Ed25519 and optional OAuth without sending credentials: %s",
    async (oauth) => {
      const fetcher = mockResponses(oauth);
      vi.stubGlobal("fetch", fetcher);
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      await expect(publicSmoke()).resolves.toBeUndefined();
      expect(
        fetcher.mock.calls.some(([url]) =>
          String(url).endsWith("/oauth-authorization-server"),
        ),
      ).toBe(oauth);
    },
  );
  test("fails mismatched advertised issuers", async () => {
    vi.stubGlobal("fetch", mockResponses(true, "https://other.authkit.app"));
    await expect(publicSmoke()).rejects.toThrow(/inconsistent/i);
  });
  test.each(["openid offline_access", "evidence"])(
    "accepts a supported scope subset with multiple issuers: %s",
    async (scope) => {
      vi.stubGlobal("fetch", mockResponses(true, issuer, scope, true));
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      await expect(publicSmoke()).resolves.toBeUndefined();
    },
  );
  test("rejects scopes outside the multi-issuer resource metadata", async () => {
    vi.stubGlobal("fetch", mockResponses(true, issuer, "admin", true));
    await expect(publicSmoke()).rejects.toThrow(/scope metadata/i);
  });
  test("fails when the OAuth challenge still advertises the custom protocol scope", async () => {
    vi.stubGlobal("fetch", mockResponses(true, issuer, "evidence"));
    await expect(publicSmoke()).rejects.toThrow(/scope metadata/i);
  });
});
