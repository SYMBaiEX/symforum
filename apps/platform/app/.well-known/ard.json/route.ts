import { ARD_CATALOG } from "@/lib/ard-catalog";

export const dynamic = "force-static";

export function GET() {
  return Response.json(ARD_CATALOG, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function HEAD() {
  return new Response(null, { headers: GET().headers });
}
