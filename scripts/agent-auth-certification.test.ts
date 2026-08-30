import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  assertPrivateJsonFile,
  certificationPlan,
  redactValue,
  redactedError,
  refreshSession,
  validateLifecycleConfig,
  validateAgentId,
  validatePhaseInputs,
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

  test("rejects arbitrary origins before any public metadata request", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(null, { status: 500 });
    };
    await expect(verifyPublicMetadata({ fetchImpl: fetchImpl as typeof fetch, baseUrl: "https://evil.example/api/agent" })).rejects.toThrow(/pinned/i);
    expect(calls).toBe(0);
  });

  test("rejects wrong production paths and subdomains before lifecycle inputs", () => {
    expect(() => validateLifecycleConfig({ baseUrl: "https://api.symbaiex.com/api/agent", production: "strong-bee-384", confirm: "PLAT-01", phase: "refresh-scope" })).toThrow(/pinned/i);
    expect(() => validateLifecycleConfig({ baseUrl: "https://www.symbaiex.com/api/agent/other", production: "strong-bee-384", confirm: "PLAT-01", phase: "refresh-scope" })).toThrow(/pinned/i);
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

  test("requires exact phase inputs before any credential read", () => {
    expect(() => validatePhaseInputs("refresh-scope", { "allow-session-rotation": "yes", session: "/safe" })).toThrow(/scope-denied-session/i);
    expect(() => validatePhaseInputs("rotation", { "agent-id": "cert", "old-key": "/safe" })).toThrow(/replacement-key/i);
    expect(() => validatePhaseInputs("revocation", {})).toThrow(/revoked-session/i);
    expect(() => validatePhaseInputs("refresh-scope", { "allow-session-rotation": "yes", session: "/safe", "scope-denied-session": "/safe" })).not.toThrow();
    expect(() => validatePhaseInputs("rotation", { "agent-id": "cert", "old-key": "/safe", "replacement-key": "/safe" })).not.toThrow();
    expect(() => validatePhaseInputs("rotation", { "agent-id": "BAD!", "old-key": "/safe", "replacement-key": "/safe" })).toThrow(/2-64 lowercase/i);
    expect(() => validatePhaseInputs("revocation", { "revoked-session": "/safe" })).not.toThrow();
  });

  test("rejects control and oversized agent IDs before file or network access", () => {
    expect(() => validateAgentId("bad\nagent")).toThrow(/2-64 lowercase/i);
    expect(() => validateAgentId("a".repeat(65))).toThrow(/2-64 lowercase/i);
    expect(() => certificationPlan({ baseUrl: "https://www.symbaiex.com/api/agent", agentId: "a".repeat(65), includesLifecycle: false })).toThrow(/2-64 lowercase/i);
  });

  test("sanitizes missing credential filesystem failures", () => {
    expect(redactedError(new Error("ENOENT: no such file, lstat '/secret/private-key.json'"))).toBe("Credential file unavailable.");
  });

  test("rejects intermediate lexical symlink parents", () => {
    // GitHub's /tmp is intentionally world-writable, which is rejected before
    // the symlink under test. A private directory under the current user's home
    // keeps the parent chain deterministic across macOS and Linux runners.
    const directory = mkdtempSync(join(homedir(), ".symbaiex-plat01-"));
    try {
      chmodSync(directory, 0o700);
      const real = join(directory, "real");
      mkdirSync(real, { mode: 0o700 });
      const linked = join(directory, "linked");
      symlinkSync(real, linked);
      const credential = join(linked, "credential.json");
      writeFileSync(credential, JSON.stringify({ accessToken: "x" }), {
        mode: 0o600,
      });
      expect(() => assertPrivateJsonFile(credential)).toThrow(
        /parent.*real directory/i,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
