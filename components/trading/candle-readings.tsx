"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SymfCandle } from "@/lib/symf-market-data";
import {
  candleReadingTime,
  candleReadings,
  sourceVolumeLabel,
} from "./candle-readings-model";
import {
  candleCheckTime,
  candleReadingText,
  type CandleEvidence,
} from "./candle-reading-text";

export function CandleReadings({
  candles,
  compact,
  formatPrice,
  evidence,
}: {
  candles: readonly SymfCandle[];
  compact?: boolean;
  formatPrice: (value: number) => string;
  evidence?: CandleEvidence;
}) {
  const id = useId();
  const readings = candleReadings(candles);
  const text = evidence
    ? candleReadingText(readings.rows, evidence, formatPrice)
    : null;
  const checked = evidence ? candleCheckTime(evidence.checkedAt) : null;
  const attempt = useRef(0);
  const [feedback, setFeedback] = useState<{
    snapshot: string;
    pending: boolean;
    message: string;
  } | null>(null);
  const currentFeedback = feedback?.snapshot === text ? feedback : null;
  useEffect(
    () => () => {
      attempt.current++;
    },
    [],
  );
  async function copyReadings() {
    if (!text || currentFeedback?.pending) return;
    const run = ++attempt.current;
    const snapshot = text;
    setFeedback({
      snapshot,
      pending: true,
      message: "Copying displayed readings…",
    });
    try {
      await navigator.clipboard.writeText(snapshot);
      if (run === attempt.current)
        setFeedback({
          snapshot,
          pending: false,
          message: "Displayed readings copied.",
        });
    } catch {
      if (run === attempt.current)
        setFeedback({
          snapshot,
          pending: false,
          message:
            "Copy unavailable. Select the readings below and copy them manually.",
        });
    }
  }
  return (
    <div
      className={
        compact
          ? "mt-3 min-w-0 focus-ring"
          : "mt-3 min-w-0 max-h-60 overflow-auto focus-ring"
      }
      tabIndex={0}
      role="region"
      aria-label="Recent candle data"
      aria-describedby={`${id}-count ${id}-context`}
    >
      {evidence && checked && (
        <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 break-words">
            Source <strong>{evidence.sourceLabel}</strong>
            <br />
            Checked <time dateTime={checked.iso}>{checked.label}</time>
          </p>
          <button
            type="button"
            className="focus-ring min-h-11 min-w-11 rounded-md border border-border px-3 py-2"
            disabled={Boolean(currentFeedback?.pending)}
            aria-describedby={`${id}-count ${id}-context`}
            onClick={() => void copyReadings()}
          >
            Copy displayed readings
          </button>
          <p
            role="status"
            aria-live="polite"
            className={
              currentFeedback?.message ? "w-full break-words" : "sr-only"
            }
          >
            {currentFeedback?.message ?? ""}
          </p>
        </div>
      )}
      <p id={`${id}-count`} className="mb-1">
        Loaded {readings.count} {readings.count === 1 ? "bar" : "bars"}
        {readings.count > readings.rows.length
          ? ` · showing latest ${readings.rows.length}`
          : ""}
        .
        {readings.first && readings.last && (
          <span className="block">
            {readings.count === 1 ? "Bar time " : "Range "}
            <time
              dateTime={readings.first.iso}
              aria-label={readings.first.label}
            >
              {readings.first.compact}
            </time>
            {readings.count > 1 && (
              <>
                {" – "}
                <time
                  dateTime={readings.last.iso}
                  aria-label={readings.last.label}
                >
                  {readings.last.compact}
                </time>
              </>
            )}{" "}
            UTC.
          </span>
        )}
      </p>
      <p id={`${id}-context`} className="mb-2">
        Checked time dates the source check, not each bar. Returned bars may be
        sparse. Prices USD; volume unit unknown.
      </p>
      <div
        className="max-w-full overflow-x-auto overscroll-x-contain focus-ring"
        tabIndex={0}
        role="region"
        aria-label="Scrollable candle readings"
        aria-describedby={`${id}-context`}
      >
        <table className="min-w-max w-full text-left tabular-nums">
          <caption className="sr-only">
            Latest {readings.rows.length} of {readings.count} loaded USD-price
            candles, UTC. Source volume unit unknown.
          </caption>
          <thead>
            <tr>
              <th scope="col">UTC</th>
              <th scope="col">Open</th>
              <th scope="col">High</th>
              <th scope="col">Low</th>
              <th scope="col">Close</th>
              <th scope="col">Source volume</th>
            </tr>
          </thead>
          <tbody>
            {readings.rows.map((candle) => {
              const time = candleReadingTime(candle.time);
              return (
                <tr key={candle.time}>
                  <td className="whitespace-nowrap py-2 pr-3">
                    {time ? (
                      <time dateTime={time.iso}>{time.label}</time>
                    ) : (
                      "Unavailable"
                    )}
                  </td>
                  {[candle.open, candle.high, candle.low, candle.close].map(
                    (value, index) => (
                      <td key={index} className="whitespace-nowrap px-2">
                        {formatPrice(value)}
                      </td>
                    ),
                  )}
                  <td className="whitespace-nowrap px-2">
                    {sourceVolumeLabel(candle.volume)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
