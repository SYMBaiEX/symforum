
import { PRIMARY_SITE_URL } from "../../../../../../lib/site-urls";
import { publicDocumentation } from "@/lib/public-documentation";
import {
  DOCS_MCP_MODERN_VERSION,
  DOCS_MCP_PROTOCOL_VERSIONS,
  validateDocsProtocol,
  type DocsProtocol,
} from "@/lib/docs-mcp-protocol";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set<string>(DOCS_MCP_PROTOCOL_VERSIONS);
const SERVER_INFO = { name: "symbaiex-docs", version: "v1" } as const;

const SEARCH_TOOL = {
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

const LIST_TOOL = {
  name: "docs_list",
  description:
    "List the bounded canonical SYMBaiEX developer and agent documentation resources.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: [],
    properties: {},
  },
  annotations: SEARCH_TOOL.annotations,
} as const;

const GET_TOOL = {
  name: "docs_get",
  description:
    "Read one canonical SYMBaiEX documentation resource by URI from docs_list.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["uri"],
    properties: {
      uri: { type: "string", format: "uri", maxLength: 300 },
    },
  },
  annotations: SEARCH_TOOL.annotations,
} as const;

const TOOLS = [SEARCH_TOOL, LIST_TOOL, GET_TOOL] as const;

export async function POST(request: Request) {
  const DOCUMENTS = publicDocumentation();
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
  let body: Record<string, unknown>;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Empty body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BODY_BYTES)
          return json({ error: "Request body is too large." }, 413);
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
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
  const requestedProtocolVersion = request.headers.get("mcp-protocol-version");
  const protocol = validateDocsProtocol(request, body);
  if (typeof protocol !== "string")
    return rpc(
      isJsonRpcId(body.id) ? body.id : null,
      undefined,
      protocol,
      400,
      requestedProtocolVersion === DOCS_MCP_MODERN_VERSION
        ? "modern"
        : "legacy",
    );
  const respond = (
    id: string | number | null,
    result?: unknown,
    error?: { code: number; message: string; data?: unknown },
    status = 200,
  ) => rpc(id, result, error, status, protocol);
  if (
    body.method === "notifications/initialized" &&
    protocol === "legacy" &&
    !Object.hasOwn(body, "id")
  ) {
    return new Response(null, { status: 202, headers: headers() });
  }
  if (!Object.hasOwn(body, "id") || !isJsonRpcId(body.id)) {
    return respond(
      null,
      undefined,
      { code: -32600, message: "Invalid Request" },
      400,
    );
  }
  const id = body.id;

  if (protocol === "modern" && body.method === "server/discover") {
    return respond(id, {
      supportedVersions: [DOCS_MCP_MODERN_VERSION],
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Public read-only SYMBaiEX documentation. Search with docs_search, list with docs_list, and read returned URIs with docs_get. Evidence tools are a separate authenticated server at " + PRIMARY_SITE_URL + "/api/agent/mcp.",
      ttl: 300,
      cacheScope: "public",
    });
  }
  if (protocol === "modern" && body.method === "initialize") {
    return respond(
      id,
      undefined,
      { code: -32601, message: "Use server/discover for protocol 2026-07-28." },
      404,
    );
  }

  if (body.method === "initialize") {
    const params = isRecord(body.params) ? body.params : null;
    const paramsProtocolVersion = params?.protocolVersion;
    if (
      typeof paramsProtocolVersion === "string" &&
      (!SUPPORTED_PROTOCOL_VERSIONS.has(paramsProtocolVersion) ||
        paramsProtocolVersion === DOCS_MCP_MODERN_VERSION)
    ) {
      return rpc(
        id,
        undefined,
        {
          code: -32022,
          message: "Unsupported protocol version",
          data: {
            supported: DOCS_MCP_PROTOCOL_VERSIONS.slice(1),
            requested: paramsProtocolVersion,
          },
        },
        400,
      );
    }
    if (
      requestedProtocolVersion !== null &&
      typeof paramsProtocolVersion === "string" &&
      requestedProtocolVersion !== paramsProtocolVersion
    ) {
      return rpc(
        id,
        undefined,
        {
          code: -32020,
          message:
            "Header mismatch: MCP-Protocol-Version must match initialize params.protocolVersion.",
        },
        400,
      );
    }
    const protocolVersion =
      typeof paramsProtocolVersion === "string"
        ? paramsProtocolVersion
        : (requestedProtocolVersion ?? DEFAULT_PROTOCOL_VERSION);
    return respond(id, {
      protocolVersion,
      capabilities: { tools: {}, resources: {} },
      serverInfo: SERVER_INFO,
      instructions:
        "Public read-only SYMBaiEX documentation. No token, write, provider call, or private record is available here.",
    });
  }
  if (body.method === "tools/list") {
    return respond(id, { tools: TOOLS });
  }
  if (body.method === "resources/list") {
    return respond(id, {
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
      return respond(id, undefined, {
        code: -32602,
        message: "Unknown resource",
      });
    }
    return respond(id, {
      contents: [
        { uri: document.uri, mimeType: "text/markdown", text: document.text },
      ],
    });
  }
  if (body.method === "tools/call") {
    const params = isRecord(body.params) ? body.params : null;
    const input = isRecord(params?.arguments) ? params.arguments : null;
    if (params?.name === LIST_TOOL.name && validEmpty(input)) {
      const resources = DOCUMENTS.map(({ uri, name, description }) => ({
        uri,
        name,
        description,
        mimeType: "text/markdown",
      }));
      return toolResult(id, { resources }, protocol);
    }
    if (params?.name === GET_TOOL.name && validGet(input)) {
      const document = DOCUMENTS.find((entry) => entry.uri === input.uri);
      if (!document) {
        return respond(id, undefined, {
          code: -32602,
          message: "Unknown documentation URI",
        });
      }
      return toolResult(
        id,
        {
          resource: {
            uri: document.uri,
            name: document.name,
            description: document.description,
            mimeType: "text/markdown",
            text: document.text,
          },
        },
        protocol,
      );
    }
    if (!isDocsSearchTool(params?.name) || !validSearch(input)) {
      return respond(id, undefined, {
        code: -32602,
        message: "Invalid docs_search arguments",
      });
    }
    const results = search(DOCUMENTS, input.query, input.limit);
    return toolResult(id, { results }, protocol);
  }
  if (body.method === "ping") return respond(id, {});
  return respond(
    id,
    undefined,
    { code: -32601, message: "Method not found" },
    protocol === "modern" ? 404 : 200,
  );
}

