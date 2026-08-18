import { agentBearerChallenge } from "@/lib/agent-auth-metadata";
import {
  AGENT_DATA_MAX_BODY_BYTES,
  agentDataHeaders,
  agentDataJson,
  bearer,
  isAllowedAgentOrigin,
  relayAgentData,
  type AgentDataOperation,
} from "@/lib/agent-data-api-relay";

export const dynamic = "force-dynamic";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-03-26";
const SERVER_NAME = "symbaiex-evidence";
const SERVER_VERSION = "v1";
const TOOL_LIST_TTL_MS = 5 * 60 * 1_000;
const DISCOVERY_TTL_MS = 60 * 60 * 1_000;
const SERVER_INFO = { name: SERVER_NAME, version: SERVER_VERSION } as const;

const TOOL_ENTRIES = [
  ["evidence.status", "status"],
  ["evidence.sources", "sources"],
  ["evidence.search", "search"],
  ["evidence.semantic_search", "semantic_search"],
  ["evidence.universal_search", "universal_search"],
  ["evidence.document", "document"],
  ["evidence.changes", "changes"],
  ["evidence.verify_claim", "verify"],
  ["evidence.search_entities", "entities"],
  ["evidence.version_claims", "version_claims"],
  ["evidence.claim_timeline", "claim_timeline"],
  ["evidence.products", "products"],
  ["evidence.datasets", "datasets"],
  ["evidence.benchmarks", "benchmarks"],
  ["evidence.quota", "quota"],
  ["evidence.entitlements", "entitlements"],
  ["evidence.usage", "usage"],
  ["evidence.create_research", "research_create"],
  ["evidence.get_research", "research_get"],
  ["evidence.get_research_artifact", "research_artifact"],
  ["evidence.create_export", "export_create"],
  ["evidence.get_export", "export_get"],
  ["evidence.get_export_artifact", "export_artifact"],
  ["evidence.list_webhooks", "webhooks_list"],
  ["evidence.webhook_availability", "webhooks_availability"],
  ["evidence.create_webhook", "webhooks_create"],
  ["evidence.set_webhook_status", "webhooks_status"],
  ["evidence.webhook_health", "webhooks_health"],
  ["evidence.webhook_history", "webhooks_history"],
  ["evidence.rotate_webhook_secret", "webhooks_rotate"],
  ["evidence.replay_webhook_delivery", "webhooks_replay"],
  ["evidence.send_webhook_test", "webhooks_test"],
] as const satisfies ReadonlyArray<readonly [string, AgentDataOperation]>;

const TOOLS = new Map<string, AgentDataOperation>(TOOL_ENTRIES);
const TOOL_DEFINITIONS = TOOL_ENTRIES.map(([name]) =>
  name === "evidence.semantic_search"
    ? {
        name,
        description:
          "Search the public corpus with feature-gated semantic enhancement and a lexical-only fallback.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["query", "idempotencyKey"],
          properties: {
            query: { type: "string", minLength: 1, maxLength: 300 },
            limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
            idempotencyKey: {
              type: "string",
              minLength: 8,
              maxLength: 96,
              pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
            },
          },
        },
      }
    : name === "evidence.claim_timeline"
      ? {
          name,
          description:
            "Read the bounded public supersession timeline for a claim key. Status changes use supported, contradicted, unresolved, or outdated; they do not create a separate timeline status.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["claimKey"],
            properties: {
              claimKey: { type: "string", minLength: 1, maxLength: 200 },
              limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            },
          },
        }
      : {
          name,
          description: `Read ${name.replace("evidence.", "").replaceAll("_", " ")} from the SYMBaiEX evidence API.`,
          inputSchema: { type: "object", additionalProperties: true },
        },
);

