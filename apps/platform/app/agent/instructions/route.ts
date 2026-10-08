import { AGENT_INSTRUCTIONS_MARKDOWN } from "@/lib/agent-instructions";

export const dynamic = "force-static";

export function GET() {
  return new Response(AGENT_INSTRUCTIONS_MARKDOWN, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, follow",
      Link: '<https://www.symbaiex.com/agent>; rel="canonical"; type="text/html"',
    },
  });
}
