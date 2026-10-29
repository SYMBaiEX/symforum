
import { PRIMARY_SITE_URL } from "./site-urls";
/** An additive issuer; never changes or impersonates the WorkOS issuer. */
export const SERVICE_AUTH_ISSUER = PRIMARY_SITE_URL + "/agent-auth";
export const SERVICE_AUTH_RESOURCE = PRIMARY_SITE_URL + "/api/agent/mcp";
export const SERVICE_AUTH_METADATA =
  PRIMARY_SITE_URL + "/.well-known/oauth-authorization-server/agent-auth";
export const SERVICE_AUTH_CLAIM = "urn:workos:agent-auth:grant-type:claim";
export const SERVICE_AUTH_JWT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
export const SERVICE_AUTH_TOKEN_KIND = "urn:symbaiex:service-auth:token-kind";
export const SERVICE_AUTH_TOKEN_ID = "urn:symbaiex:service-auth:token-id";
export const SERVICE_AUTH_MAX_BODY = 16 * 1024;

export function isServiceAuthSensitiveLocation(pathname: string, search = "") {
  return (
    pathname === "/agent/claim" ||
    pathname.startsWith("/agent-auth/") ||
    (pathname === "/signin" &&
      new URLSearchParams(search)
        .get("redirectTo")
        ?.startsWith("/agent/claim") === true)
  );
}

export function serviceAuthEnabled(environment: {
  [key: string]: string | undefined;
  AGENT_SERVICE_AUTH_ENABLED?: string;
}) {
  return environment.AGENT_SERVICE_AUTH_ENABLED === "true";
}

export function serviceAuthMetadata() {
  return {
    issuer: SERVICE_AUTH_ISSUER,
    resource: SERVICE_AUTH_RESOURCE,
    token_endpoint: `${SERVICE_AUTH_ISSUER}/token`,
    revocation_endpoint: `${SERVICE_AUTH_ISSUER}/revoke`,
    jwks_uri: `${SERVICE_AUTH_ISSUER}/jwks`,
    grant_types_supported: [SERVICE_AUTH_JWT, SERVICE_AUTH_CLAIM],
    response_types_supported: [],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["evidence"],
    agent_auth: {
      skill: PRIMARY_SITE_URL + "/auth.md",
      identity_endpoint: `${SERVICE_AUTH_ISSUER}/identity`,
      claim_endpoint: `${SERVICE_AUTH_ISSUER}/identity/claim`,
      identity_types_supported: ["service_auth"],
      events_supported: [],
    },
  };
}

export function normalizeServiceAuthEmail(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 254) return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.endsWith(".local")
    ? email
    : null;
}

export async function readServiceAuthBody(request: Pick<Request, "body">) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > SERVICE_AUTH_MAX_BODY) throw new Error("Body too large");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function serviceAuthResponse(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
