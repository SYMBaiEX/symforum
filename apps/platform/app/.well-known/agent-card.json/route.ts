import { A2A_DOCS_AGENT_CARD } from "@/lib/a2a-docs-agent";

export const dynamic = "force-static";

export function GET() {
  return new Response(`${JSON.stringify(A2A_DOCS_AGENT_CARD, null, 2)}\n`, {
    headers: cardHeaders(),
  });
}

export function HEAD() {
  return new Response(null, { headers: cardHeaders() });
}

function cardHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600, s-maxage=86400",
    "Content-Type": "application/json; charset=utf-8",
    ETag: '"symbaiex-docs-a2a-v1"',
    "X-Content-Type-Options": "nosniff",
  };
}
