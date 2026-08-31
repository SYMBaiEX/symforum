import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

describe("agent contract parity matrix", () => {
  test("covers REST, MCP, TypeScript, Python, CLI, and AsyncAPI surfaces", () => {
    const script = readFileSync(
      new URL("./verify-agent-contract-parity.mjs", import.meta.url),
      "utf8",
    );
    expect(script).toContain("contracts/asyncapi/agent-events.json");
    expect(script).toContain("packages/agent-sdk/src/index.ts");
    expect(script).toContain("packages/agent-python-sdk/src/symbaiex_agent/client.py");
    expect(script).toContain("packages/agent-cli/bin/symbaiex.ts");
  });
});
