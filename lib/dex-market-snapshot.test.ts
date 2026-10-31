import { expect, test } from "vitest";
import { readChartData } from "../components/trading/price-chart-data";
import { SYMF_TOKEN } from "./symf-token";
import { CHART_CACHE_FRESH_MS } from "./chart-cache-policy";

test("chart parsing keeps independently dated source stats and legacy provenance without accepting invalid times", () => {
  const checkedAt = Date.parse("2026-10-31T18:00:02Z"),
    marketCheckedAt = checkedAt - 2000;
  const body = {
    mint: SYMF_TOKEN.mint,
    pool: SYMF_TOKEN.pool,
    interval: "1m",
    checkedAt,
    marketCheckedAt,
    stats: { marketCap: null, fdv: 100, liquidity: 10, volume24h: 0 },
    candles: [
      {
        time: Math.floor(checkedAt / 1000) - 60,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 0,
      },
    ],
  };
  expect(readChartData(body, SYMF_TOKEN.mint, "1m", checkedAt)).toMatchObject({
    checkedAt,
    marketCheckedAt,
    stats: { marketCap: null, volume24h: 0 },
  });
  for (const bad of [
    checkedAt + 1,
    checkedAt - CHART_CACHE_FRESH_MS,
    0,
    -1,
    NaN,
  ])
    expect(() =>
      readChartData(
        { ...body, marketCheckedAt: bad },
        SYMF_TOKEN.mint,
        "1m",
        checkedAt,
      ),
    ).toThrow();
  const { marketCheckedAt: ignored, ...legacy } = body;
  void ignored;
  expect(
    readChartData(legacy, SYMF_TOKEN.mint, "1m", checkedAt),
  ).not.toHaveProperty("marketCheckedAt");
});
