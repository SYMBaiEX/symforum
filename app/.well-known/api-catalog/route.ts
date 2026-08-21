import { API_CATALOG } from "@/lib/agent-discovery";

export const dynamic = "force-static";

export function GET() {
  return Response.json(API_CATALOG, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type":
        'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"; charset=utf-8',
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const HEAD = GET;
