import {
  AGENT_AUTHENTICATION_METADATA_URL,
  AGENT_MCP_RESOURCE,
  AGENT_REQUIRED_SCOPE,
} from "@/lib/agent-auth-metadata";
import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-static";

const METADATA = {
  resource: AGENT_MCP_RESOURCE,
  scopes_supported: [AGENT_REQUIRED_SCOPE],
  bearer_methods_supported: ["header"],
  resource_documentation: primarySiteUrl("/agent/instructions"),
  "x-symbaiex-authentication": {
    metadata: AGENT_AUTHENTICATION_METADATA_URL,
    scheme: "ed25519_challenge_response",
    oauth2: false,
    note: "Custom first-party machine authentication; no OAuth authorization server is advertised.",
  },
} as const;

export function GET() {
  return metadataResponse(`${JSON.stringify(METADATA, null, 2)}\n`);
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
