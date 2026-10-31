import { PublicMarketSourceError } from "./chart-cache-policy";
import { isSolanaAddress, record } from "./forum-commerce";
import { type SymfCandle, type SymfChartInterval } from "./symf-market-data";
import { MARKET_QUOTES, readTrackerMarket } from "./terminal-market-source";

export function trackerCandleUrl(
  binding: { mint: string; pool: string; quote: string },
  interval: SymfChartInterval,
  now: number,
) {
  if (
    !isSolanaAddress(binding.mint) ||
    !isSolanaAddress(binding.pool) ||
    !MARKET_QUOTES.some((q) => q === binding.quote) ||
    !Number.isSafeInteger(now) ||
    now <= 0
  )
    throw new PublicMarketSourceError("candle-identity", "wrong_market_token");
  const seconds = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400 }[
    interval
  ];
  if (!seconds)
    throw new PublicMarketSourceError("unsupported", "invalid_candle_interval");
  return `https://data.solanatracker.io/chart/${binding.mint}/${binding.pool}?${new URLSearchParams(
    {
      type: interval,
      currency: "usd",
      marketCap: "false",
      removeOutliers: "true",
      timezone: "UTC",
    },
  )}`;
}

/** Identity echoes are optional in the documented envelope, but never ignored. */
export function parseTrackerCandles(
  value: unknown,
  now: number,
  binding: { mint: string; pool: string; quote: string },
  interval: SymfChartInterval,
  requestedRange?: { from: number; to: number },
): SymfCandle[] {
  if (
    requestedRange &&
    (!Number.isSafeInteger(requestedRange.from) ||
      !Number.isSafeInteger(requestedRange.to) ||
      requestedRange.from <= 0 ||
      requestedRange.to < requestedRange.from)
  )
    throw new PublicMarketSourceError("candle-window", "invalid_market_data");
  const data = record(value);
  for (const [key, expected] of [
    ["mint", binding.mint],
    ["token", binding.mint],
    ["pool", binding.pool],
    ["quote", binding.quote],
    ["currency", "usd"],
    ["type", interval],
    ["interval", interval],
    ["marketCap", false],
  ] as const) {
    if (Object.hasOwn(data, key) && data[key] !== expected)
      throw new PublicMarketSourceError(
        "candle-identity",
        "wrong_market_token",
      );
  }
  if (!Array.isArray(data.oclhv) || data.oclhv.length > 2000)
    throw new PublicMarketSourceError("candle-schema", "invalid_candle_schema");
  if (data.oclhv.length === 0)
    throw new PublicMarketSourceError("empty-candles", "empty_market_candles");
  const candles = data.oclhv
    .map((raw) => {
      const row = record(raw);
      if (
        !["time", "open", "high", "low", "close", "volume"].every(
          (key) => typeof row[key] === "number" && Number.isFinite(row[key]),
        )
      )
        throw new PublicMarketSourceError(
          "candle-number",
          "invalid_market_data",
        );
      const candle = row as SymfCandle;
      if (!Number.isSafeInteger(candle.time) || candle.time <= 0)
        throw new PublicMarketSourceError("candle-time", "invalid_market_data");
      // This is a rejection classification only; milliseconds are not converted.
      if (candle.time >= 1_000_000_000_000)
        throw new PublicMarketSourceError(
          "candle-time-unit",
          "invalid_market_data",
        );
      if (
        requestedRange &&
        (candle.time < requestedRange.from || candle.time > requestedRange.to)
      )
        throw new PublicMarketSourceError(
          "candle-window",
          "invalid_market_data",
        );
      if (candle.time * 1000 > now + 60_000)
        throw new PublicMarketSourceError(
          "candle-future",
          "invalid_market_data",
        );
      if (
        candle.open <= 0 ||
        candle.close <= 0 ||
        candle.high <= 0 ||
        candle.low <= 0
      )
        throw new PublicMarketSourceError(
          "candle-price",
          "invalid_market_data",
        );
      if (candle.volume < 0)
        throw new PublicMarketSourceError(
          "candle-volume",
          "invalid_market_data",
        );
      if (
        candle.high < Math.max(candle.open, candle.close) ||
        candle.low > Math.min(candle.open, candle.close) ||
        candle.low > candle.high
      )
        throw new PublicMarketSourceError(
          "candle-range",
          "invalid_market_data",
        );
      return {
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      };
    })
    .sort((a, b) => a.time - b.time);
  if (new Set(candles.map((c) => c.time)).size !== candles.length)
    throw new PublicMarketSourceError(
      "candle-duplicate",
      "invalid_market_data",
    );
  // Validate every source row first; tail selection never hides malformed bars.
  return candles.slice(-120);
}

/** Caller must durably reserve both the shared read allowance and Tracker quota. */
export async function readTrackerCandles(
  binding: { mint: string; pool: string; quote: string },
  interval: SymfChartInterval,
  now: number,
  apiKey: string,
): Promise<SymfCandle[]> {
  const response = await readTrackerMarket(
    trackerCandleUrl(binding, interval, now),
    apiKey,
  );
  return parseTrackerCandles(response, now, binding, interval);
}