type ProtocolEra = "legacy" | "modern";
type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export async function POST(request: Request) {
  if (!isAllowedAgentOrigin(request)) {
    return mcpJson(request, { error: "Origin is not allowed." }, 403);
  }
  const authorization = bearer(request);
  if (!authorization) {
    return mcpAuthJson(
      request,
      { error: "A bearer access token is required." },
      401,
    );
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > AGENT_DATA_MAX_BODY_BYTES) {
    return mcpJson(request, { error: "Request body is too large." }, 413);
  }

  let body: Record<string, unknown>;
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > AGENT_DATA_MAX_BODY_BYTES) {
      return mcpJson(request, { error: "Request body is too large." }, 413);
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(parsed)) throw new Error();
    body = parsed;
  } catch {
    return mcpJson(request, { error: "Invalid JSON-RPC request." }, 400);
  }

  if (!Object.hasOwn(body, "id") || !isJsonRpcId(body.id)) {
    return rpc(request, protocolEraHint(request, body), null, undefined, {
      code: -32600,
      message: "Invalid Request",
    });
  }
  const id = body.id;
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpc(request, "legacy", id, undefined, {
      code: -32600,
      message: "Invalid Request",
    });
  }

  const protocol = validateProtocolRequest(request, body, id);
  if (protocol instanceof Response) return protocol;

  if (
    body.method === "initialize" ||
    body.method === "server/discover" ||
    body.method === "tools/list" ||
    body.method !== "tools/call" ||
    !isRecord(body.params) ||
    typeof body.params.name !== "string" ||
    !TOOLS.has(body.params.name)
  ) {
    const authentication = await validateLocalRequestAuthentication(
      request,
      authorization,
    );
    if (authentication !== null) return authentication;
  }

  if (body.method === "initialize") {
    if (protocol === "modern") {
      return rpc(
        request,
        protocol,
        id,
        undefined,
        { code: -32601, message: "Method not found" },
        404,
      );
    }
    return rpc(request, protocol, id, {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (body.method === "server/discover") {
    if (protocol !== "modern") {
      return rpc(request, protocol, id, undefined, {
        code: -32601,
        message: "Method not found",
      });
    }
    return rpc(request, protocol, id, {
      resultType: "complete",
      supportedVersions: [MODERN_PROTOCOL_VERSION],
      capabilities: { tools: {} },
      instructions:
        "Authenticated evidence tools require the evidence scope. SYMBaiEX uses a custom Ed25519 challenge flow, not OAuth authorization endpoints.",
      ttlMs: DISCOVERY_TTL_MS,
      cacheScope: "public",
    });
  }

  if (body.method === "tools/list") {
    return rpc(request, protocol, id, {
      ...(protocol === "modern" ? { resultType: "complete" } : {}),
      tools: TOOL_DEFINITIONS,
      ...(protocol === "modern"
        ? { ttlMs: TOOL_LIST_TTL_MS, cacheScope: "public" }
        : {}),
    });
  }

  if (body.method !== "tools/call" || !isRecord(body.params)) {
    return rpc(
      request,
      protocol,
      id,
      undefined,
      { code: -32601, message: "Method not found" },
      protocol === "modern" ? 404 : 400,
    );
  }

  const name = typeof body.params.name === "string" ? body.params.name : "";
  const operation = TOOLS.get(name);
  if (!operation) {
    return rpc(request, protocol, id, undefined, {
      code: -32602,
      message: "Unknown tool",
    });
  }
  const rawInput = isRecord(body.params.arguments) ? body.params.arguments : {};
  let input = rawInput;
  let idempotencyKey: string | undefined;
  if (operation === "semantic_search") {
    const validated = semanticSearchInput(rawInput);
    if (validated === null) {
      return rpc(request, protocol, id, undefined, {
        code: -32602,
        message: "Invalid semantic search arguments",
      });
    }
    input = { query: validated.query, limit: validated.limit };
    idempotencyKey = validated.idempotencyKey;
  }
  const upstream = await relayAgentData(
    request,
    operation,
    input,
    authorization,
    idempotencyKey,
  );
  if (upstream.status === 401 || upstream.status === 403) {
    return mcpAuthResponse(request, upstream, upstream.status);
  }
  const result = await upstream
    .json()
    .catch(() => ({ error: "Invalid upstream response." }));
  if (!upstream.ok) {
    return rpc(request, protocol, id, {
      ...(protocol === "modern" ? { resultType: "complete" } : {}),
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: true,
    });
  }
  return rpc(request, protocol, id, {
    ...(protocol === "modern" ? { resultType: "complete" } : {}),
    content: [{ type: "text", text: JSON.stringify(result) }],
  });
}

export function OPTIONS(request: Request) {
  return isAllowedAgentOrigin(request)
    ? new Response(null, { status: 204, headers: mcpHeaders(request) })
    : mcpJson(request, { error: "Origin is not allowed." }, 403);
}

function validateProtocolRequest(
  request: Request,
  body: Record<string, unknown>,
  id: unknown,
): ProtocolEra | Response {
  const headerVersion = request.headers.get("mcp-protocol-version");
  const params = isRecord(body.params) ? body.params : null;
  const meta = params && isRecord(params._meta) ? params._meta : null;
  const metaVersion = meta?.["io.modelcontextprotocol/protocolVersion"];
  const hasModernEnvelope = metaVersion !== undefined;

  if (!hasModernEnvelope && headerVersion === null) return "legacy";
  if (
    !hasModernEnvelope &&
    headerVersion !== null &&
    headerVersion !== MODERN_PROTOCOL_VERSION
  ) {
    if (headerVersion === LEGACY_PROTOCOL_VERSION) return "legacy";
    return unsupportedProtocol(request, id, headerVersion);
  }
  if (
    meta === null ||
    typeof metaVersion !== "string" ||
    headerVersion === null ||
    headerVersion !== metaVersion
  ) {
    return protocolError(request, id, {
      code: -32020,
      message:
        "Header mismatch: MCP-Protocol-Version must match request _meta.",
    });
  }
  if (metaVersion !== MODERN_PROTOCOL_VERSION) {
    return unsupportedProtocol(request, id, metaVersion);
  }
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  ) {
    return protocolError(request, id, {
      code: -32020,
      message: "Header mismatch: Content-Type must be application/json.",
    });
  }
  if (!isRecord(meta["io.modelcontextprotocol/clientCapabilities"])) {
    return protocolError(request, id, {
      code: -32600,
      message: "Invalid Request: clientCapabilities metadata is required.",
    });
  }
  const clientInfo = meta["io.modelcontextprotocol/clientInfo"];
  if (
    clientInfo !== undefined &&
    (!isRecord(clientInfo) ||
      typeof clientInfo.name !== "string" ||
      typeof clientInfo.version !== "string")
  ) {
    return protocolError(request, id, {
      code: -32600,
      message: "Invalid Request: clientInfo metadata is malformed.",
    });
  }
  const headerMethod = request.headers.get("mcp-method");
  if (headerMethod === null || headerMethod !== body.method) {
    return protocolError(request, id, {
      code: -32020,
      message: "Header mismatch: Mcp-Method must match the request method.",
    });
  }
  if (body.method === "tools/call") {
    const bodyName = typeof params?.name === "string" ? params.name : null;
    const headerName = decodeMcpHeaderValue(request.headers.get("mcp-name"));
    if (bodyName === null || headerName === null || headerName !== bodyName) {
      return protocolError(request, id, {
        code: -32020,
        message: "Header mismatch: Mcp-Name must match the requested tool.",
      });
    }
  }
  return "modern";
}

function semanticSearchInput(value: Record<string, unknown>) {
  if (
    Object.keys(value).some(
      (key) => !["query", "limit", "idempotencyKey"].includes(key),
    ) ||
    typeof value.query !== "string" ||
    value.query.trim().length === 0 ||
    value.query.length > 300 ||
    typeof value.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/.test(value.idempotencyKey)
  ) {
    return null;
  }
  const limit = value.limit ?? 10;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 20)
    return null;
  return {
    query: value.query.replace(/\s+/g, " ").trim(),
    limit: Number(limit),
    idempotencyKey: value.idempotencyKey,
  };
}

