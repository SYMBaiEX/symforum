#!/usr/bin/env bun
/**
 * Fails when the published REST/MCP/AsyncAPI contracts drift from a client
 * capability that is intentionally promised in every supported surface.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const requireText = (path, fragments) => {
  const source = read(path);
  for (const fragment of fragments) {
    if (!source.includes(fragment)) throw new Error(`${path} is missing ${fragment}`);
  }
};

const asyncApi = JSON.parse(read("contracts/asyncapi/agent-events.json"));
if (asyncApi.asyncapi !== "3.0.0") throw new Error("AsyncAPI must remain 3.0.0");
for (const event of ["evidence.research.completed", "evidence.export.completed"]) {
  if (!asyncApi.channels?.[event] || !asyncApi.components?.messages) throw new Error(`AsyncAPI is missing ${event}`);
}

requireText("app/api/agent/openapi.json/route.ts", [
  '"/v1/research-jobs"',
  '"/v1/exports/{jobId}/manifest"',
  '"/mcp"',
  "AgentError",
  "ArtifactMetadata",
]);
requireText("app/api/agent/mcp/route.ts", ["tools/list", "tools/call"]);
requireText("lib/agent-data-api-relay.ts", ["research_artifact", "export_manifest"]);
requireText("packages/agent-sdk/src/index.ts", ["waitForResearch", "waitForExport", "verifyExportManifest", "verifyWebhookSignature", "paginate"]);
requireText("packages/agent-python-sdk/src/symbaiex_agent/client.py", ["wait_for_research", "wait_for_export", "verify_export_manifest", "verify_webhook_signature", "paginate"]);
requireText("packages/agent-cli/bin/symbaiex.ts", ["export-download", "verifyExportManifest"]);

console.log("agent contract parity: REST, MCP, TypeScript, Python, CLI, and AsyncAPI are aligned");
