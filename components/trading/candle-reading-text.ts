import type { SymfCandle, SymfChartInterval } from "@/lib/symf-market-data";
import { candleReadingTime, sourceVolumeLabel } from "./candle-readings-model";

export type CandleEvidence = {
  mint: string;
  interval: SymfChartInterval;
  checkedAt: number;
  sourceLabel: "GeckoTerminal" | "Solana Tracker";
};

export function candleCheckTime(checkedAt: number) {
  if (!Number.isFinite(checkedAt) || checkedAt <= 0) return null;
  const date = new Date(checkedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const iso = date.toISOString();
  return {
    iso,
    label: `${iso
      .replace("T", " ")
      .replace(/\.000Z$/, " UTC")
      .replace(/Z$/, " UTC")}`,
  };
}

/** Serialize only the same bounded rows and formatted cells the reader sees. */
export function candleReadingText(
  rows: readonly SymfCandle[],
  evidence: CandleEvidence,
  formatPrice: (value: number) => string,
) {
  const checked = candleCheckTime(evidence.checkedAt);
  if (!checked) return null;
  return [
    `Source: ${evidence.sourceLabel}`,
    `Checked: ${checked.label}`,
    `Mint: ${evidence.mint}`,
    `Interval: ${evidence.interval}`,
    "Prices USD; Source volume unit unknown.",
    "UTC\tOpen\tHigh\tLow\tClose\tSource volume",
    ...rows.map((row) =>
      [
        candleReadingTime(row.time)?.label ?? "Unavailable",
        ...[row.open, row.high, row.low, row.close].map(formatPrice),
        sourceVolumeLabel(row.volume),
      ].join("\t"),
    ),
  ].join("\n");
}
