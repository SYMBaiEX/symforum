import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = await mkdtemp(join(tmpdir(), "symbaiex-secret-scanner-"));
try {
  const document = await readFile(
    join(root, "docs/eliza-shadow-pilot.md"),
    "utf8",
  );
  const publicMetadata = document
    .split("\n")
    .find((line) => line.includes("6d90115b-39ac-4a71-871f-bbf44217151c"));
  assert.ok(
    publicMetadata,
    "Keep the historical public deployment fixture explicit.",
  );
  // Random detector controls have no provider/account attached. Never log them.
  const assignment = `api_key = "${randomBytes(32).toString("hex")}"`;
  await mkdir(join(fixture, "docs"), { mode: 0o700 });
  for (const path of ["docs/eliza-shadow-pilot.md", "control.md"])
    await writeFile(join(fixture, path), `${publicMetadata}\n${assignment}\n`, {
      mode: 0o600,
    });
  const reportPath = join(fixture, "report.json");
  const scan = spawnSync(
    "gitleaks",
    [
      "dir",
      ".",
      "--config",
      join(root, ".gitleaks.toml"),
      "--redact",
      "--no-banner",
      "--no-color",
      "--ignore-gitleaks-allow",
      "--report-format",
      "json",
      "--report-path",
      reportPath,
    ],
    { cwd: fixture, encoding: "utf8", maxBuffer: 256_000 },
  );
  if (scan.error)
    throw new Error("Install Gitleaks 8.30.1 before running security:check.");
  assert.equal(
    scan.status,
    1,
    "Synthetic credentials must make the scanner fail.",
  );
  const findings = JSON.parse(await readFile(reportPath, "utf8"));
  const locations = findings
    .map((item) => `${item.File.replaceAll("\\", "/")}:${item.StartLine}`)
    .sort();
  assert.deepEqual(
    locations,
    ["control.md:1", "control.md:2", "docs/eliza-shadow-pilot.md:2"],
    "Only the exact public ID in its audited path may be ignored; other keys and paths stay scanned.",
  );
  console.log(
    "Secret-scanner negative controls passed; no control values were printed.",
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}
