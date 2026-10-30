import { expect, test } from "vitest";
import {
  classifyMarketCap,
  isMarketCapBand,
  matchesMarketCap,
} from "./forum-market-cap";

test.each([
  [null, "unknown"],
  [undefined, "unknown"],
  [NaN, "unknown"],
  [Infinity, "unknown"],
  [-1, "unknown"],
  [0, "unknown"],
  [49_999, "under50k"],
  [50_000, "50k100k"],
  [99_999, "50k100k"],
  [100_000, "100k500k"],
  [499_999, "100k500k"],
  [500_000, "500k1m"],
  [999_999, "500k1m"],
  [1_000_000, "1m10m"],
  [10_000_000, "over10m"],
] as const)("classifies actual market cap %s into %s", (value, expected) => {
  expect(classifyMarketCap(value)).toBe(expected);
});

test("unknown values cannot meet a numeric band", () => {
  expect(matchesMarketCap(null, "50k100k")).toBe(false);
  expect(matchesMarketCap(null, "unknown")).toBe(true);
  expect(matchesMarketCap(null, "all")).toBe(true);
  expect(isMarketCapBand("50k100k")).toBe(true);
  expect(isMarketCapBand("fdv")).toBe(false);
});
