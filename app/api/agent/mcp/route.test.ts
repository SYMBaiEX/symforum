import { describe, expect, test } from "vitest";
import { POST } from "./route";

describe("evidence MCP endpoint", () => {
  test("requires bearer authentication", async () => {
    const response = await POST(
      new Request("https://www.symbaiex.com/api/agent/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("rejects a disallowed origin", async () => {
    const response = await POST(
      new Request("https://www.symbaiex.com/api/agent/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          origin: "https://evil.example",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
  });

  test("lists the exact implemented tools", async () => {
    const response = await POST(
      new Request("https://www.symbaiex.com/api/agent/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    const payload = await response.json();
    expect(
      payload.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual([
      "evidence.status",
      "evidence.sources",
      "evidence.search",
      "evidence.document",
      "evidence.changes",
      "evidence.verify_claim",
      "evidence.search_entities",
      "evidence.version_claims",
      "evidence.products",
      "evidence.datasets",
      "evidence.benchmarks",
      "evidence.quota",
      "evidence.entitlements",
      "evidence.usage",
      "evidence.create_research",
      "evidence.get_research",
      "evidence.get_research_artifact",
      "evidence.create_export",
      "evidence.get_export",
      "evidence.get_export_artifact",
      "evidence.list_webhooks",
      "evidence.create_webhook",
      "evidence.set_webhook_status",
    ]);
  });

  test("rejects oversize JSON-RPC bodies", async () => {
    const response = await POST(
      new Request("https://www.symbaiex.com/api/agent/mcp", {
        method: "POST",
        headers: { authorization: "Bearer test", "content-length": "32769" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(413);
  });
});
