import {
  AGENT_AUTHENTICATION_METADATA_URL,
  AGENT_MCP_RESOURCE,
  AGENT_REQUIRED_SCOPE,
} from "@/lib/agent-auth-metadata";
import { primarySiteUrl } from "@/lib/site-urls";
import { workosConfig } from "@/lib/workos-config";
import { serviceAuthRelay } from "@/lib/agent-service-auth-relay";
import {
  serviceAuthEnabled,
  SERVICE_AUTH_ISSUER,
} from "@/lib/agent-service-auth-config";

export const dynamic = "force-dynamic";

const METADATA = {
  resource: AGENT_MCP_RESOURCE,
  scopes_supported: [AGENT_REQUIRED_SCOPE],
  bearer_methods_supported: ["header"],
  resource_documentation: primarySiteUrl("/agent/instructions"),
  "x-symbaiex-authentication": {
    metadata: AGENT_AUTHENTICATION_METADATA_URL,
    scheme: "ed25519_challenge_response",
    oauth2: false,
    note: "First-party machine authentication. Its agent scopes are separate from OAuth identity scopes.",
  },
} as const;

export async function GET(request: Request) {
  const config = workosConfig(process.env);
  const enabled = serviceAuthEnabled(process.env);
  const serviceAuth = enabled && (await serviceAuthRelay(request, "jwks")).ok;
  const metadata =
    config || serviceAuth
      ? {
          ...METADATA,
          scopes_supported: [
            ...(config ? ["openid", "offline_access"] : []),
            ...(serviceAuth ? ["evidence"] : []),
          ],
          authorization_servers: [
            // Match /auth.md's recommended owner-approved service_auth flow first.
            ...(serviceAuth ? [SERVICE_AUTH_ISSUER] : []),
            // WorkOS Connect remains an advertised alternative issuer.
            ...(config ? [config.issuer] : []),
          ],
        }
      : METADATA;
  return metadataResponse(`${JSON.stringify(metadata, null, 2)}\n`, enabled);
}

export async function HEAD(request: Request) {
  const response = await GET(request);
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}

function metadataResponse(body: string | null, probeEnabled = false) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": probeEnabled
        ? "no-store"
        : "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
