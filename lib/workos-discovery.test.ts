import { afterEach, describe, expect, test, vi } from "vitest";
import { workosConfig, WORKOS_AGENT_RESOURCE } from "./workos-config";
import {
  GET as authorizationMetadata,
  HEAD as authorizationHead,
} from "@/app/.well-known/oauth-authorization-server/route";
import { GET as resourceMetadata } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as manifest } from "@/app/api/agent/route";
import { GET as authGuide } from "@/app/auth.md/route";
import { agentBearerChallenge } from "./agent-auth-metadata";
import { isPrivateAiReadablePath } from "./ai-readable-path";
import { shouldSendVercelAnalyticsEvent } from "./analytics-privacy";

const issuer = "https://test.authkit.app";
const metadata = {
  issuer,
  authorization_endpoint: `${issuer}/oauth2/authorize`,
  token_endpoint: `${issuer}/oauth2/token`,
  jwks_uri: `${issuer}/oauth2/jwks`,
  code_challenge_methods_supported: ["S256"],
  response_types_supported: ["code"],
  scopes_supported: ["openid", "offline_access"],
};
function enabled() {
  vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
  vi.stubEnv("WORKOS_AUTHKIT_ISSUER", issuer);
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("truthful WorkOS discovery", () => {
  test("publishes no OAuth provider while disabled and never contacts one", async () => {
    vi.stubEnv("WORKOS_CONNECT_ENABLED", "false");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      (
        await authorizationMetadata(
          new Request(
            "https://www.symbaiex.com/.well-known/oauth-authorization-server",
          ),
        )
      ).status,
    ).toBe(404);
    expect(
      await (
        await resourceMetadata(
          new Request(
            "https://www.symbaiex.com/.well-known/oauth-protected-resource",
          ),
        )
      ).json(),
    ).not.toHaveProperty("authorization_servers");
    expect((await manifest().json()).authentication.oauth2).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  test.each([
    "http://test.authkit.app",
    "https://user:pass@test.authkit.app",
    "https://test.authkit.app/path",
    "https://test.authkit.app?key=value",
    "https://authkit.app.evil.test",
    "https://localhost",
    "https://test.authkit.app:444",
  ])("rejects unsafe issuer %s", (value) => {
    expect(() =>
      workosConfig({
        WORKOS_CONNECT_ENABLED: "true",
        WORKOS_AUTHKIT_ISSUER: value,
      }),
    ).toThrow();
  });
  test("redirects aliases to the actual issuer and preserves its metadata", async () => {
    enabled();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(metadata)),
    );
    const alias = await authorizationMetadata(
      new Request(
        "https://www.symbaiex.com/.well-known/oauth-authorization-server",
      ),
    );
    expect(alias.status).toBe(307);
    expect(alias.headers.get("location")).toBe(
      `${issuer}/.well-known/oauth-authorization-server`,
    );
    expect(alias.headers.get("cache-control")).toBe("no-store");
    expect(await alias.text()).toBe("");
    expect(fetch).not.toHaveBeenCalled();

    const issuerResponse = await authorizationMetadata(
      new Request(`${issuer}/.well-known/oauth-authorization-server`),
    );
    expect(issuerResponse.status).toBe(200);
    expect(await issuerResponse.json()).toEqual(metadata);

    const head = await authorizationHead(
      new Request(
        "https://www.symbaiex.com/.well-known/oauth-authorization-server",
        { method: "HEAD" },
      ),
    );
    expect(head.status).toBe(307);
    expect(head.headers.get("location")).toBe(
      `${issuer}/.well-known/oauth-authorization-server`,
    );
    expect(await head.text()).toBe("");
    expect(
      await (
        await resourceMetadata(
          new Request(
            "https://www.symbaiex.com/.well-known/oauth-protected-resource",
          ),
        )
      ).json(),
    ).toMatchObject({
      resource: WORKOS_AGENT_RESOURCE,
      authorization_servers: [issuer],
      scopes_supported: ["openid", "offline_access"],
    });
    expect((await manifest().json()).authentication.oauth2).toMatchObject({
      issuer,
      permission: "evidence",
    });
    expect(agentBearerChallenge(401)).toContain(
      'scope="openid offline_access"',
    );
    expect(await authGuide().text()).toContain("OAuth is enabled.");
    expect(
      isPrivateAiReadablePath("/agent/connect?external_auth_id=temporary"),
    ).toBe(true);
    expect(
      shouldSendVercelAnalyticsEvent(
        "https://www.symbaiex.com/agent/connect?external_auth_id=temporary",
      ),
    ).toBe(false);
  });
  test.each([
    { ...metadata, issuer: "https://other.authkit.app" },
    { ...metadata, token_endpoint: "https://evil.example/tokens" },
    { ...metadata, code_challenge_methods_supported: ["plain"] },
    { ...metadata, token_endpoint: undefined },
    { ...metadata, registration_endpoint: "https://evil.example/register" },
    { ...metadata, padding: "x".repeat(66_000) },
  ])("rejects unsafe/incomplete upstream metadata", async (data) => {
    enabled();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(data)),
    );
    const response = await authorizationMetadata(
      new Request(`${issuer}/.well-known/oauth-authorization-server`),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("evil.example");
  });
});