async function validateLocalRequestAuthentication(
  request: Request,
  authorization: string,
) {
  const response = await relayAgentData(request, "status", {}, authorization);
  if (response.ok) return null;
  if (response.status === 401 || response.status === 403) {
    return mcpAuthResponse(request, response, response.status);
  }
  setMcpHeaders(response.headers);
  return response;
}

function unsupportedProtocol(request: Request, id: unknown, requested: string) {
  return protocolError(request, id, {
    code: -32022,
    message: "Unsupported protocol version",
    data: {
      supported: [MODERN_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION],
      requested,
    },
  });
}

function protocolError(request: Request, id: unknown, error: JsonRpcError) {
  return rpc(request, "modern", id, undefined, error, 400);
}

function rpc(
  request: Request,
  protocol: ProtocolEra,
  id: unknown,
  result?: unknown,
  error?: JsonRpcError,
  status = error ? 400 : 200,
) {
  const responseResult =
    protocol === "modern" && isRecord(result)
      ? {
          ...result,
          _meta: {
            ...(isRecord(result._meta) ? result._meta : {}),
            "io.modelcontextprotocol/serverInfo": SERVER_INFO,
          },
        }
      : result;
  return new Response(
    JSON.stringify(
      error
        ? { jsonrpc: "2.0", id, error }
        : { jsonrpc: "2.0", id, result: responseResult },
    ),
    { status, headers: mcpHeaders(request, protocol) },
  );
}

