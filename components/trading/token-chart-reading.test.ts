import { expect, test } from "vitest";
import { tokenChartReading } from "./token-chart-reading";
import type { ChartMarketData } from "./price-chart-data";
const now = 1_800_000_000_000;
const sample: ChartMarketData = {
  mint: "A",
  checkedAt: now,
  stale: false,
  priceUsd: 0,
  stats: { marketCap: 0, liquidity: 0, volume24h: 0, fdv: 0 },
};
test.each([179999, 180001, 299999])(
  "%dms remains fresh using the server cache window",
  (age) => {
    expect(
      tokenChartReading({ ...sample, checkedAt: now - age }, "A", now, false)
        ?.stale,
    ).toBe(false);
  },
);
test.each([300000, 360000, 86399999])(
  "%dms is retained only for confirmed absent index",
  (age) => {
    const data = { ...sample, checkedAt: now - age };
    expect(tokenChartReading(data, "A", now, true)).toEqual({
      data,
      stale: true,
    });
    expect(tokenChartReading(data, "A", now, false)).toBeNull();
  },
);
test.each([86400000, 86400001, -60001, NaN, Infinity])(
  "invalid/expired age %d cannot produce readings",
  (age) => {
    expect(
      tokenChartReading({ ...sample, checkedAt: now - age }, "A", now, true),
    ).toBeNull();
  },
);
test("valid responses later in the parent's current minute remain fresh", () => {
  expect(
    tokenChartReading({ ...sample, checkedAt: now + 30_000 }, "A", now, false)
      ?.stale,
  ).toBe(false);
  expect(
    tokenChartReading({ ...sample, checkedAt: now + 60_000 }, "A", now, false)
      ?.stale,
  ).toBe(false);
});
test("explicit stale, wrong mint, invalid clocks and latest cleared fields stay authoritative", () => {
  expect(
    tokenChartReading({ ...sample, stale: true }, "A", now, true)?.stale,
  ).toBe(true);
  expect(tokenChartReading(sample, "B", now, true)).toBeNull();
  expect(tokenChartReading(sample, "A", NaN, true)).toBeNull();
  expect(
    tokenChartReading({ ...sample, checkedAt: 0 }, "A", now, true),
  ).toBeNull();
  expect(
    tokenChartReading(
      { ...sample, priceUsd: null, stats: null },
      "A",
      now,
      true,
    )?.data,
  ).toMatchObject({ priceUsd: null, stats: null });
  expect(tokenChartReading(sample, "A", now, true)?.data.priceUsd).toBe(0);
});
