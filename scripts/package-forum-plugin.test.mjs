// @vitest-environment node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "vitest";
import { packageForumPlugin } from "./package-forum-plugin.mjs";
import { pluginRoot, validateForumPluginPackage } from "../plugins/symbaiex/validate.mjs";
import { FORUM_PLUGIN_TOOLS } from "../lib/forum-plugin-catalog";

async function fixture(run) {
  const directory = resolve(pluginRoot, "../../tmp", `submission-test-${randomBytes(8).toString("hex")}`);
  const source = resolve(directory, "source");
  await mkdir(directory, { recursive: true });
  await cp(pluginRoot, source, { recursive: true });
  const manifestPath = resolve(source, "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const save = () => writeFile(manifestPath, JSON.stringify(manifest));
  try { await run({ source, directory, manifest, save }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("public ZIP uses a separate exact inventory and excludes private/source-only material", async () => {
  await fixture(async ({ source, directory }) => {
    await writeFile(resolve(source, ".env"), "DO_NOT_PACKAGE_TEST_SENTINEL");
    await writeFile(resolve(source, "reviewer-instructions.txt"), "DO_NOT_PACKAGE_TEST_SENTINEL");
    const result = await packageForumPlugin({ source, outputDirectory: resolve(directory, "output") });
    assert.equal(result.version, "0.10.0");
    assert.equal(result.files, 7);
    assert.equal(result.readiness, "incomplete_submission_preparation");
    assert.ok(result.publicCopy !== source);
    assert.deepEqual(result.gaps, ["confirmed verified publisher identity", "explicit country targeting", "commerce declaration"]);
    assert.ok((await readFile(resolve(source, ".env"), "utf8")).includes("SENTINEL"));
  });
});

test("shadowed compatibility app bindings cannot enter public preparation", async () => {
  await fixture(async ({ source }) => {
    await mkdir(resolve(source, ".codex-plugin"));
    await writeFile(resolve(source, ".codex-plugin/plugin.json"), JSON.stringify({ extensions: { "com.openai": { apps: "./.app.json" } } }));
    await assert.rejects(validateForumPluginPackage(source), /app bindings/);
  });
});

test("an asset symlink or undersized PNG cannot pass submission validation", async () => {
  await fixture(async ({ source, directory }) => {
    const path = resolve(source, "assets/composer.png");
    await rm(path);
    await symlink(resolve(pluginRoot, "assets/composer.png"), path);
    await assert.rejects(validateForumPluginPackage(source), /symlinks/);
    await rm(path);
    const bytes = await readFile(resolve(pluginRoot, "assets/composer.png"));
    bytes.writeUInt32BE(32, 16);
    bytes.writeUInt32BE(32, 20);
    await writeFile(path, bytes);
    await assert.rejects(validateForumPluginPackage(source), /PNG dimensions/);
    assert.ok(directory);
  });
});

test("negative review cases contain no supported-workflow tool execution fields", async () => {
  await fixture(async ({ source, manifest, save }) => {
    manifest.extensions["com.openai"].review.test_cases.negative[0].tools_triggered = "forum_search";
    await save();
    await assert.rejects(validateForumPluginPackage(source), /Negative expectations belong in description/);
  });
});

test("positive review expectations use real tool names with complete MCP annotations", async () => {
  const manifest = JSON.parse(await readFile(resolve(pluginRoot, "plugin.json"), "utf8"));
  const tools = new Map(FORUM_PLUGIN_TOOLS.map((tool) => [tool.name, tool]));
  for (const example of manifest.extensions["com.openai"].review.test_cases.positive) {
    for (const name of example.tools_triggered.split(",").map((name) => name.trim()))
      assert.ok(tools.has(name), `Unknown review tool: ${name}`);
  }
  for (const tool of tools.values())
    for (const hint of ["readOnlyHint", "openWorldHint", "destructiveHint"])
      assert.equal(typeof tool.annotations[hint], "boolean", `${tool.name} ${hint}`);
});
