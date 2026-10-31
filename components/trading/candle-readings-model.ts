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
export type CandleReadingLimit = 20 | 50 | "all";

export function candleReadings(
  candles: readonly SymfCandle[],
  limit: CandleReadingLimit = 20,
) {
  return {
    count: candles.length,
    first: candleReadingTime(candles[0]?.time),
    last: candleReadingTime(candles.at(-1)?.time),
    rows: (limit === "all" ? candles.slice() : candles.slice(-limit)).reverse(),
  };
}

/** Read only an actual displayed bar; source check time is never its trade time. */
export function candleReadingAnnouncement(
  candle: SymfCandle,
  index: number,
  count: number,
  formatPrice: (value: number) => string,
) {
  return `Reading ${index + 1} of ${count}. ${candleReadingTime(candle.time)?.label ?? "Bar time unavailable"}. Open ${formatPrice(candle.open)}. High ${formatPrice(candle.high)}. Low ${formatPrice(candle.low)}. Close ${formatPrice(candle.close)}. Source volume ${sourceVolumeLabel(candle.volume)} (unit unknown).`;
}
