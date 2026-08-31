import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 32 * 1024;
const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "symbaiex-docs", version: "v1" } as const;

const DOCUMENTS = [
  {
    uri: primarySiteUrl("/developers"),
    name: "SYMBaiEX developer guide",
    description:
      "Human accounts, agent enrollment, API contracts, clients, MCP, quotas, research jobs, exports, and webhooks.",
    text: `# SYMBaiEX developer guide\n\nCanonical: ${primarySiteUrl("/developers")}\n\nStart with the public API manifest, OpenAPI contract, agent instructions, and authentication guide. Install the official TypeScript SDK from https://www.npmjs.com/package/@symbaiex/agent-sdk or the Bun CLI from https://www.npmjs.com/package/@symbaiex/agent-cli. TypeScript, CLI, and Python source remain public at https://github.com/SYMBaiEX/symbaiex-agent-clients.`,
  },
  {
    uri: primarySiteUrl("/auth.md"),
    name: "SYMBaiEX authentication",
    description:
      "Owner-approved Ed25519 enrollment, challenge-response sign-in, refresh, errors, and revocation.",
    text: `# SYMBaiEX authentication\n\nCanonical: ${primarySiteUrl("/auth.md")}\n\nSYMBaiEX uses a custom owner-approved Ed25519 challenge flow, not OAuth. Keep private keys local, use bearer tokens only with https://www.symbaiex.com, and follow the canonical auth.md walkthrough.`,
  },
  {
    uri: primarySiteUrl("/agent/instructions"),
    name: "SYMBaiEX agent instructions",
    description:
      "When to use SYMBaiEX, public reading, identity, scope, quota, attribution, and consequential-action boundaries.",
    text: `# SYMBaiEX agent instructions\n\nCanonical: ${primarySiteUrl("/agent/instructions")}\n\nUse SYMBaiEX for public source-linked evidence, claim verification, cited research jobs, and signed change events. Do not infer private data, payment rails, OAuth, GraphQL, or autonomous posting authority.`,
  },
  {
    uri: primarySiteUrl("/api/agent"),
    name: "SYMBaiEX Agent API manifest",
    description:
      "Live machine-readable capabilities, endpoints, authentication, quotas, and disabled payment boundaries.",
    text: `# SYMBaiEX Agent API manifest\n\nCanonical: ${primarySiteUrl("/api/agent")}\n\nRead the live JSON manifest and ${primarySiteUrl("/api/agent/openapi.json")} before calling the authenticated evidence API. Public docs MCP reads never create records; evidence tool calls require an owner-approved identity and scope.`,
  },
  {
    uri: primarySiteUrl("/pricing.md"),
    name: "SYMBaiEX API pricing and limits",
    description:
      "Current $0 free-beta policy, quotas, export bounds, and inactive payment boundary.",
    text: `# SYMBaiEX API pricing\n\nCanonical: ${primarySiteUrl("/pricing.md")}\n\nThe evidence API is a quota-limited $0 free beta. Billing and payment are disabled. Read the canonical pricing contract for exact owner, agent, request, rate, export, and retention limits.`,
  },
] as const;

