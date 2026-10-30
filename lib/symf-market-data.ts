import { z } from "zod";
import { SYMF_TOKEN } from "./symf-token";

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

const positive = z.number().positive();
const responseSchema = z.object({
  meta: z.object({
    base: z.object({ address: z.string() }),
    quote: z.object({
      address: z.string(),
    }),
  }),
  data: z.object({
    attributes: z.object({
      ohlcv_list: z
        .array(
          z.tuple([
            z.number().int().positive(),
            positive,
            positive,
            positive,
            positive,
            z.number().nonnegative(),
          ]),
        )
        .min(1)
        .max(200),
    }),
  }),
});

export function parseMarketCandles(
  value: unknown,
  now: number,
  expected: { mint: string; quote: string },
): SymfCandle[] {
  const parsed = responseSchema.parse(value);
  if (
    parsed.meta.base.address !== expected.mint ||
    parsed.meta.quote.address !== expected.quote
  )
    throw new Error("wrong_market_token");
  const candles = parsed.data.attributes.ohlcv_list
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
        c.high < Math.max(c.open, c.close) ||
        c.low > Math.min(c.open, c.close) ||
        c.low > c.high ||
        c.time * 1000 > now + 60_000,
    )
  )
    throw new Error("invalid_market_data");
  return candles;
}

export function parseSymfCandles(value: unknown, now: number): SymfCandle[] {
  return parseMarketCandles(value, now, {
    mint: SYMF_TOKEN.mint,
    quote: "So11111111111111111111111111111111111111112",
  });
}
