import { afterEach, describe, expect, test, vi } from "vitest";
import { GET as authGuide, HEAD as authHead } from "@/app/auth.md/route";
import { GET as pricingGuide } from "@/app/pricing.md/route";
import { DOCS_MCP_SERVER_CARD } from "@/lib/agent-discovery";
import { publicDocumentation } from "@/lib/public-documentation";

import { GET, POST } from "./route";

function request(body: unknown, protocolVersion?: string) {
  return new Request("https://www.symbaiex.com/api/docs/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(protocolVersion === undefined
        ? {}
        : { "mcp-protocol-version": protocolVersion }),
    },
    body: JSON.stringify(body),
  });
}

describe("public documentation MCP", () => {
  afterEach(() => vi.unstubAllEnvs());
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

  test("negotiates every card-advertised protocol version", async () => {
    for (const protocolVersion of ["2025-06-18", "2025-03-26"]) {
      const response = await POST(
        request(
          {
            jsonrpc: "2.0",
            id: protocolVersion,
            method: "initialize",
            params: { protocolVersion },
          },
          protocolVersion,
        ),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        result: { protocolVersion },
      });
    }
  });

  test("rejects unsupported MCP protocol headers with a structured error", async () => {
    const response = await POST(
      request({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "2024-11-05"),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32022,
        message: "Unsupported protocol version",
        data: {
          requested: "2024-11-05",
          supported: ["2026-07-28", "2025-06-18", "2025-03-26"],
        },
      },
    });
  });

  test("rejects a protocol header that disagrees with initialize params", async () => {
    const response = await POST(
      request(
        {
          jsonrpc: "2.0",
          id: "mismatch",
          method: "initialize",
          params: { protocolVersion: "2025-06-18" },
        },
        "2025-03-26",
      ),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: "mismatch",
      error: {
        code: -32020,
        message:
          "Header mismatch: MCP-Protocol-Version must match initialize params.protocolVersion.",
      },
    });
  });

  test("rejects an unsupported initialize params protocol version", async () => {
    const response = await POST(
      request({
        jsonrpc: "2.0",
        id: "unsupported-param",
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: "unsupported-param",
      error: {
        code: -32022,
        message: "Unsupported protocol version",
        data: {
          requested: "2024-11-05",
          supported: ["2025-06-18", "2025-03-26"],
        },
      },
    });
  });

  test("acknowledges initialized notifications without a JSON-RPC response", async () => {
    const response = await POST(
      request({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
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

    expect(body.result.structuredContent.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: "https://www.symbaiex.com/auth.md",
          name: "SYMBaiEX authentication",
        }),
      ]),
    );
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

    expect(body.result.tools).toHaveLength(3);
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
    expect(
      body.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(["docs_search", "docs_list", "docs_get"]);
    expect(
      body.result.tools.every(
        (tool: { inputSchema: { required?: string[] } }) =>
          Array.isArray(tool.inputSchema.required),
      ),
    ).toBe(true);
  });

  test("lists and reads documentation through focused tools", async () => {
    const listed = await POST(
      request({
        jsonrpc: "2.0",
        id: "list-tool",
        method: "tools/call",
        params: { name: "docs_list", arguments: {} },
      }),
    );
    const listBody = await listed.json();
    expect(listBody.result.structuredContent.resources).toHaveLength(
      publicDocumentation().length,
    );

    const read = await POST(
      request({
        jsonrpc: "2.0",
        id: "get-tool",
        method: "tools/call",
        params: {
          name: "docs_get",
          arguments: { uri: "https://www.symbaiex.com/auth.md" },
        },
      }),
    );
    await expect(read.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          resource: {
            uri: "https://www.symbaiex.com/auth.md",
            mimeType: "text/markdown",
          },
        },
      },
    });
  });

  test("lists and reads public Markdown resources", async () => {
    const listed = await POST(
      request({ jsonrpc: "2.0", id: 2, method: "resources/list", params: {} }),
    );
    const list = await listed.json();
    expect(list.result.resources).toHaveLength(publicDocumentation().length);
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

  test("serves the exact current auth and pricing guides, including enabled OAuth", async () => {
    vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
    vi.stubEnv("WORKOS_AUTHKIT_ISSUER", "https://example.authkit.app");
    for (const [uri, guide] of [
      ["/auth.md", authGuide],
      ["/pricing.md", pricingGuide],
    ] as const) {
      const response = await POST(
        request({
          jsonrpc: "2.0",
          id: 1,
          method: "resources/read",
          params: { uri: `https://www.symbaiex.com${uri}` },
        }),
      );
      const body = await response.json();
      expect(body.result.contents[0].text).toBe(await guide().text());
      expect(body.result.contents[0].text.length).toBeGreaterThan(1000);
    }
    expect(await authGuide().text()).toContain("OAuth is enabled.");
    expect(await authHead().text()).toBe("");
    vi.stubEnv("WORKOS_CONNECT_ENABLED", "false");
    expect(
      publicDocumentation().find((d) => d.uri.endsWith("/auth.md"))?.text,
    ).toContain("OAuth is not enabled in this deployment.");
  });

  test("does not manufacture relevance or fetch unindexed URLs", async () => {
    expect(
      publicDocumentation().find((d) => d.uri.endsWith("/agent/instructions"))
        ?.text,
    ).toContain("JSONL (default) and Parquet");
    expect(
      publicDocumentation().find((d) => d.uri.endsWith("/agent/instructions"))
        ?.text,
    ).not.toContain("JSONL-only");
    const response = await POST(
      request({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "docs_search", arguments: { query: "zzzxxyynomatch" } },
      }),
    );
    expect((await response.json()).result.structuredContent.results).toEqual(
      [],
    );
    for (const uri of [
      "https://evil.example/auth.md",
      "https://www.symbaiex.com/api/admin",
      "file:///etc/passwd",
    ]) {
      const response = await POST(
        request({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "docs_get", arguments: { uri } },
        }),
      );
      expect((await response.json()).error.code).toBe(-32602);
    }
  });

  test("supports card-advertised modern discovery, tools and resources without credentials", async () => {
    expect(DOCS_MCP_SERVER_CARD.remotes[0].supportedProtocolVersions).toContain(
      "2026-07-28",
    );
    for (const [method, params] of [
      ["server/discover", {}],
      ["tools/list", {}],
      ["resources/list", {}],
      [
        "tools/call",
        { name: "docs_search", arguments: { query: "OAuth PKCE" } },
      ],
      ["resources/read", { uri: "https://www.symbaiex.com/auth.md" }],
    ] as const) {
      const response = await POST(modernRequest(method, params));
      expect(response.status).toBe(200);
      expect(response.headers.get("mcp-protocol-version")).toBe("2026-07-28");
      const body = await response.json();
      expect(body.result).toMatchObject({
        resultType: "complete",
        _meta: {
          "io.modelcontextprotocol/serverInfo": {
            name: "symbaiex-docs",
            version: "v1",
          },
        },
      });
      if (method === "server/discover")
        expect(body.result).toMatchObject({
          supportedVersions: ["2026-07-28"],
          capabilities: { tools: {}, resources: {} },
          cacheScope: "public",
        });
    }
    const oldHandshake = await POST(modernRequest("initialize", {}));
    expect(oldHandshake.status).toBe(404);
  });

  test("validates modern metadata and both tool and resource routing headers", async () => {
    for (const [method, params, header] of [
      ["tools/list", {}, "mcp-method"],
      ["tools/call", { name: "docs_list", arguments: {} }, "mcp-name"],
      [
        "resources/read",
        { uri: "https://www.symbaiex.com/auth.md" },
        "mcp-name",
      ],
    ] as const) {
      const req = modernRequest(method, params);
      req.headers.set(header, "wrong");
      const response = await POST(req);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(-32020);
    }
    const missingMeta = await POST(
      request({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "2026-07-28"),
    );
    expect((await missingMeta.json()).error.code).toBe(-32020);
    const missingCapabilities = modernRequest("tools/list", {
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
    });
    expect((await (await POST(missingCapabilities)).json()).error.code).toBe(
      -32600,
    );
    const encoded = modernRequest("tools/call", {
      name: "docs_list",
      arguments: {},
    });
    encoded.headers.set("mcp-name", `=?base64?${btoa("docs_list")}?=`);
    expect((await POST(encoded)).status).toBe(200);
  });

  test("bounds streamed bodies without trusting Content-Length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(20_000));
      },
      cancel,
    });
    const req = new Request("https://www.symbaiex.com/api/docs/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await POST(req)).status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

function modernRequest(method: string, params: Record<string, unknown>) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
  };
  if (method === "tools/call") headers["mcp-name"] = String(params.name);
  if (method === "resources/read") headers["mcp-name"] = String(params.uri);
  return new Request("https://www.symbaiex.com/api/docs/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
        ...params,
      },
    }),
  });
}
