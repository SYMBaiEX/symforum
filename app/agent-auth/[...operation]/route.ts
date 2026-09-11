import { serviceAuthRelay } from "@/lib/agent-service-auth-relay";
import {
  serviceAuthResponse,
  serviceAuthEnabled,
  serviceAuthMetadata,
} from "@/lib/agent-service-auth-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ operation: string[] }> };

export async function GET(request: Request, context: Context) {
  const path = (await context.params).operation.join("/");
  if (path === "jwks") return serviceAuthRelay(request, "jwks");
  if (path === ".well-known/oauth-authorization-server") {
    const ready = await serviceAuthRelay(request, "jwks");
    return ready.ok ? serviceAuthResponse(serviceAuthMetadata()) : ready;
  }
  return serviceAuthResponse({ error: "not_found" }, 404);
}

export async function POST(request: Request, context: Context) {
  const path = (await context.params).operation.join("/");
  const operation = path === "identity/claim" ? "claim" : path;
  if (
    operation !== "identity" &&
    operation !== "claim" &&
    operation !== "token" &&
    operation !== "revoke"
  )
    return serviceAuthResponse({ error: "not_found" }, 404);
  return serviceAuthRelay(request, operation);
}

export async function HEAD(request: Request, context: Context) {
  const response = await GET(request, context);
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}

export function OPTIONS() {
  if (!serviceAuthEnabled(process.env))
    return serviceAuthResponse({ error: "not_found" }, 404);
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    },
  });
}
