const FIXTURES = [
  {
    id: "sandbox-document-cisa-kev",
    type: "document",
    title: "Synthetic CISA KEV evidence document",
    excerpt:
      "Deterministic fixture for SDK parsing and search integration tests.",
    canonicalUrl: "https://www.symbaiex.com/developers/sandbox#fixtures",
  },
  {
    id: "sandbox-claim-release-security",
    type: "claim",
    title: "Synthetic release security claim",
    excerpt:
      "Supported by a synthetic version-bound citation in the sandbox only.",
    canonicalUrl: "https://www.symbaiex.com/developers/sandbox#fixtures",
  },
  {
    id: "sandbox-entity-open-source",
    type: "entity",
    title: "Synthetic open-source project entity",
    excerpt:
      "Public fixture with no connection to production data or identities.",
    canonicalUrl: "https://www.symbaiex.com/developers/sandbox#fixtures",
  },
] as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
) {
  const { segments = [] } = await context.params;
  const path = segments.join("/");
  if (path === "") {
    return sandboxJson({
      environment: "sandbox",
      version: "v1",
      syntheticOnly: true,
      writesEnabled: false,
      authenticationRequired: false,
      operations: ["GET /v1/status", "GET /v1/search?q=<query>&limit=<1-10>"],
      documentation: "https://www.symbaiex.com/developers/sandbox",
      openapi: "https://www.symbaiex.com/api/sandbox/openapi.json",
    });
  }
  if (path === "v1/status") {
    return sandboxJson({
      environment: "sandbox",
      status: "ready",
      syntheticOnly: true,
      writesEnabled: false,
      fixtureCount: FIXTURES.length,
    });
  }
  if (path === "v1/search") {
    const url = new URL(request.url);
    if (
      [...url.searchParams.keys()].some((key) => key !== "q" && key !== "limit")
    ) {
      return sandboxError(
        "INVALID_QUERY",
        "Only q and limit are supported.",
        400,
      );
    }
    const query = url.searchParams.get("q")?.trim() ?? "";
    const rawLimit = url.searchParams.get("limit") ?? "10";
    const limit = Number(rawLimit);
    if (
      query.length < 1 ||
      query.length > 200 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 10
    ) {
      return sandboxError(
        "INVALID_QUERY",
        "q must contain 1-200 characters and limit must be an integer from 1 to 10.",
        400,
      );
    }
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const matches = FIXTURES.filter((fixture) =>
      terms.some((term) =>
        `${fixture.type} ${fixture.title} ${fixture.excerpt}`
          .toLowerCase()
          .includes(term),
      ),
    ).slice(0, limit);
    return sandboxJson({
      environment: "sandbox",
      syntheticOnly: true,
      results: matches.length > 0 ? matches : FIXTURES.slice(0, 1),
    });
  }
  return sandboxError(
    "SANDBOX_ROUTE_NOT_FOUND",
    "The requested sandbox operation is not available.",
    404,
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: sandboxHeaders() });
}

function sandboxJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: sandboxHeaders() });
}

function sandboxError(code: string, message: string, status: number) {
  return sandboxJson(
    {
      error: message,
      code,
      resolution:
        "Read https://www.symbaiex.com/developers/sandbox and use only the documented synthetic read operations.",
    },
    status,
  );
}

function sandboxHeaders() {
  return {
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-SYMBaiEX-Environment": "sandbox",
  };
}
