import { getCachedGithubPortfolioMetrics } from "@/lib/portfolio-metrics";
import { NextResponse } from "next/server";

export const revalidate = 300;

export async function GET() {
  const metrics = await getCachedGithubPortfolioMetrics();
  return NextResponse.json(
    { ok: true, metrics },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
