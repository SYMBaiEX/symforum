import { afterEach, describe, expect, test, vi } from "vitest";
import { GET as prm } from "../app/.well-known/oauth-protected-resource/route";
import {
  serviceAuthMetadata,
  serviceAuthEnabled,
  readServiceAuthBody,
  isServiceAuthSensitiveLocation,
} from "./agent-service-auth-config";
import { serviceAuthRelay } from "./agent-service-auth-relay";
import { isPrivateAnalyticsPath } from "./analytics-privacy";
import { isPrivateAiReadablePath } from "./ai-readable-path";
import { agentAuthGuide } from "./agent-auth-guide";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("service_auth discovery and transport", () => {
  test("disabled by default and never changes WorkOS hosted metadata", async () => {
    expect(serviceAuthEnabled({})).toBe(false);
    expect(
      (
        await serviceAuthRelay(
          new Request("https://www.symbaiex.com/agent-auth/jwks"),
          "jwks",
        )
      ).status,
    ).toBe(404);
    vi.stubEnv("AGENT_SERVICE_AUTH_ENABLED", "true");
    vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
    vi.stubEnv("WORKOS_AUTHKIT_ISSUER", "https://test.authkit.app");
    vi.stubEnv(
      "AGENT_SERVICE_AUTH_RELAY_SECRET",
      "test-relay-with-at-least-thirty-two-characters",
    );
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
    vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [{ kty: "RSA" }] })),
    );
    const metadata = await (
      await prm(
        new Request(
          "https://www.symbaiex.com/.well-known/oauth-protected-resource",
        ),
      )
    ).json();
    expect(metadata.authorization_servers).toEqual([
      "https://test.authkit.app",
      "https://www.symbaiex.com/agent-auth",
    ]);
    expect(metadata.scopes_supported).toEqual([
      "openid",
      "offline_access",
      "evidence",
    ]);
    expect(serviceAuthMetadata().agent_auth.identity_types_supported).toEqual([
      "service_auth",
    ]);
    expect(serviceAuthMetadata().agent_auth.events_supported).toEqual([]);
    expect(agentAuthGuide()).toContain(
      "First-party service_auth (auth.md user-claimed profile)",
    );
    for (const path of [
      "identity",
      "identity/claim",
      "token",
      "revoke",
      "jwks",
    ])
      expect(agentAuthGuide()).toContain(
        `https://www.symbaiex.com/agent-auth/${path}`,
      );
  });
  test("surfaces the enabled issuer early without losing the main heading", () => {
    vi.stubEnv("AGENT_SERVICE_AUTH_ENABLED", "true");
    expect(agentAuthGuide()).toMatch(/^# SYMBaiEX agent authentication/);
    expect(agentAuthGuide().slice(0, 2000)).toContain(
      "https://www.symbaiex.com/agent-auth/identity/claim",
    );
  });
  test("requires configured trusted relay and bounds streamed bodies", async () => {
    vi.stubEnv("AGENT_SERVICE_AUTH_ENABLED", "true");
    expect(
      (
        await serviceAuthRelay(
          new Request("https://www.symbaiex.com/agent-auth/jwks"),
          "jwks",
        )
      ).status,
    ).toBe(503);
    const metadata = await (
      await prm(
        new Request(
          "https://www.symbaiex.com/.well-known/oauth-protected-resource",
        ),
      )
    ).json();
    expect(metadata.authorization_servers).toBeUndefined();
    const large = new Request("https://www.symbaiex.com", {
      method: "POST",
      body: "x".repeat(16_385),
    });
    await expect(readServiceAuthBody(large)).rejects.toThrow("Body too large");
  });
  test("does not advertise a backend-disabled issuer alongside healthy WorkOS", async () => {
    vi.stubEnv("AGENT_SERVICE_AUTH_ENABLED", "true");
    vi.stubEnv(
      "AGENT_SERVICE_AUTH_RELAY_SECRET",
      "test-relay-with-at-least-thirty-two-characters",
    );
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
    vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
    vi.stubEnv("WORKOS_AUTHKIT_ISSUER", "https://test.authkit.app");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "not_found" }, { status: 404 })),
    );
    const response = await prm(
      new Request(
        "https://www.symbaiex.com/.well-known/oauth-protected-resource",
      ),
    );
    expect((await response.json()).authorization_servers).toEqual([
      "https://test.authkit.app",
    ]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  test("live location checks catch same-path sign-in query transitions", () => {
    expect(isServiceAuthSensitiveLocation("/signin", "")).toBe(false);
    expect(
      isServiceAuthSensitiveLocation(
        "/signin",
        "?redirectTo=%2Fagent%2Fclaim%3Fclaim_attempt_token%3Dsecret",
      ),
    ).toBe(true);
    expect(isServiceAuthSensitiveLocation("/agent/claim")).toBe(true);
  });
  test("claim and token routes cannot enter analytics or AI-readable exports", () => {
    for (const path of [
      "/agent/claim?claim_attempt_token=private",
      "/agent-auth/token",
      "/agent-auth/identity",
    ]) {
      expect(isPrivateAnalyticsPath(path)).toBe(true);
      expect(isPrivateAiReadablePath(path)).toBe(true);
    }
  });
});
