
import { PRIMARY_SITE_URL } from "../../../../../lib/site-urls";
import { primarySiteUrl } from "@/lib/site-urls";

const DOCUMENTATION_ALIASES = new Map<string, string>([
  ["", "/developers"],
  ["api", "/developers/api"],
  ["openapi", "/developers/openapi"],
  ["authentication", "/developers/authentication"],
  ["mcp", "/developers/mcp"],
  ["webhooks", "/developers/webhooks"],
  ["sandbox", "/developers/sandbox"],
]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ segments?: string[] }> },
) {
  const { segments = [] } = await context.params;
  const destination = DOCUMENTATION_ALIASES.get(segments.join("/"));
  if (!destination) {
    return Response.json(
      {
        error: "The requested documentation alias is not available.",
        code: "DOCUMENTATION_ALIAS_NOT_FOUND",
        resolution:
          "Start at " + PRIMARY_SITE_URL + "/developers and follow a published canonical resource link.",
      },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Content-Type": "application/json; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
  return Response.redirect(primarySiteUrl(destination), 308);
}

export const HEAD = GET;
