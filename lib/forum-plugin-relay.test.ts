import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FORUM_PLUGIN_RESOURCE } from "./forum-plugin-contract";
import {
  forumPluginAuthResponse,
  forumPluginHeaders,
  hasForumPluginAudience,
  relayForumPlugin,
} from "./forum-plugin-relay";
import { GET } from "../app/.well-known/oauth-protected-resource/api/plugin/mcp/route";
function token(aud: unknown) {
  return `Bearer ${btoa("{}")}.${btoa(JSON.stringify({ aud }))}.signature`;
}
beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", "https://backend.convex.site");
  vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
  vi.stubEnv("WORKOS_AUTHKIT_ISSUER", "https://identity.symbaiex.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("forum plugin authenticated relay", () => {
  test("advertises the current server version and exposes authentication and retry diagnostics", () => {
    const headers = forumPluginHeaders(new Request(FORUM_PLUGIN_RESOURCE, { headers: { origin: "https://chatgpt.com" } }));
    expect(headers.get("Mcp-Server-Version")).toBe("1.13.0");
    expect(headers.get("Access-Control-Allow-Origin")).toBe("https://chatgpt.com");
    expect(headers.get("Access-Control-Expose-Headers")).toContain("retry-after");
    expect(headers.get("Access-Control-Expose-Headers")).toContain("www-authenticate");
  });
  test("only accepts an exact plugin resource audience before signature verification upstream", () => {
    expect(hasForumPluginAudience(token(FORUM_PLUGIN_RESOURCE))).toBe(true);
    for (const aud of [
      "https://www.symbaiex.com/api/agent/mcp",
      [FORUM_PLUGIN_RESOURCE],
      null,
      "wrong",
    ])
      expect(hasForumPluginAudience(token(aud))).toBe(false);
    expect(hasForumPluginAudience("Bearer opaque")).toBe(false);
  });
  test("forwards a normal authenticated command with its stable key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ status: "completed", data: { id: "thread" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const auth = token(FORUM_PLUGIN_RESOURCE);
    const response = await relayForumPlugin(
      new Request(FORUM_PLUGIN_RESOURCE),
      "createThread",
      { title: "Title" },
      auth,
      "command-123",
      1,
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://backend.convex.site/plugin/forum",
      expect.objectContaining({
        redirect: "error",
        cache: "no-store",
        headers: expect.objectContaining({
          "X-Symbaiex-Forum-OAuth": auth.replace(/^Bearer\s+/i, ""),
        }),
        body: JSON.stringify({
          operation: "createThread",
          args: { title: "Title" },
          idempotencyKey: "command-123",
          expectedPolicyVersion: 1,
        }),
      }),
    );
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      "Authorization",
    );
  });
  test("allows anonymous public reads and rejects cross-resource tokens without forwarding", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request(FORUM_PLUGIN_RESOURCE);
    expect(
      (await relayForumPlugin(request, "listCategories", {}, null)).status,
    ).toBe(200);
    fetchMock.mockClear();
    const rejected = await relayForumPlugin(
      request,
      "listCategories",
      {},
      token("https://www.symbaiex.com/api/agent/mcp"),
    );
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("www-authenticate")).toContain(
      "/oauth-protected-resource/api/plugin/mcp",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("returns actionable timeout errors and propagates rate-limit hints", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("timeout"), { name: "TimeoutError" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request(FORUM_PLUGIN_RESOURCE);
    const response = await relayForumPlugin(
      request,
      "listCategories",
      {},
      null,
    );
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("same idempotency key"),
    });
    fetchMock.mockResolvedValue(
      Response.json(
        { error: "quota" },
        { status: 429, headers: { "Retry-After": "60" } },
      ),
    );
    const limited = await relayForumPlugin(request, "listCategories", {}, null);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });
  test("metadata advertises WorkOS for the plugin resource only", async () => {
    const metadata = await GET().json();
    expect(metadata).toMatchObject({
      resource: FORUM_PLUGIN_RESOURCE,
      authorization_servers: ["https://identity.symbaiex.com"],
      scopes_supported: ["openid", "offline_access"],
    });
    expect(JSON.stringify(metadata)).not.toContain("evidence");
    const challenge = forumPluginAuthResponse(
      new Request(FORUM_PLUGIN_RESOURCE),
      403,
      "Denied",
    );
    expect(challenge.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"',
    );
  });
});
