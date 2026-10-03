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
const STREAMABLE_HTTP_PROTOCOL_VERSION = "2025-06-18";
const LEGACY_PROTOCOL_VERSION = "2025-03-26";
const SERVER_NAME = "symbaiex-evidence";
const SERVER_VERSION = "v1";
const UI_RESOURCE_URI = "ui://symbaiex/evidence-explorer.html";
const TOOL_LIST_TTL_MS = 5 * 60 * 1_000;
const DISCOVERY_TTL_MS = 60 * 60 * 1_000;
const SERVER_INFO = { name: SERVER_NAME, version: SERVER_VERSION } as const;

const TOOL_ENTRIES = [
  ["evidence_status", "evidence.status", "status"],
  ["evidence_sources", "evidence.sources", "sources"],
  ["evidence_source_registry", "evidence.source_registry", "source_registry"],
  ["evidence_search", "evidence.search", "search"],
  ["evidence_semantic_search", "evidence.semantic_search", "semantic_search"],
  [
    "evidence_universal_search",
    "evidence.universal_search",
    "universal_search",
  ],
  ["evidence_document", "evidence.document", "document"],
  ["evidence_changes", "evidence.changes", "changes"],
  ["evidence_verify_claim", "evidence.verify_claim", "verify"],
  ["evidence_search_entities", "evidence.search_entities", "entities"],
  ["evidence_version_claims", "evidence.version_claims", "version_claims"],
  ["evidence_claim_timeline", "evidence.claim_timeline", "claim_timeline"],
  ["evidence_products", "evidence.products", "products"],
  ["evidence_datasets", "evidence.datasets", "datasets"],
  ["evidence_benchmarks", "evidence.benchmarks", "benchmarks"],
  ["evidence_quota", "evidence.quota", "quota"],
  ["evidence_entitlements", "evidence.entitlements", "entitlements"],
  ["evidence_usage", "evidence.usage", "usage"],
  ["evidence_create_research", "evidence.create_research", "research_create"],
  ["evidence_get_research", "evidence.get_research", "research_get"],
  [
    "evidence_get_research_artifact",
    "evidence.get_research_artifact",
    "research_artifact",
  ],
  ["evidence_create_export", "evidence.create_export", "export_create"],
  ["evidence_get_export", "evidence.get_export", "export_get"],
  [
    "evidence_get_export_artifact",
    "evidence.get_export_artifact",
    "export_artifact",
  ],
  [
    "evidence_get_export_manifest",
    "evidence.get_export_manifest",
    "export_manifest",
  ],
  ["evidence_list_webhooks", "evidence.list_webhooks", "webhooks_list"],
  [
    "evidence_webhook_availability",
    "evidence.webhook_availability",
    "webhooks_availability",
  ],
  ["evidence_create_webhook", "evidence.create_webhook", "webhooks_create"],
  [
    "evidence_set_webhook_status",
    "evidence.set_webhook_status",
    "webhooks_status",
  ],
  ["evidence_webhook_health", "evidence.webhook_health", "webhooks_health"],
  ["evidence_webhook_history", "evidence.webhook_history", "webhooks_history"],
  [
    "evidence_rotate_webhook_secret",
    "evidence.rotate_webhook_secret",
    "webhooks_rotate",
  ],
  [
    "evidence_replay_webhook_delivery",
    "evidence.replay_webhook_delivery",
    "webhooks_replay",
  ],
  ["evidence_send_webhook_test", "evidence.send_webhook_test", "webhooks_test"],
] as const satisfies ReadonlyArray<
  readonly [string, string, AgentDataOperation]
>;

