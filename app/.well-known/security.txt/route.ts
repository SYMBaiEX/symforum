import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-static";

const CONTENT = `Contact: mailto:austin@symbaiex.com
Canonical: ${primarySiteUrl("/.well-known/security.txt")}
Policy: ${primarySiteUrl("/privacy")}
Preferred-Languages: en
Expires: 2027-08-21T23:59:59.000Z
`;

export function GET() {
  return new Response(CONTENT, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const HEAD = GET;
