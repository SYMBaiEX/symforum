import { siteStructuredData } from "@/lib/seo";

export const dynamic = "force-static";

export function GET() {
  const structured = siteStructuredData();
  const body = structured["@graph"]
    .map((entry) =>
      JSON.stringify({ "@context": structured["@context"], ...entry }),
    )
    .join("\n");
  return new Response(`${body}\n`, {
    headers: {
      "Content-Type": "application/x-jsonlines; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const HEAD = GET;