function isDocsSearchTool(name: unknown) {
  return name === SEARCH_TOOL.name || name === "docs.search";
}

function toolResult(
  id: string | number | null,
  structuredContent: unknown,
  protocol: DocsProtocol,
) {
  return rpc(
    id,
    {
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent,
    },
    undefined,
    200,
    protocol,
  );
}

function validEmpty(value: Record<string, unknown> | null) {
  return value !== null && Object.keys(value).length === 0;
}

function validGet(
  value: Record<string, unknown> | null,
): value is { uri: string } {
  return (
    value !== null &&
    Object.keys(value).length === 1 &&
    typeof value.uri === "string" &&
    value.uri.length <= 300
  );
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

function search(
  DOCUMENTS: ReturnType<typeof publicDocumentation>,
  query: string,
  requestedLimit: number | undefined,
) {
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
    titleMatches: terms.filter((term) =>
      document.name.toLowerCase().includes(term),
    ).length,
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
        right.titleMatches - left.titleMatches ||
        left.document.name.length - right.document.name.length ||
        left.document.name.localeCompare(right.document.name),
    )
    .slice(0, limit);
  return ranked.map(({ document, score }) => ({
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
  error?: { code: number; message: string; data?: unknown },
  status = 200,
  protocol: DocsProtocol = "legacy",
) {
  const value =
    protocol === "modern" && isRecord(result)
      ? {
          ...result,
          resultType: "complete",
          _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
        }
      : result;
  const response = json(
    { jsonrpc: "2.0", id, ...(error ? { error } : { result: value }) },
    status,
  );
  if (protocol === "modern")
    response.headers.set("MCP-Protocol-Version", DOCS_MCP_MODERN_VERSION);
  return response;
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
    "Access-Control-Expose-Headers":
      "mcp-server-name, mcp-server-version, mcp-protocol-version",
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