const TOOLS = new Map<string, AgentDataOperation>(
  TOOL_ENTRIES.flatMap(([name, legacyName, operation]) => [
    [name, operation],
    [legacyName, operation],
  ]),
);
const MCP_APP_TOOLS = new Set([
  "evidence_status",
  "evidence_sources",
  "evidence_search",
  "evidence_semantic_search",
  "evidence_universal_search",
  "evidence_verify_claim",
  "evidence_claim_timeline",
  "evidence_products",
  "evidence_datasets",
  "evidence_benchmarks",
]);
const WRITE_TOOLS = new Set([
  "evidence_verify_claim",
  "evidence_create_research",
  "evidence_create_export",
  "evidence_create_webhook",
  "evidence_set_webhook_status",
  "evidence_rotate_webhook_secret",
  "evidence_replay_webhook_delivery",
  "evidence_send_webhook_test",
]);
const OPEN_WORLD_TOOLS = new Set([
  "evidence_replay_webhook_delivery",
  "evidence_send_webhook_test",
]);
const WEBHOOK_EVENT_TYPES = [
  "evidence.document.changed",
  "evidence.research.completed",
  "evidence.export.completed",
  "evidence.benchmark.completed",
  "evidence.claim.verified",
  "evidence.usage.threshold_reached",
  "evidence.usage.budget_reached",
  "evidence.entitlement.status_changed",
] as const;
const TOOL_DEFINITIONS = TOOL_ENTRIES.map(([name, legacyName]) => {
  const definition = {
    name,
    description: toolDescription(legacyName),
    inputSchema: toolInputSchema(legacyName),
    annotations: {
      readOnlyHint: !WRITE_TOOLS.has(name),
      destructiveHint: false,
      idempotentHint: !WRITE_TOOLS.has(name),
      openWorldHint: OPEN_WORLD_TOOLS.has(name),
    },
  };
  return {
    ...definition,
    ...(MCP_APP_TOOLS.has(name)
      ? { _meta: { ui: { resourceUri: UI_RESOURCE_URI } } }
      : {}),
  };
});

const MCP_APP_RESOURCE = {
  uri: UI_RESOURCE_URI,
  name: "symbaiex-evidence-explorer",
  title: "SYMBaiEX Evidence Explorer",
  description:
    "Read-only in-agent presentation for public evidence tool results.",
  mimeType: "text/html;profile=mcp-app",
  _meta: {
    ui: {
      prefersBorder: true,
      csp: { connectDomains: [], resourceDomains: [] },
    },
  },
} as const;

