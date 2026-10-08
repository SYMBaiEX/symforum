import { MCP_SERVER_CARD } from "@/lib/agent-discovery";
import { primarySiteUrl } from "@/lib/site-urls";
export { OPTIONS, POST } from "@/app/api/agent/mcp/route";

export function GET() {
  return Response.json(MCP_SERVER_CARD, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Content-Location": primarySiteUrl("/.well-known/mcp/server-card.json"),
      "Content-Type": "application/mcp-server-card+json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const HEAD = GET;
