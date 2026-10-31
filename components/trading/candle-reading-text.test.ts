import { expect, test } from "vitest";
import type { SymfCandle } from "@/lib/symf-market-data";
import {
  candleCheckTime,
  candleReadingText,
  type CandleEvidence,
} from "./candle-reading-text";
import { candleReadings } from "./candle-readings-model";
const evidence: CandleEvidence = {
  mint: "ExactMint",
  interval: "15m",
  checkedAt: Date.parse("2026-10-31T12:00:00Z"),
  sourceLabel: "Solana Tracker",
};
test("copy includes only displayed twenty rows and their original source context", () => {
  const candles = Array.from({ length: 35 }, (_, i) => ({
    time: 1793444400 + i * 60,
    open: i,
    high: i + 1,
    low: i,
    close: i + 0.5,
    volume: i,
  }));
  const text = candleReadingText(
    candleReadings(candles).rows,
    evidence,
    String,
  )!;
  expect(text.split("\n")).toHaveLength(26);
  expect(text).toContain("Checked: 2026-10-31 12:00:00 UTC");
  expect(text).toContain("Mint: ExactMint");
  expect(text).toContain("Source: Solana Tracker");
  expect(text).toContain("Source volume unit unknown");
  expect(text.split("\n").slice(6)[0]).toContain("\t34\t35\t34\t34.5\t34");
  expect(candles).toHaveLength(35);
});
test("zero and missing source volume remain distinct without invented units", () => {
  const row = {
    time: 1793444400,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 0,
  };
  const text = candleReadingText(
    [row, { ...row, volume: undefined } as unknown as SymfCandle],
    evidence,
    String,
  )!;
  expect(
    text
      .split("\n")
      .slice(-2)
      .map((line) => line.split("\t").at(-1)),
  ).toEqual(["0", "Unavailable"]);
});
test("invalid source time never becomes a current date", () => {
  for (const value of [0, -1, NaN, Infinity, Number.MAX_VALUE]) {
    expect(candleCheckTime(value)).toBeNull();
    expect(
      candleReadingText([], { ...evidence, checkedAt: value }, String),
    ).toBeNull();
  }
  expect(candleCheckTime(evidence.checkedAt + 123)?.label).toBe(
    "2026-10-31 12:00:00.123 UTC",
  );
});
