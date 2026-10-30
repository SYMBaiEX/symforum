"use client";

import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type {
  SymfCandle,
  SymfChartData,
  SymfChartInterval,
} from "@/lib/symf-market-data";
import styles from "@/components/forum/forum-symf.module.css";
import terminalStyles from "./forum-terminal.module.css";
import { readChartData, type ChartMarketData } from "./price-chart-data";

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
  symbol,
  compact,
}: {
  candles: SymfCandle[];
  light: boolean;
  symbol: string;
  compact?: boolean;
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
        className={`${styles.candleCanvas} ${compact ? terminalStyles.chartCanvas : ""}`}
        role="img"
        aria-label={`${symbol} USD candlestick chart, ${candles.length} candles. Latest close ${priceFormat.format(candles[candles.length - 1].close)}. Drag to pan and scroll to zoom. Times shown in UTC.`}
      />
      {!api && (
        <p
          role="status"
          className="absolute inset-0 grid place-items-center text-sm text-muted-foreground"
        >
          {failed
            ? "The chart could not start. Open Read candle data below for the checked values."
            : "Drawing chart…"}
        </p>
      )}
    </div>
  );
}

function ChartData({
  interval,
  light,
  mint,
  symbol,
  endpoint,
  onMarket,
  compact,
}: {
  interval: SymfChartInterval;
  light: boolean;
  mint: string;
  symbol: string;
  endpoint: string;
  onMarket?: (market: ChartMarketData) => void;
  compact?: boolean;
}) {
  const [data, setData] = useState<
    (SymfChartData & { stale?: boolean }) | null
  >(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch(`${endpoint}?interval=${interval}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("chart_data_unavailable");
        const result = readChartData(
          await response.json(),
          mint,
          interval,
          Date.now(),
        );
        if (!controller.signal.aborted) {
          setData(result);
          setError(false);
          if (result.stats !== undefined || result.priceUsd !== undefined)
            onMarket?.({
              mint: result.mint,
              checkedAt: result.checkedAt,
              stale: result.stale ?? false,
              stats: result.stats ?? null,
              priceUsd: result.priceUsd ?? null,
            });
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
  }, [endpoint, mint, interval, onMarket]);
  if (!data)
    return (
      <div
        className={`${styles.candleCanvas} ${compact ? terminalStyles.chartCanvas : ""}`}
      >
        <p
          role="status"
          className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground"
        >
          {error
            ? "Market data is temporarily unavailable. We’ll retry in a minute. The token’s explorer remains available."
            : "Loading verified market data…"}
        </p>
      </div>
    );
  return (
    <>
      <div
        className={`${styles.priceBar} ${compact ? terminalStyles.chartQuote : ""}`}
      >
        <p className="font-mono tabular-nums">
          {priceFormat.format(data.candles[data.candles.length - 1].close)}{" "}
          <span>USD · latest candle close</span>
        </p>
        <p>
          {error || data.stale
            ? "Refresh unavailable. Showing the last checked data."
            : `Checked ${new Date(data.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        </p>
      </div>
      <CandleCanvas
        compact={compact}
        key={light ? "light" : "dark"}
        candles={data.candles}
        light={light}
        symbol={symbol}
      />
      <details
        className={`border-t border-border px-4 py-3 text-xs text-muted-foreground ${compact ? terminalStyles.chartDataDisclosure : ""}`}
      >
        <summary className="focus-ring cursor-pointer">
          Read candle data
        </summary>
        <div
          className="mt-3 max-h-60 overflow-auto"
          tabIndex={0}
          role="region"
          aria-label="Recent candle data"
        >
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">Latest 20 USD candles, UTC</caption>
            <thead>
              <tr>
                <th scope="col">UTC</th>
                <th scope="col">Open</th>
                <th scope="col">High</th>
                <th scope="col">Low</th>
                <th scope="col">Close</th>
              </tr>
            </thead>
            <tbody>
              {data.candles
                .slice(-20)
                .reverse()
                .map((candle) => (
                  <tr key={candle.time}>
                    <td className="whitespace-nowrap py-2 pr-3">
                      {new Date(candle.time * 1000)
                        .toISOString()
                        .slice(5, 16)
                        .replace("T", " ")}
                    </td>
                    {[candle.open, candle.high, candle.low, candle.close].map(
                      (value, index) => (
                        <td key={index} className="px-2">
                          {priceFormat.format(value)}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

export function TokenPriceChart({
  mint,
  symbol,
  light,
  endpoint = `/api/token/${encodeURIComponent(mint)}/chart`,
  onMarket,
  compact,
}: {
  mint: string;
  symbol: string;
  light: boolean;
  endpoint?: string;
  onMarket?: (market: ChartMarketData) => void;
  compact?: boolean;
}) {
  const [interval, setInterval] = useState<SymfChartInterval>("15m");
  return (
    <>
      <div
        className={`${styles.chartControls} ${compact ? terminalStyles.chartControls : ""}`}
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
      <ChartData
        compact={compact}
        key={`${mint}:${interval}`}
        interval={interval}
        light={light}
        mint={mint}
        symbol={symbol}
        endpoint={endpoint}
        onMarket={onMarket}
      />
    </>
  );
}
