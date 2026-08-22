import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { GET, POST } from "./route";

const originalSiteUrl = process.env.CONVEX_SITE_URL;

beforeEach(() => {
  process.env.CONVEX_SITE_URL = "https://private-backend.example";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (originalSiteUrl === undefined) delete process.env.CONVEX_SITE_URL;
  else process.env.CONVEX_SITE_URL = originalSiteUrl;
});

describe("evidence MCP endpoint", () => {
  test("requires bearer authentication with protected-resource metadata", async () => {
    const response = await POST(
      legacyRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "evidence.status", arguments: {} },
        },
        false,
      ),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://www.symbaiex.com/.well-known/oauth-protected-resource"',
    );
    expect(response.headers.get("www-authenticate")).toContain(
      'scope="evidence"',
    );
  });

  test("rejects a disallowed origin", async () => {
    const response = await POST(
      new Request("https://www.symbaiex.com/api/agent/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "evidence.status", arguments: {} },
        }),
      }),
    );
    expect(response.status).toBe(403);
  });

  test("allows a public handshake from an external client origin", async () => {
    const initialized = await POST(
      new Request("https://www.symbaiex.com/api/agent/mcp", {
        method: "POST",
        headers: {
          origin: "https://agent-client.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26" },
        }),
      }),
    );
    expect(initialized.status).toBe(200);
  });

  test("accepts the standard initialized notification without an id", async () => {
    const response = await POST(
      legacyRequest(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        false,
      ),
    );
    expect(response.status).toBe(204);
  });

  test("keeps unsupported GET separate from authenticated tool calls", async () => {
    const response = GET(new Request("https://www.symbaiex.com/api/agent/mcp"));
    expect(response.status).toBe(405);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(await response.json()).toMatchObject({
      code: "METHOD_NOT_ALLOWED",
      resolution: expect.stringContaining("tools/list without credentials"),
    });
  });

  test("supports public legacy initialization and tool discovery", async () => {
    const initialized = await POST(
      legacyRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26" },
        },
        false,
      ),
    );
    expect(initialized.status).toBe(200);
    expect(await initialized.json()).toMatchObject({
      result: {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "symbaiex-evidence", version: "v1" },
        instructions: expect.stringContaining("product MCP"),
      },
    });

    const listed = await POST(
      legacyRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, false),
    );
    const payload = await listed.json();
    expect(listed.status).toBe(200);
    expect(payload.result.resultType).toBeUndefined();
    expect(payload.result.ttlMs).toBeUndefined();
  });

  test("publishes a public MCP App resource for read-oriented tools", async () => {
    const listed = await POST(
      legacyRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, false),
    );
    const toolPayload = await listed.json();
    const searchTool = toolPayload.result.tools.find(
      (tool: { name: string }) => tool.name === "evidence_search",
    );
    expect(searchTool._meta.ui.resourceUri).toBe(
      "ui://symbaiex/evidence-explorer.html",
    );

    const resources = await POST(
      legacyRequest({ jsonrpc: "2.0", id: 2, method: "resources/list" }, false),
    );
    const resourcePayload = await resources.json();
    expect(resourcePayload.result.resources[0]).toMatchObject({
      uri: "ui://symbaiex/evidence-explorer.html",
      mimeType: "text/html;profile=mcp-app",
    });

    const read = await POST(
      legacyRequest(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "resources/read",
          params: { uri: "ui://symbaiex/evidence-explorer.html" },
        },
        false,
      ),
    );
    const readPayload = await read.json();
    expect(readPayload.result.contents[0].text).toContain(
      "ui/notifications/tool-result",
    );
    expect(readPayload.result.contents[0].text).not.toContain("Bearer");
  });

  test("implements modern server discovery with stable identity and cache hints", async () => {
    vi.stubGlobal("fetch", validAuthentication());

    const response = await POST(
      modernRequest("server/discover", {
        jsonrpc: "2.0",
        id: "discover-1",
        method: "server/discover",
        params: modernParams(),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-protocol-version")).toBe("2026-07-28");
    expect(response.headers.get("mcp-server-name")).toBe("symbaiex-evidence");
    expect(response.headers.get("mcp-server-version")).toBe("v1");
    expect(payload.result).toMatchObject({
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: {}, resources: {} },
      ttlMs: 3_600_000,
      cacheScope: "public",
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: "symbaiex-evidence",
          version: "v1",
        },
      },
    });
    expect(payload.result.instructions).toMatch(/custom Ed25519.*not OAuth/i);
  });

  test("returns a deterministic modern tools list with explicit cache hints", async () => {
    vi.stubGlobal("fetch", validAuthentication());

    const response = await POST(
      modernRequest("tools/list", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: modernParams(),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result.resultType).toBe("complete");
    expect(payload.result.ttlMs).toBe(300_000);
    expect(payload.result.cacheScope).toBe("public");
    expect(
      payload.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual([
      "evidence_status",
      "evidence_sources",
      "evidence_source_registry",
      "evidence_search",
      "evidence_semantic_search",
      "evidence_universal_search",
      "evidence_document",
      "evidence_changes",
      "evidence_verify_claim",
      "evidence_search_entities",
      "evidence_version_claims",
      "evidence_claim_timeline",
      "evidence_products",
      "evidence_datasets",
      "evidence_benchmarks",
      "evidence_quota",
      "evidence_entitlements",
      "evidence_usage",
      "evidence_create_research",
      "evidence_get_research",
      "evidence_get_research_artifact",
      "evidence_create_export",
      "evidence_get_export",
      "evidence_get_export_artifact",
      "evidence_list_webhooks",
      "evidence_webhook_availability",
      "evidence_create_webhook",
      "evidence_set_webhook_status",
      "evidence_webhook_health",
      "evidence_webhook_history",
      "evidence_rotate_webhook_secret",
      "evidence_replay_webhook_delivery",
      "evidence_send_webhook_test",
    ]);
    expect(
      payload.result.tools.every(
        (tool: {
          inputSchema?: { additionalProperties?: boolean };
          annotations?: { idempotentHint?: boolean };
        }) =>
          tool.inputSchema?.additionalProperties === false &&
          tool.annotations?.idempotentHint === true,
      ),
    ).toBe(true);
    const zeroArgumentTools = payload.result.tools.filter(
      (tool: {
        inputSchema?: {
          properties?: Record<string, unknown>;
          required?: string[];
        };
      }) => Object.keys(tool.inputSchema?.properties ?? {}).length === 0,
    );
    expect(zeroArgumentTools).toHaveLength(6);
    expect(
      zeroArgumentTools.every(
        (tool: { inputSchema?: { required?: string[] } }) =>
          Array.isArray(tool.inputSchema?.required) &&
          tool.inputSchema.required.length === 0,
      ),
    ).toBe(true);
    expect(
      payload.result.tools.filter(
        (tool: { annotations?: { readOnlyHint?: boolean } }) =>
          tool.annotations?.readOnlyHint === false,
      ),
    ).toHaveLength(7);
    const semantic = payload.result.tools.find(
      (tool: { name: string }) => tool.name === "evidence_semantic_search",
    );
    expect(semantic.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ["query", "idempotencyKey"],
      properties: {
        limit: { maximum: 20 },
        idempotencyKey: { minLength: 8, maxLength: 96 },
      },
    });
    const timeline = payload.result.tools.find(
      (tool: { name: string }) => tool.name === "evidence_claim_timeline",
    );
    expect(timeline).toMatchObject({
      inputSchema: {
        additionalProperties: false,
        required: ["claimKey"],
        properties: { limit: { maximum: 50 } },
      },
    });
  });

  test("validates and relays semantic search with MCP idempotency parity", async () => {
    vi.stubEnv(
      "AGENT_SEMANTIC_RELAY_SECRET",
      "test-semantic-relay-secret-at-least-32-characters",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, [{ title: "Lexical fallback" }]));
    vi.stubGlobal("fetch", fetchMock);

    const invalid = await POST(
      modernSemanticToolCall({ query: "convex", limit: 10 }),
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe(-32602);
    expect(fetchMock).not.toHaveBeenCalled();

    const response = await POST(
      modernSemanticToolCall({
        query: "convex",
        limit: 10,
        idempotencyKey: "semantic-mcp-001",
      }),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("x-symbaiex-semantic-relay")).toBe(
      "test-semantic-relay-secret-at-least-32-characters",
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      operation: "semantic_search",
      input: { query: "convex", limit: 10 },
      idempotencyKey: "semantic-mcp-001",
    });
  });

  test("relays claim timelines with the same operation and payload as REST", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, [{ status: "outdated" }]));
    vi.stubGlobal("fetch", fetchMock);
    const name = "evidence_claim_timeline";
    const response = await POST(
      modernRequest(
        "tools/call",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name,
            arguments: { claimKey: "release-security", limit: 2 },
            ...modernParams(),
          },
        },
        "2026-07-28",
        name,
      ),
    );
    expect(response.status).toBe(200);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      operation: "claim_timeline",
      input: { claimKey: "release-security", limit: 2 },
    });
    expect((await response.json()).result.content).toEqual([
      { type: "text", text: JSON.stringify([{ status: "outdated" }]) },
    ]);
  });

  test("accepts legacy dotted product tool names as aliases", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, [{ title: "Legacy search" }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      legacyRequest({
        jsonrpc: "2.0",
        id: "legacy-search",
        method: "tools/call",
        params: {
          name: "evidence.search",
          arguments: { query: "compatibility", limit: 1 },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      operation: "search",
      input: { query: "compatibility", limit: 1 },
    });
  });

  test("rejects modern initialize, unsupported versions, and header mismatches explicitly", async () => {
    vi.stubGlobal("fetch", validAuthentication());

    const initialized = await POST(
      modernRequest("initialize", {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: modernParams(),
      }),
    );
    expect(initialized.status).toBe(404);
    expect((await initialized.json()).error.code).toBe(-32601);

    const unsupported = await POST(
      modernRequest(
        "tools/list",
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: modernParams("2099-01-01"),
        },
        "2099-01-01",
      ),
    );
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error).toMatchObject({
      code: -32022,
      data: {
        requested: "2099-01-01",
        supported: ["2026-07-28", "2025-03-26"],
      },
    });

    const mismatch = await POST(
      modernRequest("tools/call", {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: modernParams(),
      }),
    );
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error.code).toBe(-32020);
  });

  test("validates every modern metadata envelope and routed tool name", async () => {
    const missingVersionHeader = await POST(
      new Request("https://www.symbaiex.com/api/agent/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
          "mcp-method": "tools/list",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: modernParams(),
        }),
      }),
    );
    expect(missingVersionHeader.status).toBe(400);
    expect((await missingVersionHeader.json()).error.code).toBe(-32020);

    const mismatchedName = await POST(
      modernRequest(
        "tools/call",
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "evidence.status",
            arguments: {},
            ...modernParams(),
          },
        },
        "2026-07-28",
        "evidence.search",
      ),
    );
    expect(mismatchedName.status).toBe(400);
    expect((await mismatchedName.json()).error.code).toBe(-32020);

    const malformedClient = await POST(
      modernRequest("tools/list", {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": "not-an-object",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    );
    expect(malformedClient.status).toBe(400);
    expect((await malformedClient.json()).error.code).toBe(-32600);
  });

  test("rejects structured, boolean, missing, and non-finite legacy ids without echoing them", async () => {
    const invalidBodies = [
      '{"jsonrpc":"2.0","id":{"nested":"attacker"},"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":["attacker"],"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":true,"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":1e400,"method":"tools/list"}',
      '{"jsonrpc":"2.0","method":"tools/list"}',
    ];

    for (const body of invalidBodies) {
      const response = await POST(legacyRawRequest(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      });
    }
  });

  test("rejects invalid modern ids with modern response metadata and a null response id", async () => {
    const bodies = [
      modernBodyWithRawId('{"nested":"attacker"}'),
      modernBodyWithRawId('["attacker"]'),
      modernBodyWithRawId("false"),
      modernBodyWithRawId("1e400"),
    ];

    for (const body of bodies) {
      const response = await POST(modernRawRequest("tools/list", body));
      expect(response.status).toBe(400);
      expect(response.headers.get("mcp-protocol-version")).toBe("2026-07-28");
      expect(await response.json()).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      });
    }
  });

  test("accepts null ids for modern and legacy callers", async () => {
    vi.stubGlobal("fetch", validAuthentication());

    const legacy = await POST(
      legacyRequest({ jsonrpc: "2.0", id: null, method: "tools/list" }),
    );
    expect(legacy.status).toBe(200);
    expect((await legacy.json()).id).toBeNull();

    const modern = await POST(
      modernRequest("tools/list", {
        jsonrpc: "2.0",
        id: null,
        method: "tools/list",
        params: modernParams(),
      }),
    );
    expect(modern.status).toBe(200);
    expect((await modern.json()).id).toBeNull();
  });

  test("preserves invalid-token 401 and insufficient-scope 403 for tool calls", async () => {
    const unauthorizedFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "Invalid token." }));
    vi.stubGlobal("fetch", unauthorizedFetch);
    const unauthorized = await POST(
      modernToolCall("evidence_status", "invalid-token"),
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://www.symbaiex.com/.well-known/oauth-protected-resource"',
    );
    expect(unauthorized.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
    expect((await unauthorized.json()).error).toBe("Invalid token.");

    const forbiddenFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(403, { error: "AGENT_SCOPE_DENIED" }),
      );
    vi.stubGlobal("fetch", forbiddenFetch);
    const forbidden = await POST(
      modernToolCall("evidence_status", "missing-scope"),
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"',
    );
    expect(forbidden.headers.get("www-authenticate")).toContain(
      'scope="evidence"',
    );
    expect((await forbidden.json()).error).toBe("AGENT_SCOPE_DENIED");
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

