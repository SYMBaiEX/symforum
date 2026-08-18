import { describe, expect, test } from "vitest";
import {
  certificationPlan,
  redactValue,
  refreshSession,
  verifyKeyLogin,
  verifyPublicMetadata,
  verifyScopeDenied,
  verifySession,
} from "./lib/agent-auth-certification.mjs";

describe("agent auth certification harness", () => {
  test("defaults to a zero-network, zero-mutation plan", () => {
    const plan = certificationPlan({ baseUrl: "https://www.symbaiex.com/api/agent", agentId: undefined, includesLifecycle: false });
    expect(plan.networkRequests).toBe(0);
    expect(plan.mutations).toBe(0);
    expect(plan.steps.join(" ")).toMatch(/owner console/i);
  });

  test("redacts credential-shaped data recursively", () => {
    expect(redactValue({ accessToken: "secret", nested: { signature: "secret", safe: "ok" } })).toEqual({ accessToken: "[REDACTED]", nested: { signature: "[REDACTED]", safe: "ok" } });
  });

  test("accepts truthful Ed25519-only metadata", async () => {
    const fetchImpl = async (url: string) => new Response(JSON.stringify(url.includes("oauth-protected")
      ? { "x-symbaiex-authentication": { oauth2: false } }
      : { protocol: "symbaiex_ed25519_challenge_v1", oauth2: { supported: false } }), { status: 200 });
    await expect(verifyPublicMetadata({ fetchImpl: fetchImpl as typeof fetch })).resolves.toMatchObject({ authentication: "ed25519" });
  });

  test("records a scope denial without reading a response body", async () => {
    const fetchImpl = async () => new Response(null, { status: 403, headers: { "www-authenticate": 'Bearer error="insufficient_scope"' } });
    await expect(verifyScopeDenied({ fetchImpl: fetchImpl as typeof fetch, session: { accessToken: "a".repeat(32) } })).resolves.toMatchObject({ status: 403 });
  });

  test("requires a 401 for a revoked bearer", async () => {
    const fetchImpl = async () => new Response(null, { status: 401 });
    await expect(verifySession({ fetchImpl: fetchImpl as typeof fetch, session: { accessToken: "a".repeat(32) }, expectation: 401 })).resolves.toEqual({ status: 401, expectation: 401 });
  });

  test("uses only an in-memory rotated refresh session", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ tokens: { token: "n".repeat(32), refreshToken: "r".repeat(32) } }), { status: 200 });
    const refreshed = await refreshSession({ fetchImpl: fetchImpl as typeof fetch, session: { accessToken: "a".repeat(32), refreshToken: "b".repeat(32) } });
    expect(refreshed.accessToken).toBe("n".repeat(32));
  });

  test("refuses a malformed key before it can reach the network", async () => {
    await expect(verifyKeyLogin({ agentId: "cert", key: { algorithm: "Ed25519" }, expectation: 401 })).rejects.toThrow(/valid Ed25519 key/i);
  });
});
