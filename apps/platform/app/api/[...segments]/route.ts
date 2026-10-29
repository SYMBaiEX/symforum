
import { PRIMARY_SITE_URL } from "../../../../../lib/site-urls";
const API_NOT_FOUND = {
  type: PRIMARY_SITE_URL + "/developers#errors",
  title: "SYMBaiEX API route not found",
  status: 404,
  code: "API_ROUTE_NOT_FOUND",
  message: "The requested SYMBaiEX API route does not exist.",
  detail:
    "Use the public agent manifest and OpenAPI contract to discover supported API operations.",
  resolution:
    "Start at " + PRIMARY_SITE_URL + "/api/agent or read " + PRIMARY_SITE_URL + "/api/agent/openapi.json.",
  documentation: PRIMARY_SITE_URL + "/developers",
  openapi: PRIMARY_SITE_URL + "/api/agent/openapi.json",
} as const;

function notFound(request?: Request) {
  return new Response(
    request?.method === "HEAD" ? null : `${JSON.stringify(API_NOT_FOUND)}\n`,
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "application/problem+json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export const GET = notFound;
export const HEAD = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
