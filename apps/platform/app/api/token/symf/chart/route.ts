import { SYMF_TOKEN } from "@/lib/symf-token";
import {
  parseSymfCandles,
  SYMF_CHART_INTERVALS,
  type SymfChartInterval,
  type SymfChartData,
} from "@/lib/symf-market-data";

export async function GET(request: Request) {
  const interval = new URL(request.url).searchParams.get("interval") ?? "15m";
  if (!Object.hasOwn(SYMF_CHART_INTERVALS, interval))
    return Response.json(
      { error: "Unsupported chart interval." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  const options = SYMF_CHART_INTERVALS[interval as SymfChartInterval];
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${SYMF_TOKEN.pool}/ohlcv/${options.timeframe}?${new URLSearchParams({ aggregate: options.aggregate, limit: "120", currency: "usd", token: "base" })}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("market_provider_unavailable");
    const body = await response.text();
    if (body.length > 150_000) throw new Error("market_response_too_large");
    const checkedAt = Date.now();
    const data: SymfChartData = {
      mint: SYMF_TOKEN.mint,
      pool: SYMF_TOKEN.pool,
      interval: interval as SymfChartInterval,
      checkedAt,
      candles: parseSymfCandles(JSON.parse(body), checkedAt),
    };
    return Response.json(data, {
      headers: {
        "Cache-Control":
          "public, max-age=30, s-maxage=60, stale-while-revalidate=60",
      },
    });
  } catch {
    return Response.json(
      { error: "Chart data is temporarily unavailable." },
      {
        status: 503,
        headers: {
          "Cache-Control": "public, max-age=15, s-maxage=30",
          "Retry-After": "60",
        },
      },
    );
  }
}
