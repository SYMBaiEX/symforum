import { agentAuthGuide } from "@/lib/agent-auth-guide";
import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-dynamic";

function headers() {
  return {
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "public, max-age=60, s-maxage=300",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    Link: `<${primarySiteUrl("/auth.md")}>; rel="canonical"; type="text/markdown"`,
  };
}

export function GET() {
  return new Response(agentAuthGuide(), { headers: headers() });
}

export function HEAD() {
  return new Response(null, { headers: headers() });
}
