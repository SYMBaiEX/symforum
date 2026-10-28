import { SYMF_TOKEN } from "@/lib/symf-token";
import {
  parseSymfStats,
  parseSymfTrades,
  type SymfMarketOverview,
} from "@/lib/symf-market-overview";

async function read(url: string, limit: number) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "SYMBaiEX-Forum-token-page",
    },
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!response.ok) throw Error("market_provider_unavailable");
  const text = await response.text();
  if (text.length > limit) throw Error("market_response_too_large");
  return JSON.parse(text) as unknown;
}

export async function GET() {
  const [stats, trades] = await Promise.allSettled([
    read(
      `https://api.dexscreener.com/token-pairs/v1/solana/${SYMF_TOKEN.mint}`,
      200_000,
    ).then(parseSymfStats),
    read(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${SYMF_TOKEN.pool}/trades?trade_volume_in_usd_greater_than=0`,
      1_000_000,
    ).then((value) => parseSymfTrades(value, Date.now())),
  ]);
  if (stats.status === "rejected" && trades.status === "rejected")
    return Response.json(
      { error: "Market data is temporarily unavailable." },
      {
        status: 503,
        headers: {
          "Cache-Control": "public, max-age=15, s-maxage=30",
          "Retry-After": "60",
        },
      },
    );
  const body: SymfMarketOverview = {
    checkedAt: Date.now(),
    stats: stats.status === "fulfilled" ? stats.value : null,
    trades: trades.status === "fulfilled" ? trades.value : null,
  };
  return Response.json(body, {
    headers: {
      "Cache-Control":
        "public, max-age=30, s-maxage=60, stale-while-revalidate=60",
    },
  });
}
