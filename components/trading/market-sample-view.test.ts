import { expect, test } from "vitest";
import type { TerminalMarket } from "@/lib/forum-terminal-model";
import { marketSampleView, marketEligibility } from "./market-sample-view";
const now = 1800000000000;
const row = (overrides: Partial<TerminalMarket> = {}) =>
  ({ metricsAsOf: now, ...overrides }) as TerminalMarket;
test("fresh overlay retains an old holder sample without promoting holder age", () => {
  const market = row({
    metricsAsOf: now - 7200000,
    marketData: { checkedAt: now, state: "available", sourceUrl: null },
  });
  expect(marketSampleView([market], now, true)).toEqual({
    rows: [market],
    fresh: 1,
    stale: 0,
    unknown: 0,
    excluded: 0,
  });
  expect(market.metricsAsOf).toBe(now - 7200000);
});
test("unavailable overlay and unknown time are excluded rather than fabricated fresh", () => {
  const rows = [
    row({
      marketData: { checkedAt: now, state: "unavailable", sourceUrl: null },
    }),
    ...[NaN, Infinity, -1, 0, now + 60001].map((metricsAsOf) =>
      row({ metricsAsOf }),
    ),
  ];
  expect(marketSampleView(rows, now, true)).toEqual({
    rows: [],
    fresh: 0,
    stale: 0,
    unknown: 6,
    excluded: 6,
  });
  expect(marketSampleView(rows, now, false).rows).toEqual(rows);
});
test("clock crossing uses the existing strict fifteen-minute market threshold", () => {
  const market = row({ metricsAsOf: now - 900000 });
  expect(marketSampleView([market], now, true).fresh).toBe(1);
  expect(marketSampleView([market], now + 1, true)).toEqual({
    rows: [],
    fresh: 0,
    stale: 1,
    unknown: 0,
    excluded: 1,
  });
});
test("the loaded array and its order remain intact with filtering disabled", () => {
  const rows = [row({ metricsAsOf: now - 900001 }), row()];
  expect(marketSampleView(rows, now, false).rows).toEqual(rows);
  expect(rows).toHaveLength(2);
});
test("eligibility uses only a safe returned epoch and does not reject valid past deadlines", () => {
  expect(marketEligibility(now)).toBe("2027-01-15T08:00:00.000Z");
  expect(marketEligibility(1)).toBe("1970-01-01T00:00:00.001Z");
  for (const value of [
    undefined,
    null,
    "1800000000000",
    NaN,
    Infinity,
    -1,
    0,
    now + 0.5,
    8_640_000_000_000_001,
  ])
    expect(marketEligibility(value)).toBeNull();
});
