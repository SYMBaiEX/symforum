import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
let failed = false;
for (const directory of [
  ".",
  "workers/eliza-shadow",
  "workers/eliza-shadow-gateway",
]) {
  console.log(`Auditing all dependencies: ${directory}`);
  const result = spawnSync("bun", ["audit"], {
    cwd: resolve(root, directory),
    stdio: "inherit",
  });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
