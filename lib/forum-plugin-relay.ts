import {
  FORUM_PLUGIN_METADATA_URL,
  FORUM_PLUGIN_RESOURCE,
} from "./forum-plugin-contract";
import { workosPluginConfig } from "./workos-config";

export const FORUM_PLUGIN_MAX_BODY_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  "https://symbaiex.com",
  "https://www.symbaiex.com",
  "https://forum.symbaiex.com",
  "https://chatgpt.com",
  "https://chat.openai.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
]);
export function isAllowedForumPluginOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin === null || ALLOWED_ORIGINS.has(origin);
}
export function forumPluginHeaders(request: Request) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, content-type, mcp-protocol-version, mcp-method, mcp-name",
    "Access-Control-Expose-Headers":
      "www-authenticate, mcp-server-name, mcp-server-version, mcp-protocol-version, retry-after",
    "Mcp-Server-Name": "symbaiex-forum",
    "Mcp-Server-Version": "1.13.0",
  });
  const origin = request.headers.get("origin");
  if (origin && isAllowedForumPluginOrigin(request))
    headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
export function forumPluginChallenge(status: 401 | 403, invalidToken = false) {
  return `Bearer resource_metadata="${FORUM_PLUGIN_METADATA_URL}", scope="openid offline_access"${status === 403 ? ', error="insufficient_scope"' : invalidToken ? ', error="invalid_token"' : ""}`;
}
export function forumPluginAuthResponse(
  request: Request,
  status: 401 | 403,
  message: string,
  invalidToken = false,
) {
  const headers = forumPluginHeaders(request);
  headers.set("WWW-Authenticate", forumPluginChallenge(status, invalidToken));
  return Response.json({ error: message }, { status, headers });
}
export function forumPluginBearer(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();
  return authorization && /^Bearer\s+\S+$/i.test(authorization)
    ? authorization
    : null;
}
/** Early audience isolation only. The Convex HTTP boundary verifies JWKS signatures, issuer, expiry, audience and the resource-bound grant. */
export function hasForumPluginAudience(authorization: string) {
  try {
    const encoded = authorization.replace(/^Bearer\s+/i, "").split(".");
    if (encoded.length !== 3) return false;
    const claims: unknown = JSON.parse(
      Buffer.from(encoded[1], "base64url").toString("utf8"),
    );
    return (
      typeof claims === "object" &&
      claims !== null &&
      !Array.isArray(claims) &&
      (claims as Record<string, unknown>).aud === FORUM_PLUGIN_RESOURCE
    );
  } catch {
    return false;
  }
}
export async function relayForumPlugin(
  request: Request,
  operation: string,
  args: Record<string, unknown>,
  authorization: string | null,
  idempotencyKey?: string,
  expectedPolicyVersion?: number,
) {
  if (authorization) {
    if (!hasForumPluginAudience(authorization))
      return forumPluginAuthResponse(
        request,
        401,
        "A forum plugin resource-bound OAuth token is required.",
        true,
      );
    try {
      if (!workosPluginConfig(process.env))
        return forumPluginAuthResponse(
          request,
          401,
          "Forum plugin OAuth is not configured.",
          true,
        );
    } catch {
      return Response.json(
        { error: "Forum plugin authentication is unavailable." },
        { status: 503 },
      );
    }
  }
  const site =
    process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!site)
    return Response.json(
      { error: "Forum backend is not configured." },
      { status: 503 },
    );
  try {
    const upstream = await fetch(`${site.replace(/\/$/, "")}/plugin/forum`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Keep plugin credentials outside Convex built-in evidence/session authentication.
        ...(authorization
          ? {
              "X-Symbaiex-Forum-OAuth": authorization.replace(
                /^Bearer\s+/i,
                "",
              ),
            }
          : {}),
      },
      body: JSON.stringify({
        operation,
        args,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(expectedPolicyVersion !== undefined
          ? { expectedPolicyVersion }
          : {}),
      }),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
      cache: "no-store",
    });
    const reader = upstream.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          return Response.json(
            { error: "Forum response is too large. Request a smaller page." },
            { status: 502 },
          );
        }
        chunks.push(value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const headers = new Headers({ "Content-Type": "application/json" });
    const retry = upstream.headers.get("retry-after");
    if (retry) headers.set("Retry-After", retry);
    return new Response(bytes, { status: upstream.status, headers });
  } catch (error) {
    const timeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return Response.json(
      {
        error: timeout
          ? "Forum request timed out. Retry with the same idempotency key."
          : "Forum service is temporarily unavailable. Retry with the same idempotency key.",
      },
      { status: timeout ? 504 : 502 },
    );
  }
}
