import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const plugin = await read("plugin.json");
const mcp = await read("mcp.json");
assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
assert.match(plugin.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
assert.ok(plugin.name.length <= 64);
assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
assert.deepEqual(Object.keys(mcp.mcpServers), ["symbaiex"]);
assert.deepEqual(mcp.mcpServers.symbaiex, {
  type: "streamable-http", url: "https://www.symbaiex.com/api/plugin/mcp",
});
const openai = plugin.extensions["com.openai"];
assert.ok(!openai.apps && !openai.hooks, "Public submission does not accept app references or hooks.");
for (const [field, max] of Object.entries({
  displayName: 30, shortDescription: 30, longDescription: 4000, developerName: 80,
})) {
  const value = openai.interface[field];
  assert.equal(typeof value, "string");
  assert.ok(value.trim().length && value.length <= max, field);
}
for (const field of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
  const url = new URL(openai.interface[field]);
  assert.equal(url.protocol, "https:");
  assert.ok(!url.username && !url.password);
}
const checked = new Set();
async function packagedPath(path) {
  assert.ok(path.startsWith("./"), path);
  const absolute = resolve(root, path);
  assert.ok(absolute.startsWith(root + sep), "Path escapes plugin root");
  assert.ok((await stat(absolute)).isFile(), path);
  checked.add(path);
}
await packagedPath(openai.interface.composerIcon);
await packagedPath(openai.interface.logo);
await packagedPath(openai.onboardingSkill);
const cases = openai.review.test_cases;
assert.equal(cases.positive.length, 5);
assert.equal(cases.negative.length, 3);
for (const test of [...cases.positive, ...cases.negative]) {
  for (const key of ["description", "prompt", "expected_behavior"])
    assert.ok(typeof test[key] === "string" && test[key].trim(), key);
}
for (const test of cases.positive) assert.ok(test.tools_triggered?.trim());
assert.ok(!("test_credentials" in openai.review));
assert.ok(!("reviewer_instructions" in openai.review));
for (const name of ["forum-connect", "forum-participate", "forum-schedules"]) {
  const path = `./skills/${name}/SKILL.md`;
  await packagedPath(path);
  const skill = await readFile(resolve(root, path), "utf8");
  assert.ok(skill.startsWith("---\n"));
  assert.ok(skill.includes(`name: ${name}\n`));
  assert.match(skill, /\ndescription: .+/);
  assert.ok(skill.includes("expectedPolicyVersion"), "Each skill must explain the required write policy revision.");
}
console.log(`Portable package checks passed: one HTTPS MCP, 5 positive / 3 negative cases, ${checked.size} referenced files.`);
console.log("These are local structural checks, not full JSON Schema validation or proof of portal/host acceptance.");
if (!openai.review.demo_recording_url)
  console.log("Launch prerequisite remains: provide a real reviewer-accessible walkthrough recording URL.");
