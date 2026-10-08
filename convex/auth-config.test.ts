import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("enabled auth configuration evaluates without Node Buffer and preserves other issuers", async () => {
  vi.resetModules();
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
  vi.stubEnv("WORKOS_AUTHKIT_ISSUER", "https://test.authkit.app");
  vi.stubEnv("AGENT_SERVICE_AUTH_ENABLED", "true");
  // Synthetic public data only; the deployment evaluator does not expose Node globals.
  const jwks = JSON.stringify({ keys: [{ kty: "RSA", kid: "test-key" }] });
  vi.stubEnv("AGENT_SERVICE_AUTH_PUBLIC_JWKS", jwks);
  const expected = `data:application/json;base64,${btoa(jwks)}`;
  vi.stubGlobal("Buffer", undefined);
  const { default: config } = await import("./auth.config");
  expect(config.providers).toHaveLength(3);
  expect(
    config.providers.some(
      (provider) =>
        provider.applicationID === "https://www.symbaiex.com/api/plugin/mcp",
    ),
  ).toBe(false);
  expect(config.providers[0]).toMatchObject({
    type: "customJwt",
    issuer: "https://www.symbaiex.com/agent-auth",
    applicationID: "https://www.symbaiex.com/api/agent/mcp",
    jwks: expected,
    algorithm: "RS256",
  });
  expect(config.providers[1]).toEqual({
    domain: "https://test.convex.site",
    applicationID: "convex",
  });
  expect(config.providers[2]).toMatchObject({
    issuer: "https://test.authkit.app",
    applicationID: "https://www.symbaiex.com/api/agent/mcp",
  });
});

test("registers the WorkOS Agent Registration resource issuer without Connect", async () => {
  vi.resetModules();
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  vi.stubEnv("WORKOS_CONNECT_ENABLED", "false");
  vi.stubEnv("WORKOS_AGENT_REGISTRATION_ENABLED", "true");
  vi.stubEnv("WORKOS_AUTHKIT_ISSUER", "https://test.authkit.app");

  const { default: config } = await import("./auth.config");
  expect(config.providers).toEqual([
    {
      domain: "https://test.convex.site",
      applicationID: "convex",
    },
    {
      type: "customJwt",
      issuer: "https://test.authkit.app",
      applicationID: "https://www.symbaiex.com/api/agent/mcp",
      jwks: "https://test.authkit.app/oauth2/jwks",
      algorithm: "RS256",
    },
  ]);
});