const MCP_APP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data:;connect-src 'none';form-action 'none';base-uri 'none'">
<title>SYMBaiEX Evidence Explorer</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;padding:16px;background:var(--color-background-primary,Canvas);color:var(--color-text-primary,CanvasText)}
h1{font-size:1rem;margin:0 0 8px}p{font-size:.82rem;line-height:1.45;color:var(--color-text-secondary,GrayText)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;border:1px solid var(--color-border-primary,#7776);border-radius:8px;padding:12px;max-height:420px;overflow:auto}
</style></head><body><h1>SYMBaiEX Evidence Explorer</h1><p id="status">Waiting for an evidence tool result…</p><pre id="output" hidden></pre><script>
const status=document.getElementById("status"),output=document.getElementById("output");
function show(value){status.textContent="Public, scope-authorized evidence result";output.hidden=false;let text=typeof value==="string"?value:JSON.stringify(value,null,2);try{text=JSON.stringify(JSON.parse(text),null,2)}catch{}output.textContent=text.slice(0,200000)}
window.addEventListener("message",event=>{if(event.source!==window.parent)return;const message=event.data;if(message?.id===1&&message.result){window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}},"*");return}if(message?.method==="ui/notifications/tool-result"){const item=message.params?.content?.find?.(entry=>entry?.type==="text");show(message.params?.structuredContent??item?.text??message.params)}});
window.parent.postMessage({jsonrpc:"2.0",id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",clientInfo:{name:"symbaiex-evidence-explorer",version:"1.0.0"},capabilities:{}}},"*");
</script></body></html>`;

type ProtocolEra = "legacy" | "modern";
type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export async function POST(request: Request) {
  const authorization = bearer(request);
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

  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpc(request, "legacy", null, undefined, {
      code: -32600,
      message: "Invalid Request",
    });
  }

  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 202, headers: mcpHeaders(request) });
  }

  if (!Object.hasOwn(body, "id") || !isJsonRpcId(body.id)) {
    return rpc(request, protocolEraHint(request, body), null, undefined, {
      code: -32600,
      message: "Invalid Request",
    });
  }
  const id = body.id;

  if (body.method === "tools/call" && !isAllowedAgentOrigin(request)) {
    return mcpJson(request, { error: "Origin is not allowed." }, 403);
  }

  const protocol = validateProtocolRequest(request, body, id);
  if (protocol instanceof Response) return protocol;

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
      protocolVersion: negotiatedInitializeVersion(body),
      capabilities: { tools: {}, resources: {} },
      serverInfo: SERVER_INFO,
      instructions:
        "SYMBaiEX product MCP for owner-approved public evidence search, claim verification, research jobs, exports, usage, and signed webhooks. Initialize and discovery are public; tools/call requires an owner-approved evidence credential. Discover Ed25519 and enabled WorkOS Connect OAuth through /.well-known/oauth-protected-resource and /auth.md. Public documentation tools are separately available at https://www.symbaiex.com/api/docs/mcp.",
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
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Authenticated evidence tools require an owner-approved agent with evidence access. Discover the currently enabled Ed25519 and OAuth flows through /.well-known/oauth-protected-resource and /auth.md. OAuth identity scopes do not grant forum or owner permissions.",
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

  if (body.method === "resources/list") {
    return rpc(request, protocol, id, {
      ...(protocol === "modern" ? { resultType: "complete" } : {}),
      resources: [MCP_APP_RESOURCE],
      ...(protocol === "modern"
        ? { ttlMs: TOOL_LIST_TTL_MS, cacheScope: "public" }
        : {}),
    });
  }

  if (body.method === "resources/read") {
    const params = isRecord(body.params) ? body.params : null;
    if (params?.uri !== UI_RESOURCE_URI) {
      return rpc(request, protocol, id, undefined, {
        code: -32602,
        message: "Unknown resource",
      });
    }
    return rpc(request, protocol, id, {
      ...(protocol === "modern" ? { resultType: "complete" } : {}),
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: MCP_APP_RESOURCE.mimeType,
          text: MCP_APP_HTML,
          _meta: MCP_APP_RESOURCE._meta,
        },
      ],
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
  if (!authorization) {
    return mcpAuthJson(
      request,
      { error: "A bearer access token is required." },
      401,
    );
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

export function GET(request: Request) {
  return mcpJson(
    request,
    {
      error: "Use POST with a JSON-RPC MCP request.",
      code: "METHOD_NOT_ALLOWED",
      resolution:
        "POST initialize and tools/list without credentials; only tools/call requires an owner-approved evidence bearer. Discover available OAuth and Ed25519 flows at /.well-known/oauth-protected-resource.",
    },
    405,
  );
}

export const HEAD = GET;

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
    if (
      headerVersion === STREAMABLE_HTTP_PROTOCOL_VERSION ||
      headerVersion === LEGACY_PROTOCOL_VERSION
    ) {
      return "legacy";
    }
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
  if (body.method === "tools/call" || body.method === "resources/read") {
    const value = body.method === "tools/call" ? params?.name : params?.uri;
    const bodyName = typeof value === "string" ? value : null;
    const headerName = decodeMcpHeaderValue(request.headers.get("mcp-name"));
    if (bodyName === null || headerName === null || headerName !== bodyName) {
      return protocolError(request, id, {
        code: -32020,
        message:
          "Header mismatch: Mcp-Name must match the requested tool or resource URI.",
      });
    }
  }
  return "modern";
}

function toolInputSchema(name: (typeof TOOL_ENTRIES)[number][1]) {
  const empty = {
    type: "object",
    additionalProperties: false,
    required: [],
    properties: {},
  };
  const limit = {
    type: "integer",
    minimum: 1,
    maximum: 50,
    default: 20,
  };
  const object = (
    properties: Record<string, unknown>,
    required: string[] = [],
  ) => ({
    type: "object",
    additionalProperties: false,
    required,
    properties,
  });
  const id = { type: "string", minLength: 1, maxLength: 128 };

  switch (name) {
    case "evidence.status":
    case "evidence.source_registry":
    case "evidence.quota":
    case "evidence.entitlements":
    case "evidence.list_webhooks":
    case "evidence.webhook_availability":
      return empty;
    case "evidence.sources":
    case "evidence.changes":
    case "evidence.products":
    case "evidence.datasets":
    case "evidence.benchmarks":
    case "evidence.usage":
      return object({ limit });
    case "evidence.search":
    case "evidence.universal_search":
      return object(
        {
          query: { type: "string", minLength: 1, maxLength: 300 },
          limit,
        },
        ["query"],
      );
    case "evidence.semantic_search":
      return object(
        {
          query: { type: "string", minLength: 1, maxLength: 300 },
          limit: { ...limit, maximum: 20, default: 10 },
          idempotencyKey: {
            type: "string",
            minLength: 8,
            maxLength: 96,
            pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
          },
        },
        ["query", "idempotencyKey"],
      );
    case "evidence.document":
      return object({ documentId: id }, ["documentId"]);
    case "evidence.verify_claim":
      return object({ claimId: id }, ["claimId"]);
    case "evidence.search_entities":
      return object(
        {
          query: { type: "string", minLength: 1, maxLength: 200 },
          limit,
        },
        ["query"],
      );
    case "evidence.version_claims":
      return object({ documentVersionId: id, limit }, ["documentVersionId"]);
    case "evidence.claim_timeline":
      return object(
        {
          claimKey: { type: "string", minLength: 1, maxLength: 200 },
          limit,
        },
        ["claimKey"],
      );
    case "evidence.create_research":
      return object(
        { query: { type: "string", minLength: 1, maxLength: 300 } },
        ["query"],
      );
    case "evidence.get_research":
    case "evidence.get_research_artifact":
    case "evidence.get_export":
    case "evidence.get_export_artifact":
    case "evidence.get_export_manifest":
      return object({ jobId: id }, ["jobId"]);
    case "evidence.create_export":
      return object(
        {
          datasetId: id,
          format: {
            type: "string",
            enum: ["jsonl", "parquet"],
            default: "jsonl",
          },
          recordLimit: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            default: 25,
          },
          selectionStrategy: {
            type: "string",
            enum: ["balanced", "recent"],
            default: "balanced",
          },
          cursor: { type: "string", minLength: 1, maxLength: 512 },
        },
        ["datasetId"],
      );
    case "evidence.create_webhook":
      return object(
        {
          subscriptionKey: { type: "string", minLength: 1, maxLength: 96 },
          url: { type: "string", format: "uri", maxLength: 2_000 },
          eventTypes: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            uniqueItems: true,
            items: { type: "string", enum: WEBHOOK_EVENT_TYPES },
          },
        },
        ["subscriptionKey", "url", "eventTypes"],
      );
    case "evidence.set_webhook_status":
      return object(
        {
          subscriptionKey: { type: "string", minLength: 1, maxLength: 96 },
          status: {
            type: "string",
            enum: ["active", "paused", "revoked"],
          },
        },
        ["subscriptionKey", "status"],
      );
    case "evidence.webhook_health":
    case "evidence.rotate_webhook_secret":
      return object(
        { subscriptionKey: { type: "string", minLength: 1, maxLength: 96 } },
        ["subscriptionKey"],
      );
    case "evidence.webhook_history":
      return object(
        {
          subscriptionKey: { type: "string", minLength: 1, maxLength: 96 },
          limit,
        },
        ["subscriptionKey"],
      );
    case "evidence.replay_webhook_delivery":
      return object(
        {
          subscriptionKey: { type: "string", minLength: 1, maxLength: 96 },
          eventKey: { type: "string", minLength: 1, maxLength: 160 },
        },
        ["subscriptionKey", "eventKey"],
      );
    case "evidence.send_webhook_test":
      return object(
        {
          subscriptionKey: { type: "string", minLength: 1, maxLength: 96 },
          eventType: { type: "string", enum: WEBHOOK_EVENT_TYPES },
        },
        ["subscriptionKey", "eventType"],
      );
  }
}

function toolDescription(name: (typeof TOOL_ENTRIES)[number][1]) {
  const descriptions: Record<(typeof TOOL_ENTRIES)[number][1], string> = {
    "evidence.status": "Read product API availability and capability status.",
    "evidence.sources": "List current active public evidence sources.",
    "evidence.source_registry":
      "Read deterministic adapter provenance, cadence, and ingestion bounds.",
    "evidence.search": "Search normalized current public evidence documents.",
    "evidence.semantic_search":
      "Search the public corpus with feature-gated semantic enhancement and lexical fallback.",
    "evidence.universal_search":
      "Search public evidence, editorial, news, newsletter, and forum records.",
    "evidence.document": "Read one public evidence document by its ID.",
    "evidence.changes": "List recent public evidence change events.",
    "evidence.verify_claim":
      "Verify one stored public claim against version-bound citations.",
    "evidence.search_entities": "Search normalized public evidence entities.",
    "evidence.version_claims":
      "List public claims cited to one evidence document version.",
    "evidence.claim_timeline":
      "Read the bounded public supersession timeline for a claim key.",
    "evidence.products": "List current evidence API product definitions.",
    "evidence.datasets":
      "List public dataset selection contracts and immutable snapshot provenance, coverage, freshness, and citation metrics.",
    "evidence.benchmarks": "List public benchmark definitions and recent runs.",
    "evidence.quota": "Read the authenticated agent's current usage quota.",
    "evidence.entitlements":
      "Read effective free-beta product access for the authenticated owner.",
    "evidence.usage": "Read bounded authenticated usage ledger summaries.",
    "evidence.create_research": "Create one bounded source-cited research job.",
    "evidence.get_research": "Read one owner-scoped research job status.",
    "evidence.get_research_artifact":
      "Resolve one authenticated first-party research artifact stream.",
    "evidence.create_export": "Create one bounded public JSONL export job.",
    "evidence.get_export": "Read one owner-scoped export job status.",
    "evidence.get_export_artifact":
      "Resolve one authenticated first-party export artifact stream.",
    "evidence.get_export_manifest":
      "Resolve the immutable buyer-readable provenance and coverage manifest for an export.",
    "evidence.list_webhooks": "List owner-scoped webhook subscriptions.",
    "evidence.webhook_availability":
      "Read whether webhook creation is currently operator-enabled.",
    "evidence.create_webhook":
      "Create an owner-scoped allowlisted signed webhook subscription.",
    "evidence.set_webhook_status":
      "Pause, resume, or revoke an owner-scoped webhook subscription.",
    "evidence.webhook_health":
      "Read bounded health for one owner-scoped webhook subscription.",
    "evidence.webhook_history":
      "List bounded recent deliveries for one webhook subscription.",
    "evidence.rotate_webhook_secret":
      "Rotate a webhook signing secret and return it once.",
    "evidence.replay_webhook_delivery":
      "Replay one stored webhook event with bounded replay protection.",
    "evidence.send_webhook_test":
      "Send one signed test event to an active webhook subscription.",
  };
  return descriptions[name];
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

function unsupportedProtocol(request: Request, id: unknown, requested: string) {
  return protocolError(request, id, {
    code: -32022,
    message: "Unsupported protocol version",
    data: {
      supported: [
        MODERN_PROTOCOL_VERSION,
        STREAMABLE_HTTP_PROTOCOL_VERSION,
        LEGACY_PROTOCOL_VERSION,
      ],
      requested,
    },
  });
}

function negotiatedInitializeVersion(body: Record<string, unknown>) {
  const params = isRecord(body.params) ? body.params : null;
  return params?.protocolVersion === STREAMABLE_HTTP_PROTOCOL_VERSION
    ? STREAMABLE_HTTP_PROTOCOL_VERSION
    : LEGACY_PROTOCOL_VERSION;
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
