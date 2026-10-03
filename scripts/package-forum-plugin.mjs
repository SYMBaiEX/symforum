#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { pluginRoot, publicPackageFiles, validateForumPluginPackage } from "../plugins/symbaiex/validate.mjs";

const execute = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function packageForumPlugin({ source = pluginRoot, outputDirectory = resolve(repoRoot, "tmp/forum-plugin-submission") } = {}) {
  const output = resolve(outputDirectory);
  assert.ok(output.startsWith(resolve(repoRoot, "tmp") + sep), "Public artifacts must stay under ignored tmp/.");
  const metadata = await validateForumPluginPackage(source);
  await mkdir(output, { recursive: true });
  const stage = await mkdtemp(resolve(output, "public-copy-"));
  const copy = resolve(stage, metadata.name);
  for (const file of publicPackageFiles) {
    const target = resolve(copy, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(source, file), target);
  }
  await validateForumPluginPackage(copy);
  const temporaryArchive = resolve(stage, "upload.zip");
  await execute("zip", ["-q", "-r", temporaryArchive, metadata.name], { cwd: stage });
  const { stdout } = await execute("unzip", ["-Z1", temporaryArchive]);
  const inventory = stdout.trim().split("\n").filter((path) => !path.endsWith("/"));
  assert.deepEqual(inventory.sort(), publicPackageFiles.map((file) => `${metadata.name}/${file}`).sort(), "ZIP must contain only the explicit public inventory.");
  for (const file of publicPackageFiles) {
    const { stdout: zipped } = await execute("unzip", ["-p", temporaryArchive, `${metadata.name}/${file}`], { encoding: "buffer", maxBuffer: 6 * 1024 * 1024 });
    assert.ok(zipped.equals(await readFile(resolve(copy, file))), "ZIP bytes differ from validated source.");
  }
  const archive = resolve(output, `${metadata.name}-plugin-${metadata.version}.zip`);
  await rm(archive, { force: true });
  await rename(temporaryArchive, archive);
  return { ...metadata, archive, publicCopy: copy, files: inventory.length, readiness: metadata.gaps.length ? "incomplete_submission_preparation" : "local_package_validated" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, "This helper takes no arguments; writes only its ignored public artifact directory.");
  console.log(JSON.stringify(await packageForumPlugin(), null, 2));
}
