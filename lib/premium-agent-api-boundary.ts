/**
 * Guardrails for the future high-volume agent API hostname.
 *
 * This module intentionally has no Convex or payment-provider dependency. The
 * dedicated host must be provisioned and explicitly enabled before a premium
 * request can reach an implementation. Keeping that decision at the outer
 * boundary prevents the public discovery/community API from accidentally
 * inheriting a paid surface.
 */
export const PREMIUM_AGENT_API_HOST = "agent-api.symbaiex.com";

export type PremiumAgentApiState =
  | "disabled"
  | "host-unconfigured"
  | "wrong-host"
  | "origin-not-allowed"
  | "ready";

export function premiumAgentApiEnabled(env = process.env) {
  return env.PREMIUM_AGENT_API_ENABLED === "true";
}

export function configuredPremiumAgentApiHost(env = process.env) {
  return env.PREMIUM_AGENT_API_HOST === PREMIUM_AGENT_API_HOST
    ? PREMIUM_AGENT_API_HOST
    : null;
}

function normalizedHeaderHost(value: string | null) {
  if (!value) return null;
  const host = value.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
    host,
  )
    ? host
    : null;
}

function requestHostname(request: Request) {
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * A request must agree on its URL hostname, Host header, and (when Vercel
 * provides it) X-Forwarded-Host. An Origin is optional for non-browser API
 * clients, but browser requests can only originate from this exact HTTPS host.
 */
export function premiumAgentApiState(
  request: Request,
  env = process.env,
): PremiumAgentApiState {
  if (!premiumAgentApiEnabled(env)) return "disabled";
  const host = configuredPremiumAgentApiHost(env);
  if (!host) return "host-unconfigured";

  const urlHost = requestHostname(request);
  const requestHost = normalizedHeaderHost(request.headers.get("host"));
  const forwardedHost = normalizedHeaderHost(
    request.headers.get("x-forwarded-host"),
  );
  if (
    urlHost !== host ||
    requestHost !== host ||
    (request.headers.has("x-forwarded-host") && forwardedHost !== host)
  )
    return "wrong-host";

  const origin = request.headers.get("origin");
  if (origin !== null && origin !== `https://${host}`)
    return "origin-not-allowed";
  return "ready";
}

export function premiumAgentApiHeaders(request: Request) {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/problem+json; charset=utf-8",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    Vary: "Origin, Host, X-Forwarded-Host",
  });
  if (premiumAgentApiState(request) === "ready") {
    const origin = request.headers.get("origin");
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, content-type, idempotency-key, mcp-protocol-version, mcp-method, mcp-name",
    );
  }
  return headers;
}

export function premiumAgentApiUnavailable(request: Request) {
  // A 404 deliberately avoids advertising a paid endpoint before the hostname,
  // entitlement checks, ledger reservation, and provider policy are live.
  return new Response(null, { status: 404, headers: premiumAgentApiHeaders(request) });
}

export function premiumPaymentRequired(
  request: Request,
  detail = "An active entitlement is required for this premium operation.",
) {
  // RFC 9457 problem details. This is intentionally not called by the disabled
  // boundary; a future implementation may use it only after it has verified an
  // authenticated principal against the canonical entitlement and usage ledger.
  return new Response(
    JSON.stringify({
      type: "https://www.symbaiex.com/docs/premium-agent-api#payment-required",
      title: "Payment Required",
      status: 402,
      detail,
    }),
    { status: 402, headers: premiumAgentApiHeaders(request) },
  );
}
