import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// This independently locked worker checks its own installed graph. It never
// imports the root application's packages, test runner or development helpers.
const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve("@elizaos/core"));
const glob = coreRequire("glob");
const globRequire = createRequire(coreRequire.resolve("glob"));

test("Eliza resolves the reviewed patched glob and matcher without a core upgrade", () => {
  assert.equal(require("@elizaos/core/package.json").version, "1.7.2");
  assert.equal(coreRequire("glob/package.json").version, "14.0.3");
  assert.equal(globRequire("minimatch/package.json").version, "11.0.3");
});

test("Eliza glob retains async/sync/extglob/ignore/file-type contracts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sym-eliza-glob-compat-"));
  try {
    await mkdir(join(directory, "nested"));
    await Promise.all(["one.ts", "two.js", "nested/three.ts", "nested/ignore.ts"].map((file) => writeFile(join(directory, file), "")));
    const options = { cwd: directory, nodir: true, ignore: ["**/ignore.ts"] };
    const expected = ["nested/three.ts", "one.ts", "two.js"];
    assert.deepEqual((await glob.glob("**/*.@(js|ts)", options)).sort(), expected);
    assert.deepEqual(glob.globSync("**/*.@(js|ts)", options).sort(), expected);
    assert.deepEqual((await glob.glob("**/*.ts", { ...options, withFileTypes: true })).map((entry) => entry.name).sort(), ["one.ts", "three.ts"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Eliza glob stops traversal when cancellation races a directory read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sym-eliza-glob-abort-"));
  const controller = new AbortController();
  let reads = 0;
  try {
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "nested", "one.ts"), "");
    const guardedFs = {
      ...fs,
      readdir(path, options, callback) {
        reads++;
        fs.readdir(path, options, (error, entries) => {
          controller.abort();
          callback(error, entries);
        });
      },
    };
    await assert.rejects(glob.glob("**/*.ts", { cwd: directory, signal: controller.signal, fs: guardedFs }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(reads, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Eliza matcher bounds advisory preprocessing in an isolated process", () => {
  const resolved = globRequire.resolve("minimatch");
  const result = spawnSync(process.execPath, ["-e", `const {Minimatch}=require(${JSON.stringify(resolved)}); const m=new Minimatch('**/../'.repeat(18)+'*.ts',{optimizationLevel:2}); if(typeof m.match('one.ts')!=='boolean')process.exit(1);`], { timeout: 2000, encoding: "utf8" });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
