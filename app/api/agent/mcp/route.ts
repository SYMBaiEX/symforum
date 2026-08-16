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

const TOOLS: Record<string, AgentDataOperation> = {
  "evidence.status": "status",
  "evidence.sources": "sources",
  "evidence.search": "search",
  "evidence.document": "document",
  "evidence.changes": "changes",
  "evidence.verify_claim": "verify",
  "evidence.search_entities": "entities",
  "evidence.version_claims": "version_claims",
  "evidence.products": "products",
  "evidence.datasets": "datasets",
  "evidence.benchmarks": "benchmarks",
  "evidence.quota": "quota",
  "evidence.entitlements": "entitlements",
  "evidence.usage": "usage",
  "evidence.create_research": "research_create",
  "evidence.get_research": "research_get",
  "evidence.get_research_artifact": "research_artifact",
  "evidence.create_export": "export_create",
  "evidence.get_export": "export_get",
  "evidence.get_export_artifact": "export_artifact",
  "evidence.list_webhooks": "webhooks_list",
  "evidence.create_webhook": "webhooks_create",
  "evidence.set_webhook_status": "webhooks_status",
};

export async function POST(request: Request) {
  if (!isAllowedAgentOrigin(request))
    return agentDataJson(request, { error: "Origin is not allowed." }, 403);
  const authorization = bearer(request);
  if (!authorization)
    return agentDataJson(
      request,
      { error: "A bearer access token is required." },
      401,
    );
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > AGENT_DATA_MAX_BODY_BYTES)
    return agentDataJson(request, { error: "Request body is too large." }, 413);
  let body: Record<string, unknown>;
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > AGENT_DATA_MAX_BODY_BYTES)
      return agentDataJson(
        request,
        { error: "Request body is too large." },
        413,
      );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return agentDataJson(request, { error: "Invalid JSON-RPC request." }, 400);
  }
  const id = body.id ?? null;
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string")
    return rpc(request, id, undefined, {
      code: -32600,
      message: "Invalid Request",
    });
  if (body.method === "initialize")
    return rpc(request, id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "symbaiex-evidence", version: "v1" },
    });
  if (body.method === "tools/list")
    return rpc(request, id, {
      tools: Object.keys(TOOLS).map((name) => ({
        name,
        description: `Read ${name.replace("evidence.", "").replaceAll("_", " ")} from the SYMBaiEX evidence API.`,
        inputSchema: { type: "object", additionalProperties: true },
      })),
    });
  if (
    body.method !== "tools/call" ||
    !body.params ||
    typeof body.params !== "object" ||
    Array.isArray(body.params)
  )
    return rpc(request, id, undefined, {
      code: -32601,
      message: "Method not found",
    });
  const params = body.params as Record<string, unknown>;
  const name = typeof params.name === "string" ? params.name : "";
  const operation = TOOLS[name];
  if (!operation)
    return rpc(request, id, undefined, {
      code: -32602,
      message: "Unknown tool",
    });
  const input =
    params.arguments &&
    typeof params.arguments === "object" &&
    !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {};
  const upstream = await relayAgentData(
    request,
    operation,
    input,
    authorization,
  );
  const result = await upstream
    .json()
    .catch(() => ({ error: "Invalid upstream response." }));
  if (!upstream.ok)
    return rpc(request, id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: true,
    });
  return rpc(request, id, {
    content: [{ type: "text", text: JSON.stringify(result) }],
  });
}
export function OPTIONS(request: Request) {
  return isAllowedAgentOrigin(request)
    ? new Response(null, { status: 204, headers: agentDataHeaders(request) })
    : agentDataJson(request, { error: "Origin is not allowed." }, 403);
}
function rpc(
  request: Request,
  id: unknown,
  result?: unknown,
  error?: { code: number; message: string },
) {
  return new Response(
    JSON.stringify(
      error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result },
    ),
    { status: error ? 400 : 200, headers: agentDataHeaders(request) },
  );
}
