import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const REQUEST_TIMEOUT_MS = 10_000;
const ALLOWED_ORIGINS = new Set([
  "https://symbaiex.com",
  "https://www.symbaiex.com",
  "https://forum.symbaiex.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
]);

export async function GET(request: Request) {
  if (!isAllowedOrigin(request)) {
    return agentJson({ error: "Origin is not allowed." }, 403, request);
  }
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return agentJson(
      { error: "A bearer access token is required." },
      401,
      request,
    );
  }
  const upstream = upstreamUrl();
  if (upstream === null) {
    return agentJson(
      { error: "Agent API is temporarily unavailable." },
      503,
      request,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(upstream, {
      method: "GET",
      headers: { authorization, accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      headers: responseHeaders(request, response.headers.get("content-type")),
    });
  } catch {
    return agentJson(
      { error: "Agent API is temporarily unavailable." },
      503,
      request,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function OPTIONS(request: Request) {
  if (!isAllowedOrigin(request)) {
    return agentJson({ error: "Origin is not allowed." }, 403, request);
  }
  return new Response(null, { status: 204, headers: responseHeaders(request) });
}

function upstreamUrl() {
  const configured =
    process.env.CONVEX_SITE_URL?.trim() ??
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  const cloudUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const base =
    configured || cloudUrl?.replace(/\.convex\.cloud$/i, ".convex.site");
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" && !isLocalHostname(url.hostname))
      return null;
    url.pathname = "/agent/quota";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    return ALLOWED_ORIGINS.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

function responseHeaders(request: Request, contentType?: string | null) {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (contentType) headers.set("Content-Type", contentType);
  const origin = request.headers.get("origin");
  if (origin !== null && isAllowedOrigin(request)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "authorization");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

function agentJson(payload: unknown, status: number, request: Request) {
  return NextResponse.json(payload, {
    status,
    headers: responseHeaders(request, "application/json"),
  });
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}
