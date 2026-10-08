import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-static";

const UPDATED = "2026-08-21";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:sf="http://schema.org/schemas/schemafeed/0.1">
  <url>
    <loc>${primarySiteUrl("/feeds/schema.jsonl")}</loc>
    <lastmod>${UPDATED}</lastmod>
    <sf:contentType>structuredData/schema.org</sf:contentType>
  </url>
  <url>
    <loc>${primarySiteUrl("/feed/blog.xml")}</loc>
    <lastmod>${UPDATED}</lastmod>
    <sf:contentType>structuredData/rss</sf:contentType>
  </url>
  <url>
    <loc>${primarySiteUrl("/feed/newsletter.xml")}</loc>
    <lastmod>${UPDATED}</lastmod>
    <sf:contentType>structuredData/rss</sf:contentType>
  </url>
</urlset>
`;

export function GET() {
  return new Response(XML, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const HEAD = GET;