const TOOL = {
  name: "docs_search",
  description:
    "Search the bounded public SYMBaiEX developer and agent documentation index.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", minLength: 1, maxLength: 200 },
      limit: { type: "integer", minimum: 1, maximum: 4, default: 4 },
    },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["uri", "name", "description", "score"],
          properties: {
            uri: { type: "string", format: "uri", maxLength: 300 },
            name: { type: "string", minLength: 1, maxLength: 120 },
            description: { type: "string", minLength: 1, maxLength: 500 },
            score: { type: "integer", minimum: 1, maximum: 16 },
          },
        },
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return json({ error: "Request body is too large." }, 413);
  }
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  ) {
    return json({ error: "Content-Type must be application/json." }, 415);
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    return json({ error: "Request body is too large." }, 413);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!isRecord(parsed)) throw new Error();
    body = parsed;
  } catch {
    return json({ error: "Invalid JSON-RPC request." }, 400);
  }

  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpc(null, undefined, { code: -32600, message: "Invalid Request" });
  }
  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 204, headers: headers() });
  }
  if (!Object.hasOwn(body, "id") || !isJsonRpcId(body.id)) {
    return rpc(null, undefined, { code: -32600, message: "Invalid Request" });
  }
  const id = body.id;

  if (body.method === "initialize") {
    return rpc(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      serverInfo: SERVER_INFO,
      instructions:
        "Public read-only SYMBaiEX documentation. No token, write, provider call, or private record is available here.",
    });
  }
  if (body.method === "tools/list") {
    return rpc(id, { tools: [TOOL] });
  }
  if (body.method === "resources/list") {
    return rpc(id, {
      resources: DOCUMENTS.map(({ uri, name, description }) => ({
        uri,
        name,
        description,
        mimeType: "text/markdown",
      })),
    });
  }
  if (body.method === "resources/read") {
    const params = isRecord(body.params) ? body.params : null;
    const document = DOCUMENTS.find((entry) => entry.uri === params?.uri);
    if (!document) {
      return rpc(id, undefined, { code: -32602, message: "Unknown resource" });
    }
    return rpc(id, {
      contents: [
        { uri: document.uri, mimeType: "text/markdown", text: document.text },
      ],
    });
  }
  if (body.method === "tools/call") {
    const params = isRecord(body.params) ? body.params : null;
    const input = isRecord(params?.arguments) ? params.arguments : null;
    if (!isDocsSearchTool(params?.name) || !validSearch(input)) {
      return rpc(id, undefined, {
        code: -32602,
        message: "Invalid docs_search arguments",
      });
    }
    const results = search(input.query, input.limit);
    return rpc(id, {
      content: [{ type: "text", text: JSON.stringify({ results }) }],
      structuredContent: { results },
    });
  }
  return rpc(id, undefined, { code: -32601, message: "Method not found" });
}

function isDocsSearchTool(name: unknown) {
  return name === TOOL.name || name === "docs.search";
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: headers() });
}

function unsupportedMethod() {
  return json(
    {
      error: "Use POST with a JSON-RPC 2.0 request.",
      code: "METHOD_NOT_ALLOWED",
      resolution:
        "Initialize the public MCP endpoint, then list tools or resources.",
    },
    405,
  );
}

export const GET = unsupportedMethod;
export const HEAD = unsupportedMethod;
export const PUT = unsupportedMethod;
export const PATCH = unsupportedMethod;
export const DELETE = unsupportedMethod;

function search(query: string, requestedLimit: number | undefined) {
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 2)
        .slice(0, 16),
    ),
  ];
  const limit = Math.min(4, Math.max(1, requestedLimit ?? 4));
  const ranked = DOCUMENTS.map((document) => ({
    document,
    score: terms.filter((term) =>
      `${document.name} ${document.description} ${document.text}`
        .toLowerCase()
        .includes(term),
    ).length,
  }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.name.localeCompare(right.document.name),
    )
    .slice(0, limit);
  return (ranked.length > 0 ? ranked : [{ document: DOCUMENTS[0], score: 1 }])
    .slice(0, limit)
    .map(({ document, score }) => ({
      uri: document.uri,
      name: document.name,
      description: document.description,
      score,
    }));
}

function validSearch(
  value: Record<string, unknown> | null,
): value is { query: string; limit?: number } {
  if (!value) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "query" && key !== "limit")) return false;
  if (
    typeof value.query !== "string" ||
    value.query.trim().length === 0 ||
    value.query.length > 200
  ) {
    return false;
  }
  return (
    value.limit === undefined ||
    (Number.isInteger(value.limit) &&
      Number(value.limit) >= 1 &&
      Number(value.limit) <= 4)
  );
}

function rpc(
  id: string | number | null,
  result?: unknown,
  error?: { code: number; message: string },
) {
  return json({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) });
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: headers() });
}

function headers() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "content-type, mcp-protocol-version, mcp-method, mcp-name",
    "Access-Control-Expose-Headers": "mcp-server-name, mcp-server-version",
    "Mcp-Server-Name": SERVER_INFO.name,
    "Mcp-Server-Version": SERVER_INFO.version,
    "X-Content-Type-Options": "nosniff",
  };
}

function isJsonRpcId(value: unknown): value is string | number | null {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
