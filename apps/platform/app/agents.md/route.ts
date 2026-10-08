import { AGENTS_MARKDOWN } from "@/lib/agent-discovery";

export const dynamic = "force-static";

export function GET() {
  return new Response(AGENTS_MARKDOWN, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const HEAD = GET;
