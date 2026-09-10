import {
  AGENT_AUTHENTICATION_METADATA_URL,
  AGENT_MCP_RESOURCE,
  AGENT_REQUIRED_SCOPE,
} from "@/lib/agent-auth-metadata";
import { primarySiteUrl } from "@/lib/site-urls";
import { workosConfig } from "@/lib/workos-config";

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

export function GET() {
  const config = workosConfig(process.env);
  const metadata = config
    ? {
        ...METADATA,
        scopes_supported: ["openid", "offline_access"],
        authorization_servers: [config.issuer],
      }
    : METADATA;
  return metadataResponse(`${JSON.stringify(metadata, null, 2)}\n`);
}

export function HEAD() {
  return metadataResponse(null);
}

function metadataResponse(body: string | null) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
