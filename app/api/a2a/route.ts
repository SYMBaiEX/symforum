import { randomUUID } from "node:crypto";

import { answerA2aDocsQuery } from "@/lib/a2a-docs-agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return rpc(null, undefined, rpcError(-32600, "Request body is too large"), 413);
  }
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return rpc(null, undefined, rpcError(-32600, "Content-Type must be application/json"), 415);
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    return rpc(null, undefined, rpcError(-32600, "Request body is too large"), 413);
  }

  let body: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!isRecord(value)) throw new Error();
    body = value;
  } catch {
    return rpc(null, undefined, rpcError(-32700, "Parse error"), 400);
  }

  if (body.jsonrpc !== "2.0" || !isJsonRpcId(body.id)) {
    return rpc(null, undefined, rpcError(-32600, "Invalid Request"), 400);
  }
  if (body.method !== "SendMessage" && body.method !== "message/send") {
    return rpc(body.id, undefined, rpcError(-32601, "Method not found"), 404);
  }

  const query = messageText(body.params);
  if (query === null) {
    return rpc(
      body.id,
      undefined,
      rpcError(-32602, "A bounded text message is required"),
      400,
    );
  }

  const params = isRecord(body.params) ? body.params : {};
  const inputMessage = isRecord(params.message) ? params.message : {};
  const contextId =
    typeof inputMessage.contextId === "string" &&
    inputMessage.contextId.length <= 128
      ? inputMessage.contextId
      : randomUUID();
  return rpc(body.id, {
    messageId: randomUUID(),
    contextId,
    role: "ROLE_AGENT",
    parts: [{ text: answerA2aDocsQuery(query) }],
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: responseHeaders() });
}

function unsupportedMethod() {
  return Response.json(
    {
      error: "Use POST with an A2A JSON-RPC SendMessage request.",
      code: "METHOD_NOT_ALLOWED",
      resolution:
        "Read /.well-known/agent-card.json and send a bounded text message to /api/a2a.",
    },
    { status: 405, headers: responseHeaders() },
  );
}

export const GET = unsupportedMethod;
export const HEAD = unsupportedMethod;

function messageText(params: unknown) {
  if (!isRecord(params) || !isRecord(params.message)) return null;
  const parts = params.message.parts;
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 8) return null;
  const text = parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
  return text.length >= 1 && text.length <= 200 ? text : null;
}

function rpc(
  id: string | number | null,
  result?: unknown,
  error?: { code: number; message: string },
  status = 200,
) {
  return Response.json(
    { jsonrpc: "2.0", id, ...(error ? { error } : { result }) },
    { status, headers: responseHeaders() },
  );
}

function rpcError(code: number, message: string) {
  return { code, message };
}

function responseHeaders() {
  return {
    "Access-Control-Allow-Headers": "content-type, a2a-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
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
