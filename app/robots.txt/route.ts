import { robotsText } from "@/lib/robots-policy";

export const dynamic = "force-static";

export function GET() {
  return new Response(robotsText(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const HEAD = GET;
