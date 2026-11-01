import type { SymfCandle } from "@/lib/symf-market-data";

const intervalSeconds = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
} as const;
type Interval = keyof typeof intervalSeconds;
type Assessment =
  | { state: "unknown" }
  | { state: "insufficient"; bars: number }
  | {
      state: "assessed";
      bars: number;
      interval: Interval;
      gaps: number;
      unrepresented: number;
    };

/** Inspect the bounded loaded sample only. Times are epoch seconds, never guessed or converted. */
export function assessCandleGaps(
  candles: readonly Pick<SymfCandle, "time">[],
  interval: string,
  checkedAt: number,
): Assessment {
  if (
    !Object.hasOwn(intervalSeconds, interval) ||
    candles.length > 200 ||
    !Number.isFinite(checkedAt) ||
    checkedAt <= 0 ||
    checkedAt > 8.64e15
  )
    return { state: "unknown" };
  const selected = interval as Interval;
  const seconds = intervalSeconds[selected];
  let previous = 0,
    gaps = 0,
    unrepresented = 0;
  for (const candle of candles) {
    const time = candle.time;
    // The check timestamp provides a bound without reading a new clock. A
    // millisecond timestamp must not turn into thousands of years of gaps.
    if (
      !Number.isSafeInteger(time) ||
      time <= 0 ||
      time * 1000 > checkedAt + 60_000 ||
      time % seconds !== 0 ||
      time <= previous
    )
      return { state: "unknown" };
    if (previous) {
      const skipped = (time - previous) / seconds - 1;
      if (skipped > 0) {
        gaps++;
        unrepresented += skipped;
      }
    }
    previous = time;
  }
  return candles.length < 2
    ? { state: "insufficient", bars: candles.length }
    : {
        state: "assessed",
        bars: candles.length,
        interval: selected,
        gaps,
        unrepresented,
      };
}

export function candleGapSummary(result: Assessment): string {
  if (result.state === "unknown")
    return "Gap counts cannot be assessed: the loaded timestamps or selected UTC interval alignment could not be established.";
  if (result.state === "insufficient")
    return `Loaded ${result.bars} ${result.bars === 1 ? "bar" : "bars"}. At least two aligned timestamps are needed to assess gaps.`;
  return result.unrepresented
    ? `${result.unrepresented} unrepresented ${result.interval} UTC interval ${result.unrepresented === 1 ? "slot" : "slots"} across ${result.gaps} ${result.gaps === 1 ? "gap" : "gaps"} between ${result.bars} loaded bars.`
    : `No skipped ${result.interval} UTC interval slots between these ${result.bars} loaded bars.`;
}
