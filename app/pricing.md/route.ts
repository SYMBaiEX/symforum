import { AGENT_PRICING_GUIDE } from "@/lib/agent-pricing-guide";
import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-static";

export function GET() {
  return new Response(AGENT_PRICING_GUIDE, { headers: pricingHeaders() });
}

export function HEAD() {
  return new Response(null, { headers: pricingHeaders() });
}

function pricingHeaders() {
  return {
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "public, max-age=3600, s-maxage=86400",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    Link: `<${primarySiteUrl("/pricing")}>; rel="canonical"; type="text/html"`,
  };
}
