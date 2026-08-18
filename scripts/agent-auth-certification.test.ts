// @vitest-environment node
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  certificationPlan,
  readCertificationReceipt,
  redactValue,
  refreshSession,
  validateLifecycleConfig,
  verifyKeyLogin,
  verifyPublicMetadata,
  verifyScopeDenied,
  verifySession,
  writeCertificationReceipt,
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

  test("writes only ordered, private receipt transitions", () => {
    const directory = privateTempDirectory();
    const receipt = join(directory, "receipt.json");
    expect(() => writeCertificationReceipt(receipt, "rotation")).toThrow(/start with refresh/i);
    writeCertificationReceipt(receipt, "refresh-scope");
    expect(readCertificationReceipt(receipt).phases).toEqual(["refresh-scope"]);
    expect(() => writeCertificationReceipt(receipt, "refresh-scope")).toThrow(/requires phase: rotation/i);
    writeCertificationReceipt(receipt, "rotation");
    writeCertificationReceipt(receipt, "revocation");
    expect(readCertificationReceipt(receipt).phases).toEqual(["refresh-scope", "rotation", "revocation"]);
    expect(() => writeCertificationReceipt(receipt, "revocation")).toThrow(/requires phase: complete/i);
  });

  test("rejects symlink and permissive receipt paths before replacement", () => {
    const directory = privateTempDirectory();
    const target = join(directory, "target.json");
    writeFileSync(target, JSON.stringify({ version: 1, target: "strong-bee-384", phases: ["refresh-scope"], updatedAt: new Date().toISOString() }), { mode: 0o600 });
    const linked = join(directory, "linked.json");
    symlinkSync(target, linked);
    expect(() => writeCertificationReceipt(linked, "rotation")).toThrow(/non-symlink|regular/i);
    chmodSync(target, 0o644);
    expect(() => writeCertificationReceipt(target, "rotation")).toThrow(/invalid|accessible/i);
  });

  test("rejects a symlinked or permissive parent before first receipt creation", () => {
    const directory = privateTempDirectory();
    const real = join(directory, "real");
    mkdirSync(real, { mode: 0o700 });
    const linked = join(directory, "linked");
    symlinkSync(real, linked);
    expect(() => writeCertificationReceipt(join(linked, "receipt.json"), "refresh-scope")).toThrow(/real directory/i);
    const permissive = join(directory, "permissive");
    mkdirSync(permissive, { mode: 0o700 });
    chmodSync(permissive, 0o777);
    expect(() => writeCertificationReceipt(join(permissive, "receipt.json"), "refresh-scope")).toThrow(/writable/i);
  });

  test("rejects a preexisting receipt with invalid schema", () => {
    const directory = privateTempDirectory();
    const receipt = join(directory, "receipt.json");
    writeFileSync(receipt, JSON.stringify({ version: 1, target: "strong-bee-384", phases: ["rotation"], updatedAt: new Date().toISOString() }), { mode: 0o600 });
    expect(() => writeCertificationReceipt(receipt, "revocation")).toThrow(/phase order/i);
    expect(readFileSync(receipt, "utf8")).toMatch(/rotation/);
  });
});

function privateTempDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "symbaiex-plat01-"));
  chmodSync(directory, 0o700);
  return directory;
}
