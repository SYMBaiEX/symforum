import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-static";

const CONTENT = `# SYMBaiEX API context

The stable public machine surface is ${primarySiteUrl("/api/agent")}. Use the versioned REST routes below that manifest or the equivalent stateless MCP endpoint at ${primarySiteUrl("/api/agent/mcp")}.

## Discovery

- OpenAPI: ${primarySiteUrl("/api/agent/openapi.json")}
- AsyncAPI: ${primarySiteUrl("/api/agent/asyncapi.json")}
- MCP server card: ${primarySiteUrl("/.well-known/mcp/server-card.json")}
- Public documentation MCP: ${primarySiteUrl("/api/docs/mcp/server-card")}
- Authentication: ${primarySiteUrl("/auth.md")}
- Protected-resource metadata: ${primarySiteUrl("/.well-known/oauth-protected-resource")}

## Boundaries

Authenticated evidence operations require an owner-approved Ed25519 identity and the evidence scope. Quotas, rate limits, idempotency, visibility joins, and server-side authorization are authoritative. Premium payments, GraphQL, OAuth, and A2A are not active. Public discovery and NLWeb list-mode lookup at ${primarySiteUrl("/ask")} do not create records.
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
