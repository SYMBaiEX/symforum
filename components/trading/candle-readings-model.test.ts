import { expect, test } from "vitest";
import type { SymfCandle } from "@/lib/symf-market-data";
import {
  candleReadings,
  candleReadingAnnouncement,
} from "./candle-readings-model";
const rows = Array.from({ length: 120 }, (_, i) => ({
  time: 1609459200 + i * 900 + (i > 60 ? 86400 : 0),
  open: i + 1,
  high: i + 2,
  low: i + 0.5,
  close: i + 1.5,
  volume: i === 119 ? 0 : i + 0.125,
}));
test("local windows take latest20/50/all without mutation or filling sparse intervals", () => {
  const before = JSON.stringify(rows);
  for (const [limit, count] of [
    [20, 20],
    [50, 50],
    ["all", 120],
  ] as const) {
    const result = candleReadings(rows, limit);
    expect(result.rows).toHaveLength(count);
    expect(result.rows[0]).toBe(rows[119]);
    expect(result.rows.at(-1)).toBe(rows[120 - count]);
    expect(result.count).toBe(120);
  }
  expect(JSON.stringify(rows)).toBe(before);
  expect(candleReadings(rows).rows).toHaveLength(20);
});
test("single and empty histories remain their actual size under each local window", () => {
  for (const limit of [20, 50, "all"] as const) {
    expect(candleReadings([], limit).rows).toEqual([]);
    expect(candleReadings(rows.slice(0, 1), limit).rows).toEqual([rows[0]]);
  }
});
test("reading announcements preserve real time, exact values and unknown volume units", () => {
  expect(candleReadingAnnouncement(rows[119], 0, 20, String)).toBe(
    "Reading 1 of 20. 2021-01-03 05:45:00 UTC. Open 120. High 121. Low 119.5. Close 120.5. Source volume 0 (unit unknown).",
  );
  const missing = { ...rows[0], volume: undefined } as unknown as SymfCandle;
  expect(candleReadingAnnouncement(missing, 0, 1, String)).toContain(
    "Source volume Unavailable (unit unknown)",
  );
});
