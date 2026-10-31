import { z } from "zod";
import type { SymfChartData, SymfChartInterval } from "@/lib/symf-market-data";
import {
  CHART_CACHE_FRESH_MS,
  CHART_CACHE_RETENTION_MS,
  marketProviderRetryAt,
  type MarketCacheView,
  type MarketCandleProvider,
} from "@/lib/chart-cache-policy";

export type ChartCacheState = MarketCacheView["state"];
export type CheckedChartData = SymfChartData & {
  stale?: boolean;
  priceUsd?: ChartMarketData["priceUsd"];
  stats?: ChartMarketData["stats"];
  candleSource?: MarketCandleProvider;
};

/** Legacy retained charts came only from Gecko; never render arbitrary labels. */
export function chartSourceLabel(data: CheckedChartData) {
  return data.candleSource === "solana-tracker"
    ? "Solana Tracker"
    : "GeckoTerminal";
}

/** A recent fetch must never imply that an old observed bar is a recent trade. */
export function chartHistoryLabel(data: CheckedChartData, now: number) {
  const last = data.candles.at(-1);
  const duration =
    parseInt(data.interval, 10) *
    (data.interval.endsWith("h") ? 3_600_000 : 60_000);
  if (
    !last ||
    !Number.isSafeInteger(last.time) ||
    !Number.isFinite(now) ||
    now - last.time * 1000 <= Math.max(15 * 60_000, 2 * duration)
  )
    return null;
  return `Historical bars · latest ${new Date(last.time * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Display retention is independent of whether another network attempt is due. */
export function retainedChartData(
  data: CheckedChartData,
  now: number,
  forceStale = false,
): CheckedChartData | null {
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(data.checkedAt) ||
    data.checkedAt <= 0 ||
    data.checkedAt > now + 60_000 ||
    now - data.checkedAt >= CHART_CACHE_RETENTION_MS
  )
    return null;
  return {
    ...data,
    stale: Boolean(
      data.stale || forceStale || now - data.checkedAt >= CHART_CACHE_FRESH_MS,
    ),
  };
}

export function chartResponsePolicy(
  value: unknown,
  response: { ok: boolean; status: number; headers: Pick<Headers, "get"> },
  now: number,
): { state: ChartCacheState; nextRetryAt: number | null } {
  const body =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const known = [
    "ready",
    "loading",
    "deferred",
    "unavailable",
    "budget",
    "unsupported",
  ] as const;
  const state =
    known.find((candidate) => candidate === body.state) ??
    known.find(
      (candidate) => candidate === response.headers.get("X-Market-State"),
    ) ??
    (response.ok
      ? "ready"
      : response.status === 429
        ? "budget"
        : response.status === 400 || response.status === 404
          ? "unsupported"
          : "unavailable");
  if (state === "unsupported") return { state, nextRetryAt: null };
  const cache =
    body.cache && typeof body.cache === "object"
      ? (body.cache as Record<string, unknown>)
      : {};
  const headerAt = marketProviderRetryAt(
    response.headers.get("Retry-After"),
    now,
  );
  const deadlines = [cache.nextRetryAt, headerAt].filter(
    (candidate): candidate is number =>
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate > now,
  );
  // Bound browser timers, never infer a new provider path from an error response.
  const legacyFreshUntil =
    response.ok &&
    state === "ready" &&
    typeof body.checkedAt === "number" &&
    Number.isFinite(body.checkedAt) &&
    body.checkedAt <= now + 60_000 &&
    body.checkedAt + CHART_CACHE_FRESH_MS > now
      ? body.checkedAt + CHART_CACHE_FRESH_MS
      : now + 60_000;
  const nextRetryAt = deadlines.length
    ? Math.max(...deadlines)
    : legacyFreshUntil;
  return {
    state,
    nextRetryAt: Math.min(now + 86_400_000, Math.max(now + 1000, nextRetryAt)),
  };
}

export function chartStateMessage(
  state: ChartCacheState | null,
  retained: boolean,
  offline = false,
) {
  const message = offline
    ? "Offline; chart refresh is paused."
    : state === "budget"
      ? "Free-data allowance reached."
      : state === "unsupported"
        ? "No chart is supported for this indexed token."
        : state === "deferred"
          ? "Waiting for shared data window."
          : state === "loading"
            ? "Shared chart refresh is in progress."
            : state === "unavailable"
              ? "Chart source is temporarily unavailable."
              : "Cached chart is stale.";
  return retained ? `${message} Showing last checked data.` : message;
}

export type ChartMarketData = {
  mint: string;
  checkedAt: number;
  stale: boolean;
  priceUsd: number | null;
  stats: {
    marketCap: number | null;
    fdv: number | null;
    liquidity: number | null;
    volume24h: number | null;
  } | null;
};

const positive = z.number().finite().positive();
const chartShape = z.object({
  mint: z.string(),
  pool: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  interval: z.enum(["1m", "5m", "15m", "1h", "4h"]),
  checkedAt: positive,
  stale: z.boolean().optional(),
  candleSource: z.enum(["geckoterminal", "solana-tracker"]).optional(),
  priceUsd: z.number().finite().nonnegative().nullable().optional(),
  stats: z
    .object({
      marketCap: z.number().finite().nonnegative().nullable(),
      fdv: z.number().finite().nonnegative().nullable(),
      liquidity: z.number().finite().nonnegative().nullable(),
      volume24h: z.number().finite().nonnegative().nullable(),
    })
    .nullable()
    .optional(),
  candles: z
    .array(
      z.object({
        time: positive.int(),
        open: positive,
        high: positive,
        low: positive,
        close: positive,
        volume: z.number().finite().nonnegative(),
      }),
    )
    .min(1)
    .max(200),
});

/** Reject wrong-token responses and malformed candles before charting. */
export function readChartData(
  value: unknown,
  mint: string,
  interval: SymfChartInterval,
  now: number,
): CheckedChartData {
  const parsed = chartShape.parse(value);
  if (
    parsed.mint !== mint ||
    parsed.interval !== interval ||
    parsed.checkedAt > now + 60_000
  )
    throw new Error("chart_identity");
  let previous = 0;
  for (const candle of parsed.candles) {
    if (
      candle.time <= previous ||
      candle.time * 1000 > now + 60_000 ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.low > candle.high
    )
      throw new Error("chart_candle");
    previous = candle.time;
  }
  const retained = retainedChartData(parsed, now);
  if (!retained) throw new Error("chart_retention");
  return retained;
}
