import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
for (const directory of ["src", "scripts", "test"]) {
  for (const name of await readdir(
    new URL(`../${directory}/`, import.meta.url),
  )) {
    if (!name.endsWith(".mjs")) continue;
    const result = spawnSync(
      process.execPath,
      ["--check", new URL(`../${directory}/${name}`, import.meta.url).pathname],
      { stdio: "inherit" },
    );
    if (result.status) process.exit(result.status);
  }
}
await import("../src/contract.mjs");
await import("../src/runtime.mjs");
console.log("Syntax and pinned Eliza runtime imports verified.");
