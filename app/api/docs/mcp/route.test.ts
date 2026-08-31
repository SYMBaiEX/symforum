import { describe, expect, test } from "vitest";

import { GET, POST } from "./route";

function request(body: unknown) {
  return new Request("https://www.symbaiex.com/api/docs/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("public documentation MCP", () => {
  test("initializes without credentials and advertises read-only capabilities", async () => {
    const response = await POST(
      request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    );
    const body = await response.json();

    expect(body.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "symbaiex-docs", version: "v1" },
    });
    expect(JSON.stringify(body)).toContain("read-only");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("searches only the bounded curated documentation index", async () => {
    const response = await POST(
      request({
        jsonrpc: "2.0",
        id: "search",
        method: "tools/call",
        params: {
          name: "docs_search",
          arguments: { query: "Ed25519 authentication", limit: 2 },
        },
      }),
    );
    const body = await response.json();

    expect(body.result.structuredContent.results[0]).toMatchObject({
      uri: "https://www.symbaiex.com/auth.md",
      name: "SYMBaiEX authentication",
    });
    expect(body.result.structuredContent.results.length).toBeLessThanOrEqual(2);
  });

  test("accepts the legacy dotted tool name as a compatibility alias", async () => {
    const response = await POST(
      request({
        jsonrpc: "2.0",
        id: "legacy-search",
        method: "tools/call",
        params: {
          name: "docs.search",
          arguments: { query: "authentication", limit: 1 },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: { structuredContent: { results: expect.any(Array) } },
    });
  });

  test("advertises an explicit read-only tool contract", async () => {
    const response = await POST(
      request({ jsonrpc: "2.0", id: "tools", method: "tools/list" }),
    );
    const body = await response.json();

    expect(body.result.tools).toHaveLength(1);
    expect(body.result.tools[0]).toMatchObject({
      name: "docs_search",
      inputSchema: { additionalProperties: false },
      outputSchema: {
        additionalProperties: false,
        required: ["results"],
        properties: {
          results: { type: "array", maxItems: 4 },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
  });

  test("lists and reads public Markdown resources", async () => {
    const listed = await POST(
      request({ jsonrpc: "2.0", id: 2, method: "resources/list", params: {} }),
    );
    const list = await listed.json();
    expect(list.result.resources).toHaveLength(5);
    expect(list.result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: "https://www.symbaiex.com/pricing.md",
        }),
      ]),
    );

    const read = await POST(
      request({
        jsonrpc: "2.0",
        id: 3,
        method: "resources/read",
        params: { uri: "https://www.symbaiex.com/developers" },
      }),
    );
    const body = await read.json();
    expect(body.result.contents[0]).toMatchObject({
      mimeType: "text/markdown",
      uri: "https://www.symbaiex.com/developers",
    });
    expect(body.result.contents[0].text).toContain(
      "# SYMBaiEX developer guide",
    );
  });

  test("rejects unknown tools and unbounded inputs with JSON-RPC errors", async () => {
    for (const params of [
      { name: "docs.write", arguments: { query: "docs" } },
      { name: "docs_search", arguments: { query: "x".repeat(201) } },
      { name: "docs_search", arguments: { query: "docs", extra: true } },
    ]) {
      const response = await POST(
        request({ jsonrpc: "2.0", id: 4, method: "tools/call", params }),
      );
      await expect(response.json()).resolves.toMatchObject({
        error: { code: -32602 },
      });
    }
  });

  test("returns structured JSON for unsupported methods", async () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      code: "METHOD_NOT_ALLOWED",
      resolution: expect.stringContaining("Initialize"),
    });
  });
});
