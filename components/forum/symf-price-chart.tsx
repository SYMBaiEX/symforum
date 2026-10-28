"use client";

import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type {
  SymfCandle,
  SymfChartData,
  SymfChartInterval,
} from "@/lib/symf-market-data";
import styles from "./forum-symf.module.css";

const priceFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 5,
});
type ChartApi = {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
};

function CandleCanvas({
  candles,
  light,
}: {
  candles: SymfCandle[];
  light: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const [api, setApi] = useState<ChartApi | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let chart: IChartApi | undefined;
    void import("lightweight-charts")
      .then(
        ({ createChart, CandlestickSeries, HistogramSeries, ColorType }) => {
          if (cancelled || !container.current) return;
          chart = createChart(container.current, {
            autoSize: true,
            layout: {
              background: {
                type: ColorType.Solid,
                color: light ? "#ffffff" : "#131315",
              },
              textColor: light ? "#52525b" : "#a1a1aa",
              attributionLogo: true,
            },
            grid: {
              vertLines: { color: light ? "#f4f4f5" : "#202024" },
              horzLines: { color: light ? "#f4f4f5" : "#202024" },
            },
            rightPriceScale: {
              borderColor: light ? "#e4e4e7" : "#2a2a30",
              scaleMargins: { top: 0.12, bottom: 0.25 },
            },
            timeScale: {
              timeVisible: true,
              secondsVisible: false,
              lockVisibleTimeRangeOnResize: true,
              borderColor: light ? "#e4e4e7" : "#2a2a30",
            },
            localization: {
              priceFormatter: (value: number) => priceFormat.format(value),
            },
          });
          const series = chart.addSeries(CandlestickSeries, {
            upColor: "#2dd4bf",
            downColor: "#e832a4",
            borderVisible: false,
            wickUpColor: "#2dd4bf",
            wickDownColor: "#e832a4",
            priceFormat: {
              type: "custom",
              minMove: 0.000000001,
              formatter: (value: number) => priceFormat.format(value),
            },
          });
          const volume = chart.addSeries(HistogramSeries, {
            priceFormat: { type: "volume" },
            priceScaleId: "volume",
            lastValueVisible: false,
            priceLineVisible: false,
          });
          volume
            .priceScale()
            .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
          setApi({ chart, series, volume });
        },
      )
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      chart?.remove();
    };
  }, [light]);

  useEffect(() => {
    if (!api) return;
    const minimum = Math.min(...candles.map((c) => c.low));
    api.series.applyOptions({
      priceFormat: {
        type: "custom",
        minMove: Math.max(
          Number.MIN_VALUE,
          10 ** (Math.floor(Math.log10(minimum)) - 4),
        ),
        formatter: (value: number) => priceFormat.format(value),
      },
    });
    api.series.setData(
      candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })),
    );
    api.volume.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "#2dd4bf40" : "#e832a440",
      })),
    );
    if (!fitted.current) {
      api.chart.timeScale().fitContent();
      fitted.current = true;
    }
  }, [api, candles]);

  return (
    <div className="relative">
      <div
        ref={container}
        className={styles.candleCanvas}
        role="img"
        aria-label={`SYMF USD candlestick chart, ${candles.length} candles. Latest close ${priceFormat.format(candles[candles.length - 1].close)}. Drag to pan and scroll to zoom. Times shown in UTC.`}
      />
      {!api && (
        <p
          role="status"
          className="absolute inset-0 grid place-items-center text-sm text-muted-foreground"
        >
          {failed
            ? "The chart could not start. Use Open full chart above."
            : "Drawing chart…"}
        </p>
      )}
    </div>
  );
}

function ChartData({
  interval,
  light,
}: {
  interval: SymfChartInterval;
  light: boolean;
}) {
  const [data, setData] = useState<SymfChartData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch(
          `/api/token/symf/chart?interval=${interval}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("chart_data_unavailable");
        const result = (await response.json()) as SymfChartData;
        if (!controller.signal.aborted) {
          setData(result);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        busy = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [interval]);
  if (!data)
    return (
      <div className={styles.candleCanvas}>
        <p
          role="status"
          className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground"
        >
          {error
            ? "Market data is temporarily unavailable. We’ll retry in a minute, or use Open full chart above."
            : "Loading verified market data…"}
        </p>
      </div>
    );
  return (
    <>
      <div className={styles.priceBar}>
        <p className="font-mono tabular-nums">
          {priceFormat.format(data.candles[data.candles.length - 1].close)}{" "}
          <span>USD · latest candle close</span>
        </p>
        <p>
          {error
            ? "Refresh unavailable. Showing the last checked data."
            : `Checked ${new Date(data.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        </p>
      </div>
      <CandleCanvas
        key={light ? "light" : "dark"}
        candles={data.candles}
        light={light}
      />
    </>
  );
}

export function SymfPriceChart({ light }: { light: boolean }) {
  const [interval, setInterval] = useState<SymfChartInterval>("15m");
  return (
    <>
      <div
        className={styles.chartControls}
        role="group"
        aria-label="Candle interval"
      >
        {(["1m", "5m", "15m", "1h", "4h"] as const).map((value) => (
          <button
            type="button"
            key={value}
            className="focus-ring"
            aria-pressed={interval === value}
            onClick={() => setInterval(value)}
          >
            {value}
          </button>
        ))}
        <span>USD candles · UTC</span>
      </div>
      <ChartData key={interval} interval={interval} light={light} />
    </>
  );
}
