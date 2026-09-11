// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

test("setup creates private local artifacts, refuses overwrite, and never logs secrets", () => {
  const parent = mkdtempSync(join(tmpdir(), "service-auth-key-test-"));
  const target = join(parent, "keys");
  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/setup-agent-service-auth.mjs", target],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const privateKey = JSON.parse(
      readFileSync(join(target, "AGENT_SERVICE_AUTH_PRIVATE_JWK"), "utf8"),
    );
    const publicKeys = JSON.parse(
      readFileSync(join(target, "AGENT_SERVICE_AUTH_PUBLIC_JWKS"), "utf8"),
    );
    const secret = readFileSync(
      join(target, "AGENT_SERVICE_AUTH_RELAY_SECRET"),
      "utf8",
    );
    expect(privateKey.d).toBeTruthy();
    expect(publicKeys.keys[0].d).toBeUndefined();
    expect(publicKeys.keys[0].n).toBe(privateKey.n);
    expect(statSync(target).mode & 0o777).toBe(0o700);
    expect(
      statSync(join(target, "AGENT_SERVICE_AUTH_PRIVATE_JWK")).mode & 0o777,
    ).toBe(0o600);
    expect(result.stdout + result.stderr).not.toContain(privateKey.d);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(
      spawnSync(process.execPath, [
        "scripts/setup-agent-service-auth.mjs",
        target,
      ]).status,
    ).toBe(1);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
