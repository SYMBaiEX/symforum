import asyncApiDocument from "@/contracts/asyncapi/agent-events.json";

export const dynamic = "force-static";

export function GET() {
  return new Response(`${JSON.stringify(asyncApiDocument, null, 2)}\n`, {
    headers: contractHeaders(),
  });
}

export function HEAD() {
  return new Response(null, { headers: contractHeaders() });
}

function contractHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=3600",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  };
}
