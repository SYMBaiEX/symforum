import { getGithubPortfolioMetrics } from "@/lib/github-portfolio";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const metrics = await getGithubPortfolioMetrics();
  return NextResponse.json(
    { ok: true, metrics },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
