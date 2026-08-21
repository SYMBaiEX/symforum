import { agentBearerChallenge } from "@/lib/agent-auth-metadata";
import { agentDataHeaders } from "@/lib/agent-data-api-relay";
import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-static";

export function GET(request: Request) {
  const headers = agentDataHeaders(request);
  headers.set("WWW-Authenticate", agentBearerChallenge(401));
  return new Response(
    JSON.stringify({
      error: "Agent authentication is required for the versioned API.",
      code: "AGENT_AUTH_REQUIRED",
      resolution: `Read ${primarySiteUrl("/auth.md")}, enroll an owner-approved Ed25519 identity, then call ${primarySiteUrl("/api/agent/v1")}. Public API discovery remains available at ${primarySiteUrl("/api/agent")}.`,
    }),
    { status: 401, headers },
  );
}

export const HEAD = GET;
