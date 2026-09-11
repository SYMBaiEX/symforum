import { ipAddress } from "@vercel/functions";
import {
  readServiceAuthBody,
  serviceAuthEnabled,
  serviceAuthResponse,
  SERVICE_AUTH_MAX_BODY,
} from "./agent-service-auth-config";

export async function serviceAuthRelay(
  request: Request,
  operation: "identity" | "claim" | "token" | "revoke" | "jwks",
) {
  if (!serviceAuthEnabled(process.env))
    return serviceAuthResponse({ error: "not_found" }, 404);
  const secret = process.env.AGENT_SERVICE_AUTH_RELAY_SECRET;
  const configured =
    process.env.CONVEX_SITE_URL ??
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL?.replace(
      /\.convex\.cloud$/,
      ".convex.site",
    );
  if (!secret || secret.length < 32 || !configured)
    return serviceAuthResponse({ error: "temporarily_unavailable" }, 503);
  let base: URL;
  try {
    base = new URL(configured);
    if (
      base.protocol !== "https:" ||
      !base.hostname.endsWith(".convex.site") ||
      base.username ||
      base.password ||
      base.pathname !== "/" ||
      base.search ||
      base.hash
    )
      throw new Error("Invalid backend");
  } catch {
    return serviceAuthResponse({ error: "temporarily_unavailable" }, 503);
  }
  const expectedType =
    operation === "identity" || operation === "claim"
      ? "application/json"
      : "application/x-www-form-urlencoded";
  if (
    operation !== "jwks" &&
    request.headers.get("content-type")?.split(";")[0].trim() !== expectedType
  )
    return serviceAuthResponse({ error: "invalid_request" }, 400);
  let body: string;
  try {
    body = await readServiceAuthBody(request);
  } catch {
    return serviceAuthResponse({ error: "invalid_request" }, 413);
  }
  try {
    const response = await fetch(
      `${base.origin}/agent-service-auth/${operation}`,
      {
        method: operation === "jwks" ? "GET" : "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "Content-Type": expectedType,
          "x-symbaiex-service-auth-relay": secret,
          // Vercel sanitizes the platform address. Outside Vercel, share a conservative global bucket.
          "x-symbaiex-source":
            process.env.VERCEL === "1"
              ? (ipAddress(request) ?? "unknown")
              : "unknown",
        },
        ...(operation === "jwks" ? {} : { body }),
      },
    );
    const output = await readServiceAuthBody(response);
    if (output.length > SERVICE_AUTH_MAX_BODY)
      throw new Error("Response too large");
    const safe = serviceAuthResponse(null, response.status);
    safe.headers.set("Access-Control-Allow-Origin", "*");
    return new Response(output || null, {
      status: response.status,
      headers: safe.headers,
    });
  } catch {
    return serviceAuthResponse({ error: "temporarily_unavailable" }, 503);
  }
}
