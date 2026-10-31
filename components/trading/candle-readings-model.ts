import type { SymfCandle } from "@/lib/symf-market-data";

const volumeFormat = new Intl.NumberFormat("en-US", {
  maximumSignificantDigits: 21,
});

/** The public candle contract carries a number, not a proven volume unit. */
export function sourceVolumeLabel(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? volumeFormat.format(value)
    : "Unavailable";
}

export function candleReadingTime(seconds: number | undefined) {
  if (!Number.isSafeInteger(seconds) || seconds == null || seconds <= 0)
    return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const iso = date.toISOString();
  return {
    iso,
    label: `${iso.slice(0, 19).replace("T", " ")} UTC`,
    compact: iso.slice(0, 16).replace("T", " "),
  };
}

/** Describe only returned bars; neither missing intervals nor totals are filled. */
export function candleReadings(candles: readonly SymfCandle[]) {
  return {
    count: candles.length,
    first: candleReadingTime(candles[0]?.time),
    last: candleReadingTime(candles.at(-1)?.time),
    rows: candles.slice(-20).reverse(),
  };
}
