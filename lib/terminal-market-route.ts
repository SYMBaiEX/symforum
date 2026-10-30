import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { isSolanaAddress } from "./forum-commerce";
import { SYMF_CHART_INTERVALS } from "./symf-market-data";

/** Convex owns the global cache lease and admission across every site/instance. */
export async function terminalMarketResponse(
  mint: string,
  kind: "chart" | "market",
  request: Request,
) {
  const interval = new URL(request.url).searchParams.get("interval") ?? "15m";
  if (!isSolanaAddress(mint) || !Object.hasOwn(SYMF_CHART_INTERVALS, interval))
    return Response.json(
      { error: "Unsupported token or chart interval." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) throw Error("not_configured");
    const value = await new ConvexHttpClient(convexUrl).action(
      api.forumMarketData.read,
      { mint, kind, interval },
    );
    if (value.payload) {
      const data = JSON.parse(value.payload) as Record<string, unknown>;
      if (
        data.mint !== mint ||
        (kind === "chart" && data.interval !== interval)
      )
        throw Error("wrong_market_response");
      return Response.json(
        { ...data, stale: value.stale, coverage: "public-indexed" },
        {
          headers: {
            "Cache-Control":
              "public, max-age=30, s-maxage=60, stale-while-revalidate=60",
            "X-Market-State": value.state,
          },
        },
      );
    }
    const status =
      value.state === "unsupported"
        ? 404
        : value.state === "budget"
          ? 429
          : 503;
    return Response.json(
      {
        error:
          value.state === "budget"
            ? "Free-tier market allowance reached. Cached forum coverage remains available."
            : "No current chart is available for this indexed token.",
        state: value.state,
      },
      {
        status,
        headers: {
          "Cache-Control": "public, max-age=15, s-maxage=30",
          "Retry-After": "60",
        },
      },
    );
  } catch {
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
  }
}
