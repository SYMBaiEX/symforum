import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { isSolanaAddress } from "./forum-commerce";
import { SYMF_CHART_INTERVALS } from "./symf-market-data";
import {
  CHART_CACHE_FRESH_MS,
  CHART_CACHE_RETENTION_MS,
  type MarketCacheView,
} from "./chart-cache-policy";

function responseHeaders(value: MarketCacheView, checkedAt?: number) {
  const now = Date.now();
  const remaining =
    checkedAt === undefined
      ? 0
      : Math.floor(
          Math.min(
            30_000,
            checkedAt + CHART_CACHE_FRESH_MS - now,
            checkedAt + CHART_CACHE_RETENTION_MS - now,
          ) / 1000,
        );
  const headers: Record<string, string> = {
    // The durable Convex cache coalesces origin traffic. Never let a CDN extend
    // freshness, retain old failure state or hide a newly completed refresh.
    "Cache-Control":
      remaining > 0 && !value.stale
        ? `public, max-age=${remaining}, s-maxage=${remaining}, must-revalidate`
        : "no-store",
    "X-Market-State": value.state,
  };
  if (
    value.cache.nextRetryAt !== null &&
    Number.isFinite(value.cache.nextRetryAt)
  )
    headers["Retry-After"] = String(
      Math.max(
        1,
        Math.min(86_400, Math.ceil((value.cache.nextRetryAt - now) / 1000)),
      ),
    );
  return headers;
}

/** Convex owns the global cache lease and admission across every site/instance. */
export async function terminalMarketResponse(
  mint: string,
  kind: "chart" | "market",
  request: Request,
  options: { pinnedSymf?: boolean } = {},
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
    const value = (await new ConvexHttpClient(convexUrl).action(
      api.forumMarketData.read,
      {
        mint,
        kind,
        interval,
        ...(options.pinnedSymf ? { pinnedSymf: true } : {}),
      },
    )) as MarketCacheView;
    if (value.payload) {
      const data = JSON.parse(value.payload) as Record<string, unknown>;
      if (
        data.mint !== mint ||
        (kind === "chart" && data.interval !== interval) ||
        typeof data.checkedAt !== "number" ||
        !Number.isSafeInteger(data.checkedAt) ||
        data.checkedAt <= 0 ||
        data.checkedAt > Date.now() + 60_000 ||
        Date.now() - data.checkedAt >= CHART_CACHE_RETENTION_MS
      )
        throw Error("wrong_market_response");
      const stale =
        value.stale || Date.now() - data.checkedAt >= CHART_CACHE_FRESH_MS;
      return Response.json(
        {
          ...data,
          stale,
          state: value.state,
          cache: value.cache,
          coverage: "public-indexed",
        },
        {
          headers: responseHeaders({ ...value, stale }, data.checkedAt),
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
        cache: value.cache,
      },
      {
        status,
        headers: responseHeaders(value),
      },
    );
  } catch {
    const now = Date.now();
    const value: MarketCacheView = {
      state: "unavailable",
      payload: null,
      stale: false,
      cache: {
        lastSuccessAt: null,
        lastAttemptAt: null,
        nextRetryAt: now + 60_000,
        failureCount: 0,
        failureStage: "cache",
        failureCode: "invalid-response",
      },
    };
    return Response.json(
      {
        error: "Market data is temporarily unavailable.",
        state: value.state,
        cache: value.cache,
      },
      {
        status: 503,
        headers: responseHeaders(value),
      },
    );
  }
}
