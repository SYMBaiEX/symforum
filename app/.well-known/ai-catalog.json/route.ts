import { AI_CATALOG } from "@/lib/agent-discovery";

export const dynamic = "force-static";

export function GET() {
  return Response.json(AI_CATALOG, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/ai-catalog+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const HEAD = GET;