function modernParams(version = "2026-07-28") {
  return {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": version,
      "io.modelcontextprotocol/clientInfo": {
        name: "symbaiex-contract-test",
        version: "1.0.0",
      },
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
}

function modernRequest(
  method: string,
  body: Record<string, unknown>,
  version = "2026-07-28",
  name?: string,
) {
  return new Request("https://www.symbaiex.com/api/agent/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer test",
      "content-type": "application/json",
      "mcp-protocol-version": version,
      "mcp-method": method,
      ...(name === undefined ? {} : { "mcp-name": name }),
    },
    body: JSON.stringify(body),
  });
}

function modernRawRequest(method: string, body: string) {
  return new Request("https://www.symbaiex.com/api/agent/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer test",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
    },
    body,
  });
}

function modernBodyWithRawId(id: string) {
  return `{"jsonrpc":"2.0","id":${id},"method":"tools/list","params":${JSON.stringify(modernParams())}}`;
}

function modernToolCall(name: string, token: string) {
  return new Request("https://www.symbaiex.com/api/agent/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {}, ...modernParams() },
    }),
  });
}

function modernSemanticToolCall(argumentsValue: Record<string, unknown>) {
  const name = "evidence_semantic_search";
  return new Request("https://www.symbaiex.com/api/agent/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer test",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: argumentsValue, ...modernParams() },
    }),
  });
}

function legacyRequest(body: Record<string, unknown>, authenticated = true) {
  return new Request("https://www.symbaiex.com/api/agent/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: "Bearer test" } : {}),
    },
    body: JSON.stringify(body),
  });
}

function legacyRawRequest(body: string) {
  return new Request("https://www.symbaiex.com/api/agent/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer test",
      "content-type": "application/json",
    },
    body,
  });
}

function validAuthentication() {
  return vi.fn().mockImplementation(async () =>
    jsonResponse(200, {
      status: "available",
    }),
  );
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
