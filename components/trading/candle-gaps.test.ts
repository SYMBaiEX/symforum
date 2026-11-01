import { expect, test } from "vitest";
import { assessCandleGaps, candleGapSummary } from "./candle-gaps";
const checkedAt = Date.parse("2026-11-01T00:00:00Z");
const first = Date.parse("2026-10-31T00:00:00Z") / 1000;
const rows = (slots: number[], step = 900) =>
  slots.map((slot) => ({ time: first + slot * step }));

for (const [interval, seconds] of Object.entries({
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
})) {
  test(`${interval}: actual UTC deltas count only slots between loaded bars`, () => {
    const candles = rows([0, 1, 4, 6], seconds);
    const unchanged = structuredClone(candles);
    expect(assessCandleGaps(candles, interval, checkedAt)).toEqual({
      state: "assessed",
      interval,
      bars: 4,
      gaps: 2,
      unrepresented: 3,
    });
    expect(candles).toEqual(unchanged);
  });
  test(`${interval}: contiguous sample does not imply provider completeness`, () => {
    expect(
      candleGapSummary(
        assessCandleGaps(rows([0, 1, 2], seconds), interval, checkedAt),
      ),
    ).toBe(
      `No skipped ${interval} UTC interval slots between these 3 loaded bars.`,
    );
  });
}
test.each([[], rows([0])].map((candles) => ({ candles })))(
  "too few loaded bars yields no invented count: %j",
  ({ candles }) => {
    expect(assessCandleGaps(candles, "15m", checkedAt)).toEqual({
      state: "insufficient",
      bars: candles.length,
    });
  },
);
test.each(
  [
    rows([0, 1, 1]),
    rows([1, 0]),
    [{ time: first + 1 }, { time: first + 901 }],
    [{ time: first * 1000 }, { time: (first + 900) * 1000 }],
    [{ time: NaN }],
    [{ time: Infinity }],
    [{ time: 0 }],
    [{ time: -1 }],
    [{ time: first + 0.5 }],
    [{ time: checkedAt / 1000 + 900 }],
    Array.from({ length: 201 }, (_, slot) => ({ time: first + slot * 60 })),
  ].map((candles) => ({ candles })),
)(
  "unknown or invalid timestamp coverage is never repaired: %j",
  ({ candles }) => {
    expect(assessCandleGaps(candles, "15m", checkedAt)).toEqual({
      state: "unknown",
    });
  },
);
test.each(["", "2m", "1d", "__proto__"])(
  "unsupported interval %s stays unknown",
  (interval) => {
    expect(assessCandleGaps(rows([0, 1]), interval, checkedAt)).toEqual({
      state: "unknown",
    });
  },
);
test.each([NaN, Infinity, 0, -1, 8.64e15 + 1])(
  "unknown check timestamp %s stays unknown",
  (at) => {
    expect(assessCandleGaps(rows([0, 1]), "15m", at)).toEqual({
      state: "unknown",
    });
  },
);
test("one skipped interval uses singular copy and does not inspect volume or prices", () => {
  expect(
    candleGapSummary(assessCandleGaps(rows([0, 2]), "15m", checkedAt)),
  ).toBe(
    "1 unrepresented 15m UTC interval slot across 1 gap between 2 loaded bars.",
  );
});
test("largest accepted loaded sample remains linear and unchanged", () => {
  const candles = rows(
    Array.from({ length: 200 }, (_, i) => i),
    60,
  );
  expect(assessCandleGaps(candles, "1m", checkedAt)).toMatchObject({
    state: "assessed",
    bars: 200,
    gaps: 0,
    unrepresented: 0,
  });
  expect(candles).toHaveLength(200);
});
