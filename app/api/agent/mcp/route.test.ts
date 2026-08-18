import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "./route";

const originalSiteUrl = process.env.CONVEX_SITE_URL;

beforeEach(() => {
  process.env.CONVEX_SITE_URL = "https://private-backend.example";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSiteUrl === undefined) delete process.env.CONVEX_SITE_URL;
  else process.env.CONVEX_SITE_URL = originalSiteUrl;
});

describe("evidence MCP endpoint", () => {
  test("requires bearer authentication with protected-resource metadata", async () => {
    const response = await POST(
      legacyRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, false),
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
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
  });

  test("supports authenticated legacy initialize and tool listing only on the legacy path", async () => {
    vi.stubGlobal("fetch", validAuthentication());

    const initialized = await POST(
      legacyRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      }),
    );
    expect(initialized.status).toBe(200);
    expect(await initialized.json()).toMatchObject({
      result: {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "symbaiex-evidence", version: "v1" },
      },
    });

    const listed = await POST(
      legacyRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const payload = await listed.json();
    expect(listed.status).toBe(200);
    expect(payload.result.resultType).toBeUndefined();
    expect(payload.result.ttlMs).toBeUndefined();
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
      capabilities: { tools: {} },
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
      "evidence.status",
      "evidence.sources",
      "evidence.search",
      "evidence.universal_search",
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
      "evidence.webhook_availability",
      "evidence.create_webhook",
      "evidence.set_webhook_status",
      "evidence.webhook_health",
      "evidence.webhook_history",
      "evidence.rotate_webhook_secret",
      "evidence.replay_webhook_delivery",
      "evidence.send_webhook_test",
    ]);
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
      modernToolCall("evidence.status", "invalid-token"),
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
      modernToolCall("evidence.status", "missing-scope"),
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
