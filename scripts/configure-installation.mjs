#!/usr/bin/env bun
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  localInstallation,
  parseInstallationConfig,
} from "../lib/installation-config.ts";

const args = process.argv.slice(2);
function value(flag) {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1].startsWith("--"))
    throw Error(`${flag} requires a value`);
  return args[i + 1];
}
const known = new Set([
  "--config",
  "--env-file",
  "--convex-deployment",
  "--local",
  "--check",
  "--require-config",
]);
for (let i = 0; i < args.length; i++) {
  if (!known.has(args[i]))
    throw Error(
      "Use --config FILE or --local; optional --env-file FILE, --check, --require-config, --convex-deployment TARGET.",
    );
  if (["--config", "--env-file", "--convex-deployment"].includes(args[i])) i++;
}
if (args.includes("--local") && value("--config"))
  throw Error("Choose --local or --config.");
const raw = args.includes("--local")
  ? JSON.stringify(localInstallation())
  : value("--config")
    ? await readFile(resolve(value("--config")), "utf8")
    : process.env.NEXT_PUBLIC_INSTALLATION_CONFIG;
if (args.includes("--require-config") && !raw?.trim())
  throw Error(
    "NEXT_PUBLIC_INSTALLATION_CONFIG is required for this deployment.",
  );
const configuration = parseInstallationConfig(raw);
const canonical = JSON.stringify(configuration);
const hash = createHash("sha256").update(canonical).digest("hex");
if (args.includes("--check")) {
  console.log(
    JSON.stringify({
      valid: true,
      configured: Boolean(raw?.trim()),
      configurationHash: hash,
    }),
  );
  process.exit(0);
}
if (!raw?.trim())
  throw Error(
    "Choose --local or --config FILE; no production installation is assumed.",
  );
const deployment = value("--convex-deployment");
if (deployment && !/^[a-zA-Z0-9_:/-]{1,160}$/.test(deployment))
  throw Error("Invalid explicit Convex deployment selector.");
const envPath = resolve(value("--env-file") ?? ".env.local");
let existing = "";
try {
  existing = await readFile(envPath, "utf8");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const key = "NEXT_PUBLIC_INSTALLATION_CONFIG";
// Unicode escapes retain JSON semantics without dotenv expansion or quote ambiguity.
const encoded = canonical.replaceAll("'", "\\u0027").replaceAll("$", "\\u0024");
const line = `${key}='${encoded}'`;
const pattern = new RegExp(`^${key}=.*$`, "m");
const next = pattern.test(existing)
  ? existing.replace(pattern, () => line)
  : existing.replace(/\s*$/, "") + "\n" + line + "\n";
await writeFile(envPath, next, { mode: 0o600 });
console.log(JSON.stringify({ written: envPath, key, configurationHash: hash }));
await chmod(envPath, 0o600);
if (deployment) {
  const child = Bun.spawn(
    ["bunx", "convex", "env", "set", "--deployment", deployment, key],
    {
      stdin: new TextEncoder().encode(canonical + "\n"),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const exit = await child.exited;
  // Provider output is deliberately not forwarded; it can contain configuration.
  if (exit !== 0)
    throw Error(
      `Convex configuration failed (exit ${exit}); inspect the target in its dashboard before retrying.`,
    );
  console.log(
    JSON.stringify({
      configuredDeployment: deployment,
      key,
      configurationHash: hash,
    }),
  );
}
