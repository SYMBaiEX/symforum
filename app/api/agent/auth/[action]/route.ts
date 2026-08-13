import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["challenge", "sign-in", "refresh"]);
const MAX_BODY_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Public platform relay for agent authentication.
 *
 * The Convex site URL is intentionally resolved only on the server. External
 * agents use this stable SYMBaiEX URL and never need to know which backend
 * deployment serves the request.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  if (!ACTIONS.has(action)) {
    return agentJson({ error: "Unknown agent auth action." }, 404, request);
  }
  if (!isAllowedOrigin(request)) {
    return agentJson({ error: "Origin is not allowed." }, 403, request);
  }

  let body: string;
  try {
    body = await readBody(request);
    const parsed: unknown = JSON.parse(body);
    validatePayload(action, parsed);
  } catch (error) {
    return agentJson(
      {
        error:
          error instanceof Error ? error.message : "Invalid agent auth body.",
      },
      400,
      request,
    );
  }

  const upstream = agentAuthUpstream(action);
  if (upstream === null) {
    return agentJson(
      { error: "Agent authentication is temporarily unavailable." },
      503,
      request,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const responseBody = await response.arrayBuffer();
    return new Response(responseBody, {
      status: response.status,
      headers: agentHeaders(request, response.headers.get("content-type")),
    });
  } catch {
    return agentJson(
      { error: "Agent authentication is temporarily unavailable." },
      503,
      request,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function OPTIONS(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  if (!ACTIONS.has(action)) {
    return agentJson({ error: "Unknown agent auth action." }, 404, request);
  }
  if (!isAllowedOrigin(request)) {
    return agentJson({ error: "Origin is not allowed." }, 403, request);
  }
  return new Response(null, { status: 204, headers: agentHeaders(request) });
}

function agentAuthUpstream(action: string) {
  const configured =
    process.env.CONVEX_SITE_URL?.trim() ??
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  const cloudUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const base = configured || cloudUrl?.replace(/\.convex\.cloud$/i, ".convex.site");
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" && !isLocalHostname(url.hostname)) {
      return null;
    }
    url.pathname = `/agent/auth/${action}`;
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function readBody(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new Error("Request body is too large.");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new Error("Request body is too large.");
  }
  const text = new TextDecoder().decode(bytes);
  if (text.trim().length === 0) throw new Error("Request body is required.");
  return text;
}

function validatePayload(action: string, body: unknown): asserts body is Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  if (action === "challenge" && typeof record.agentId !== "string") {
    throw new Error("agentId is required.");
  }
  if (
    action === "sign-in" &&
    (typeof record.agentId !== "string" ||
      typeof record.challenge !== "string" ||
      typeof record.signature !== "string")
  ) {
    throw new Error("agentId, challenge, and signature are required.");
  }
  if (action === "refresh" && typeof record.refreshToken !== "string") {
    throw new Error("refreshToken is required.");
  }
}

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.origin === new URL(request.url).origin) return true;
    return [
      "https://symbaiex.com",
      "https://www.symbaiex.com",
      "https://forum.symbaiex.com",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
    ].includes(parsed.origin);
  } catch {
    return false;
  }
}

function agentHeaders(request: Request, contentType?: string | null) {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  });
  if (contentType) headers.set("Content-Type", contentType);
  const origin = request.headers.get("origin");
  if (origin !== null && isAllowedOrigin(request)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function agentJson(payload: unknown, status: number, request: Request) {
  const headers = agentHeaders(request, "application/json");
  return NextResponse.json(payload, { status, headers });
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}
