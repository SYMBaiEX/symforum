
import { PRIMARY_SITE_URL } from "./site-urls";
const MARKDOWN_NOT_FOUND = "# Not found\n\nThe requested public page does not exist or has no public Markdown representation.\n\n- [Site index](" + PRIMARY_SITE_URL + "/llms.txt)\n- [Developer guide](" + PRIMARY_SITE_URL + "/developers)\n- [Agent API manifest](" + PRIMARY_SITE_URL + "/api/agent)\n- [XML sitemap](" + PRIMARY_SITE_URL + "/sitemap.xml)\n";

export function markdownNotFound(request: Pick<Request, "method">) {
  return new Response(request.method === "HEAD" ? null : MARKDOWN_NOT_FOUND, {
    status: 404,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, s-maxage=300",
      Vary: "Accept, Host",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
