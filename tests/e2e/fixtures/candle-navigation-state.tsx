import { useEffect, useState } from "react";
import type { SymfCandle } from "../../../lib/symf-market-data";
import type { CandleEvidence } from "../../../components/trading/candle-reading-text";
export const CHECKED = Date.parse("2026-10-31T12:00:00Z");
export function localCandles(count = 120, offset = 0): SymfCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: 1609459200 + i * 900 + (i > 60 ? 86400 : 0) + offset,
    open: i + 1,
    high: i + 2,
    low: i + 0.5,
    close: i + 1.5,
    volume: i === count - 1 ? 0 : i + 0.125,
  }));
}
export const localEvidence: CandleEvidence = {
  mint: "So11111111111111111111111111111111111111112",
  interval: "15m",
  checkedAt: CHECKED,
  sourceLabel: "Solana Tracker",
};
export function useLocalState() {
  const [state, setState] = useState({
    candles: localCandles(),
    evidence: localEvidence,
  });
  useEffect(() => {
    const change = (event: Event) => {
      const kind = (event as CustomEvent<string>).detail;
      setState((previous) => ({
        candles:
          kind === "empty"
            ? []
            : kind === "single"
              ? localCandles(1)
              : kind === "missing"
                ? [
                    {
                      ...localCandles(1)[0],
                      volume: undefined,
                    } as unknown as SymfCandle,
                  ]
                : localCandles(
                    kind === "short" ? 3 : 120,
                    kind === "history" ? 86400 : 0,
                  ),
        evidence: {
          ...previous.evidence,
          ...(kind === "mint"
            ? { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }
            : {}),
          ...(kind === "interval" ? { interval: "1h" as const } : {}),
          ...(kind === "history" ? { checkedAt: CHECKED + 60000 } : {}),
        },
      }));
    };
    window.addEventListener("candle:replace", change);
    return () => window.removeEventListener("candle:replace", change);
  }, []);
  return state;
}
