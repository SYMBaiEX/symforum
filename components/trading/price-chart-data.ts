import { z } from "zod";
import type { SymfChartData, SymfChartInterval } from "@/lib/symf-market-data";

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
): SymfChartData & {
  stale?: boolean;
  priceUsd?: ChartMarketData["priceUsd"];
  stats?: ChartMarketData["stats"];
} {
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
  return parsed;
}
