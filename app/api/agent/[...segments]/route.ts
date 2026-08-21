const NOT_FOUND = {
  type: "https://www.symbaiex.com/developers#errors",
  title: "Agent API route not found",
  status: 404,
  detail:
    "The requested agent API route is not published. Discover supported operations from the manifest and OpenAPI contract.",
  documentation: "https://www.symbaiex.com/api/agent",
  openapi: "https://www.symbaiex.com/api/agent/openapi.json",
} as const;

function notFound(request?: Request) {
  const isHead = request?.method === "HEAD";
  return new Response(isHead ? null : `${JSON.stringify(NOT_FOUND)}\n`, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = notFound;
export const HEAD = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
