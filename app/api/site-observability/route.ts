import { getSitemapObservabilityReport } from "@/app/sitemap";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const configuredToken = process.env.SITE_OBSERVABILITY_TOKEN?.trim();
  const authorization = request.headers.get("authorization");
  const suppliedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : request.headers.get("x-site-observability-token")?.trim();

  // This endpoint is an operator surface, not a public discovery endpoint.
  // Fail closed when the deployment has not configured an operator token.
  if (!configuredToken || !suppliedToken || suppliedToken !== configuredToken) {
    return new NextResponse(null, {
      status: configuredToken ? 401 : 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const report = getSitemapObservabilityReport();

  return NextResponse.json(
    {
      ok: true,
      report,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