function mcpAuthJson(request: Request, payload: unknown, status: 401 | 403) {
  const response = mcpJson(request, payload, status);
  response.headers.set(
    "WWW-Authenticate",
    agentBearerChallenge(
      status,
      status === 403
        ? { description: "The evidence scope is required." }
        : undefined,
    ),
  );
  return response;
}

async function mcpAuthResponse(
  request: Request,
  upstream: Response,
  status: 401 | 403,
) {
  const headers = mcpHeaders(
    request,
    undefined,
    upstream.headers.get("content-type") ?? "application/json",
  );
  headers.set(
    "WWW-Authenticate",
    agentBearerChallenge(
      status,
      status === 403
        ? { description: "The evidence scope is required." }
        : { invalidToken: true },
    ),
  );
  return new Response(await upstream.arrayBuffer(), { status, headers });
}

function mcpJson(request: Request, payload: unknown, status: number) {
  const response = agentDataJson(request, payload, status);
  setMcpHeaders(response.headers);
  return response;
}

function mcpHeaders(
  request: Request,
  protocol?: ProtocolEra,
  contentType = "application/json",
) {
  const headers = agentDataHeaders(request, contentType);
  setMcpHeaders(headers);
  if (protocol === "modern") {
    headers.set("MCP-Protocol-Version", MODERN_PROTOCOL_VERSION);
  }
  return headers;
}

function setMcpHeaders(headers: Headers) {
  headers.set("Mcp-Server-Name", SERVER_NAME);
  headers.set("Mcp-Server-Version", SERVER_VERSION);
}

function decodeMcpHeaderValue(value: string | null) {
  if (value === null) return null;
  if (!value.startsWith("=?base64?") || !value.endsWith("?=")) return value;
  const encoded = value.slice("=?base64?".length, -2);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is string | number | null {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function protocolEraHint(
  request: Request,
  body: Record<string, unknown>,
): ProtocolEra {
  const params = isRecord(body.params) ? body.params : null;
  const meta = params && isRecord(params._meta) ? params._meta : null;
  return request.headers.has("mcp-protocol-version") ||
    meta?.["io.modelcontextprotocol/protocolVersion"] !== undefined
    ? "modern"
    : "legacy";
}
