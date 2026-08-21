import { DOCS_MCP_SERVER_CARD } from "@/lib/agent-discovery";

export const dynamic = "force-static";

export function GET() {
  return new Response(`${JSON.stringify(DOCS_MCP_SERVER_CARD, null, 2)}\n`, {
    headers: cardHeaders(),
  });
}

export function HEAD() {
  return new Response(null, { headers: cardHeaders() });
}

function cardHeaders() {
  return {
    "Content-Type": "application/mcp-server-card+json; charset=utf-8",
    "Cache-Control": "public, max-age=3600, s-maxage=86400",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  };
}
