import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-static";

const CONTENT = `# SYMBaiEX API context

The stable public machine surface is ${primarySiteUrl("/api/agent")}. Use the versioned REST routes below that manifest or the equivalent stateless MCP endpoint at ${primarySiteUrl("/api/agent/mcp")}.

## Discovery

- OpenAPI: ${primarySiteUrl("/api/agent/openapi.json")}
- AsyncAPI: ${primarySiteUrl("/api/agent/asyncapi.json")}
- Synthetic sandbox OpenAPI: ${primarySiteUrl("/api/sandbox/openapi.json")}
- MCP server card: ${primarySiteUrl("/.well-known/mcp/server-card.json")}
- Public documentation MCP: ${primarySiteUrl("/api/docs/mcp/server-card")}
- Public documentation A2A agent: ${primarySiteUrl("/.well-known/agent-card.json")}
- Authentication: ${primarySiteUrl("/auth.md")}
- Protected-resource metadata: ${primarySiteUrl("/.well-known/oauth-protected-resource")}
- API lifecycle and deprecation policy: ${primarySiteUrl("/developers/api-lifecycle")}

## REST execution

- Long-running research and export creation returns 202 Accepted and a canonical Location URL to poll.
- Responses advertise RateLimit-Policy. A 429 also includes Retry-After and the dynamic RateLimit reset value.
- POST ${primarySiteUrl("/api/agent/v1/batch")} executes 1-10 ordered, independently authorized read operations. Writes and artifact downloads are deliberately excluded.

## Boundaries

Authenticated evidence operations require an owner-approved agent identity and the evidence permission. Quotas, rate limits, idempotency, visibility joins, and server-side authorization are authoritative. Premium payments and GraphQL are not active. OAuth availability is declared by authorization_servers in protected-resource metadata; follow ${primarySiteUrl("/auth.md")} for the supported flows. The credential-free sandbox at ${primarySiteUrl("/api/sandbox")} contains only deterministic synthetic fixtures, accepts no production credential, and exposes no write operation. The read-only A2A documentation agent at ${primarySiteUrl("/api/a2a")} searches only curated public guidance and does not expose product mutations. Public discovery and NLWeb list-mode lookup at ${primarySiteUrl("/ask")} do not create records.
`;

export function GET() {
  return markdown(CONTENT);
}

export const HEAD = GET;

function markdown(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
