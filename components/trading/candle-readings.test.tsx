import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { SymfCandle } from "@/lib/symf-market-data";
import { CandleReadings } from "./candle-readings";
import {
  candleReadings,
  candleReadingTime,
  sourceVolumeLabel,
} from "./candle-readings-model";
import { readChartData } from "./price-chart-data";

const first = Date.parse("2020-12-31T23:45:00Z") / 1000;
const candle = (time = first, volume = 0): SymfCandle => ({
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume,
});
const render = (candles: SymfCandle[]) =>
  renderToStaticMarkup(
    <CandleReadings
      candles={candles}
      compact
      formatPrice={(value) => `$${value}`}
    />,
  );

test("volume is a source number without an invented currency or token unit", () => {
  expect(sourceVolumeLabel(0)).toBe("0");
  expect(sourceVolumeLabel(1234567.125)).toBe("1,234,567.125");
  for (const value of [undefined, null, NaN, Infinity, -1])
    expect(sourceVolumeLabel(value)).toBe("Unavailable");
  expect(sourceVolumeLabel(Number.MAX_VALUE)).not.toMatch(/\$|USD|Infinity/);
});

test("historical candle times retain their full year, seconds and UTC semantic value", () => {
  expect(candleReadingTime(first)).toEqual({
    iso: "2020-12-31T23:45:00.000Z",
    label: "2020-12-31 23:45:00 UTC",
    compact: "2020-12-31 23:45",
  });
  const html = render([candle()]);
  expect(html).toContain('dateTime="2020-12-31T23:45:00.000Z"');
  expect(html).toContain("2020-12-31 23:45:00 UTC");
  expect(html).toContain("Bar time");
});

test("invalid times do not throw or fabricate a current date", () => {
  for (const value of [
    undefined,
    0,
    -1,
    1.5,
    Infinity,
    Number.MAX_SAFE_INTEGER,
  ])
    expect(candleReadingTime(value)).toBeNull();
});

test("sparse count and range describe actual returned bars without filling gaps", () => {
  const rows = [candle(), candle(first + 2 * 86_400, 15)];
  const result = candleReadings(rows);
  expect(result.count).toBe(2);
  expect(result.rows).toEqual([rows[1], rows[0]]);
  expect(result.first?.iso).toBe("2020-12-31T23:45:00.000Z");
  expect(result.last?.iso).toBe("2021-01-02T23:45:00.000Z");
  expect(render(rows)).toContain("Returned bars may be sparse");
  expect(rows.map((row) => row.time)).toEqual([first, first + 2 * 86_400]);
});

test("readings stay at the existing twenty-row display limit without changing the loaded range", () => {
  const rows = Array.from({ length: 35 }, (_, index) =>
    candle(first + index * 900, index),
  );
  const result = candleReadings(rows);
  expect(result.count).toBe(35);
  expect(result.rows).toHaveLength(20);
  expect(result.rows[0]).toEqual(rows[34]);
  expect(result.rows.at(-1)).toEqual(rows[15]);
  expect(result.first?.iso).toBe(new Date(first * 1000).toISOString());
  expect(render(rows)).toContain("showing latest 20");
});

test("table caption identifies USD prices and explicitly unknown source-volume units", () => {
  const html = render([candle()]);
  expect(html).toContain("Source volume unit unknown");
  expect(html).toContain('scope="col">Source volume</th>');
  expect(html).toContain('class="whitespace-nowrap px-2">0</td>');
  expect(html).toContain("Checked time dates the source check, not each bar");
});

test("defensive missing-volume readings never weaken the public chart validator", () => {
  const missing = { ...candle(), volume: undefined } as unknown as SymfCandle;
  expect(render([missing])).toContain("Unavailable");
  const now = Date.parse("2021-01-01T00:00:00Z");
  expect(() =>
    readChartData(
      {
        mint: "fixture-mint",
        pool: "11111111111111111111111111111111",
        interval: "15m",
        checkedAt: now,
        candles: [missing],
      },
      "fixture-mint",
      "15m",
      now,
    ),
  ).toThrow();
});

test("empty local readings report zero without inventing a range", () => {
  expect(candleReadings([])).toEqual({
    count: 0,
    first: null,
    last: null,
    rows: [],
  });
  expect(render([])).toContain("Loaded 0 bars");
  expect(render([])).not.toContain("Range");
});
