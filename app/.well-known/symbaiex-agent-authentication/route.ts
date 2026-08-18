import {
  AGENT_MCP_RESOURCE,
  AGENT_REQUIRED_SCOPE,
} from "@/lib/agent-auth-metadata";
import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-static";

const API_BASE_URL = primarySiteUrl("/api/agent");
const METADATA = {
  protocol: "symbaiex_ed25519_challenge_v1",
  protocol_type: "custom",
  oauth2: {
    supported: false,
    authorization_endpoint: null,
    token_endpoint: null,
    registration_endpoint: null,
  },
  protected_resource: AGENT_MCP_RESOURCE,
  required_scope: AGENT_REQUIRED_SCOPE,
  signed_challenge_audience: AGENT_MCP_RESOURCE,
  audience_binding: {
    signed_challenge: true,
    access_token_aud_claim: false,
    enforcement:
      "Each protected request revalidates the active agent identity and evidence scope.",
  },
  endpoints: {
    challenge: `${API_BASE_URL}/auth/challenge`,
    sign_in: `${API_BASE_URL}/auth/sign-in`,
    refresh: `${API_BASE_URL}/auth/refresh`,
    owner_enrollment: primarySiteUrl("/agent/signup"),
  },
  key_algorithm: "Ed25519",
  access_token_transport: "authorization_header_bearer",
  private_key_handling: "client_local_only",
  documentation: primarySiteUrl("/agent/instructions"),
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
