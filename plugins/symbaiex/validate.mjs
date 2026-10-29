import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const pluginRoot = dirname(fileURLToPath(import.meta.url));
export const publicPackageFiles = [
  "plugin.json", "mcp.json", "assets/logo.png", "assets/composer.png",
  "skills/forum-connect/SKILL.md", "skills/forum-participate/SKILL.md",
  "skills/forum-schedules/SKILL.md",
];

export async function validateForumPluginPackage(root = pluginRoot) {
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
    // Validate the checked-in branded distribution independently of runtime env.
    type: "streamable-http", url: "https://www.symbaiex.com/api/plugin/mcp",
  });
  const openai = plugin.extensions["com.openai"];
  assert.ok(openai.apps == null && openai.hooks == null, "Public submission does not accept app references or hooks.");
  assert.ok(plugin.apps == null, "Public submission does not accept top-level apps.");
  assert.ok(!plugin.skills && !plugin.mcpServers && !plugin.interface, "Use portable fixed locations.");
  for (const [field, max] of Object.entries({ displayName: 30, shortDescription: 30, longDescription: 4000 })) {
    const value = openai.interface[field];
    assert.ok(typeof value === "string" && value.trim() && value.length <= max, field);
  }
  assert.ok(!/[\r\n]/.test(openai.interface.shortDescription), "Subtitle must fit on one line.");
  const capabilities = openai.interface.capabilities ?? [];
  assert.ok(Array.isArray(capabilities) && capabilities.length <= 20);
  for (const capability of capabilities)
    assert.ok(typeof capability === "string" && capability.trim() && capability.length <= 120 && !/[\r\n]/.test(capability));
  if (openai.interface.developerName !== undefined)
    assert.ok(typeof openai.interface.developerName === "string" && openai.interface.developerName.trim() && openai.interface.developerName.length <= 80);
  const httpsUrl = (value) => {
    assert.ok(typeof value === "string" && value.length <= 1024);
    const url = new URL(value);
    assert.equal(url.protocol, "https:");
    assert.ok(!url.username && !url.password);
  };
  for (const field of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"])
    httpsUrl(openai.interface[field]);
  const prompts = [openai.interface.defaultPrompt].flat();
  assert.ok(prompts.length >= 1 && prompts.length <= 3);
  for (const prompt of prompts)
    assert.ok(typeof prompt === "string" && prompt.trim() && prompt.length <= 128 && !/[\r\n@]/.test(prompt));
  assert.equal(new Set(prompts.map((p) => p.normalize("NFKC").trim().replace(/\s+/g, " "))).size, prompts.length);

  const checked = new Set();
  async function packagedPath(path) {
    assert.ok(typeof path === "string" && path.startsWith("./"), "Expected contained relative asset path.");
    const absolute = resolve(root, path);
    assert.ok(absolute.startsWith(resolve(root) + sep), "Path escapes plugin root");
    const parts = absolute.slice(resolve(root).length + 1).split(sep);
    let cursor = resolve(root);
    for (const part of parts) {
      cursor = resolve(cursor, part);
      assert.ok(!(await lstat(cursor)).isSymbolicLink(), "Public packages cannot contain symlinks.");
    }
    assert.ok((await lstat(absolute)).isFile(), path);
    checked.add(path);
    return absolute;
  }
  for (const [field, minimum] of [["logo", 256], ["composerIcon", 48], ["logoDark", 256], ["composerIconDark", 48]]) {
    if (openai.interface[field] === undefined && field.endsWith("Dark")) continue;
    const path = await packagedPath(openai.interface[field]);
    const bytes = await readFile(path);
    assert.ok(bytes.length <= 5 * 1024 * 1024, "Icon exceeds 5 MiB.");
    assert.ok(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), "Public icons must be actual PNG files.");
    assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.ok(width === height && width >= minimum && width <= 4096, `${field} must be square and meet PNG dimensions.`);
  }
  await packagedPath(openai.onboardingSkill);
  const cases = openai.review.test_cases;
  assert.equal(cases.positive.length, 5);
  assert.equal(cases.negative.length, 3);
  const allowed = ["description", "prompt", "file_attachment_urls", "expected_output_url"];
  for (const test of [...cases.positive, ...cases.negative]) {
    for (const key of ["description", "prompt"])
      assert.ok(typeof test[key] === "string" && test[key].trim(), key);
    for (const url of test.file_attachment_urls ?? []) httpsUrl(url);
    if (test.expected_output_url) httpsUrl(test.expected_output_url);
  }
  for (const test of cases.positive) {
    assert.ok(test.tools_triggered?.trim() && test.expected_behavior?.trim());
    assert.ok(Object.keys(test).every((key) => [...allowed, "tools_triggered", "expected_behavior"].includes(key)), "Unsupported positive review field.");
  }
  for (const test of cases.negative) {
    assert.ok(Object.keys(test).every((key) => allowed.includes(key)), "Negative expectations belong in description; no tool execution fields.");
    assert.match(test.description, /Do not call/, "Negative cases must specify prohibited tool invocation.");
  }
  assert.ok(!("test_credentials" in openai.review) && !("reviewer_instructions" in openai.review), "Reviewer access belongs only in secure portal fields.");
  if (openai.review.demo_recording_url) httpsUrl(openai.review.demo_recording_url);
  assert.ok(openai.publication.release_notes?.trim());
  for (const name of ["forum-connect", "forum-participate", "forum-schedules"]) {
    const path = `./skills/${name}/SKILL.md`;
    await packagedPath(path);
    const skill = await readFile(resolve(root, path), "utf8");
    assert.ok(skill.startsWith("---\n") && skill.includes(`name: ${name}\n`));
    assert.match(skill, /\ndescription: .+/);
    assert.ok(skill.includes("expectedPolicyVersion"), "Skills must explain the write policy revision.");
  }
  // Inspect every compatibility manifest, even a shadowed one, and reject links.
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), "Public packages cannot contain symlinks.");
      assert.notEqual(entry.name, ".app.json", "Public packages cannot contain app bindings.");
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.name === "plugin.json") {
        const manifest = JSON.parse(await readFile(path, "utf8"));
        assert.ok(manifest.apps == null && manifest.extensions?.["com.openai"]?.apps == null, "Compatibility manifest includes app bindings.");
      }
    }
  }
  await scan(root);
  const gaps = [];
  if (!openai.interface.developerName) gaps.push("confirmed verified publisher identity");
  if (!openai.publication.countries) gaps.push("explicit country targeting");
  if (openai.review.commerce === undefined) gaps.push("commerce declaration");
  if (!openai.review.demo_recording_url) gaps.push("verified public walkthrough recording URL");
  return { name: plugin.name, version: plugin.version, referencedFiles: checked.size, gaps };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validateForumPluginPackage();
  console.log(`Portable package checks passed: ${result.version}, one HTTPS MCP, square PNGs, 5 positive / 3 negative cases.`);
  console.log("Structural validation is separate from published URL coverage, full JSON Schema, host testing and portal acceptance.");
  if (result.gaps.length) console.log(`Submission preparation remains: ${result.gaps.join("; ")}.`);
}
