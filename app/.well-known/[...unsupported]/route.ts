const OAUTH_DISCOVERY_PATHS = new Set([
  "oauth-authorization-server",
  "openid-configuration",
]);

export function GET(
  request: Request,
  context: { params: Promise<{ unsupported: string[] }> },
) {
  return unsupportedWellKnown(request, context);
}

export const HEAD = GET;

async function unsupportedWellKnown(
  request: Request,
  context: { params: Promise<{ unsupported: string[] }> },
) {
  const { unsupported } = await context.params;
  const requested = unsupported.join("/");
  const oauthProbe = OAUTH_DISCOVERY_PATHS.has(requested);
  const body = {
    error: oauthProbe
      ? "SYMBaiEX does not provide an OAuth authorization server."
      : "The requested well-known resource is not published.",
    code: oauthProbe ? "OAUTH_NOT_SUPPORTED" : "WELL_KNOWN_NOT_FOUND",
    resolution: oauthProbe
      ? "Use the documented owner-approved Ed25519 flow at https://www.symbaiex.com/auth.md and its first-party authentication metadata."
      : "Discover published machine resources from https://www.symbaiex.com/.well-known/ai-catalog.json.",
  };
  return new Response(
    request.method === "HEAD" ? null : `${JSON.stringify(body)}\n`,
    {
      status: 404,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "Content-Type": "application/problem+json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
