import { z } from "zod";
import { SYMF_TOKEN } from "./symf-token";
import { PublicMarketSourceError } from "./chart-cache-policy";

export const SYMF_CHART_INTERVALS = {
  "1m": { timeframe: "minute", aggregate: "1" },
  "5m": { timeframe: "minute", aggregate: "5" },
  "15m": { timeframe: "minute", aggregate: "15" },
  "1h": { timeframe: "hour", aggregate: "1" },
  "4h": { timeframe: "hour", aggregate: "4" },
} as const;
export type SymfChartInterval = keyof typeof SYMF_CHART_INTERVALS;
export type SymfCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export type SymfChartData = {
  mint: string;
  pool: string;
  interval: SymfChartInterval;
  checkedAt: number;
  candles: SymfCandle[];
};

const responseSchema = z.object({
  meta: z.object({
    base: z.object({ address: z.string() }),
    quote: z.object({
      address: z.string(),
    }),
  }),
  data: z.object({
    attributes: z.object({
      ohlcv_list: z.array(z.array(z.unknown())).max(200),
    }),
  }),
});

export function parseMarketCandles(
  value: unknown,
  now: number,
  expected: { mint: string; quote: string },
  mode?: "explicit-mint",
): SymfCandle[] {
  const result = responseSchema.safeParse(value);
  if (!result.success)
    throw new PublicMarketSourceError("candle-schema", "invalid_candle_schema");
  const parsed = result.data;
  const base = parsed.meta.base.address,
    quote = parsed.meta.quote.address;
  if (
    !(base === expected.mint && quote === expected.quote) &&
    !(
      mode === "explicit-mint" &&
      base === expected.quote &&
      quote === expected.mint
    )
  )
    throw new PublicMarketSourceError("candle-identity", "wrong_market_token");
  const rows = parsed.data.attributes.ohlcv_list;
  if (rows.length === 0)
    throw new PublicMarketSourceError("empty-candles", "empty_market_candles");
  if (
    rows.some(
      (row) =>
        row.length !== 6 ||
        row.some((n) => typeof n !== "number" || !Number.isFinite(n)),
    )
  )
    throw new PublicMarketSourceError("candle-numeric", "invalid_market_data");
  const candles = (rows as number[][])
    .map(([time, open, high, low, close, volume]) => ({
      time,
      open,
      high,
      low,
      close,
      volume,
    }))
    .sort((a, b) => a.time - b.time);
  if (
    new Set(candles.map((c) => c.time)).size !== candles.length ||
    candles.some(
      (c) =>
        !Number.isSafeInteger(c.time) ||
        c.time <= 0 ||
        c.open <= 0 ||
        c.high <= 0 ||
        c.low <= 0 ||
        c.close <= 0 ||
        c.volume < 0 ||
        c.high < Math.max(c.open, c.close) ||
        c.low > Math.min(c.open, c.close) ||
        c.low > c.high ||
        c.time * 1000 > now + 60_000,
    )
  )
    throw new PublicMarketSourceError("candle-numeric", "invalid_market_data");
  return candles;
}

export function parseSymfCandles(value: unknown, now: number): SymfCandle[] {
  return parseMarketCandles(value, now, {
    mint: SYMF_TOKEN.mint,
    quote: "So11111111111111111111111111111111111111112",
  });
}
