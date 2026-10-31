"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { SymfCandle, SymfChartInterval } from "@/lib/symf-market-data";
import styles from "@/components/forum/forum-symf.module.css";
import terminalStyles from "./forum-terminal.module.css";
import {
  readChartData,
  retainedChartData,
  chartResponsePolicy,
  chartStateMessage,
  chartSourceLabel,
  chartHistoryLabel,
  type CheckedChartData,
  type ChartCacheState,
  type ChartMarketData,
} from "./price-chart-data";
import {
  CHART_CACHE_FRESH_MS,
  CHART_CACHE_RETENTION_MS,
} from "@/lib/chart-cache-policy";
import { useForumRuntime } from "@/components/forum/forum-runtime-context";
import { formatChartAxisPrice } from "./chart-axis-format";
import { Button } from "@/components/ui/button";
import { CandleReadings } from "./candle-readings";

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
  const axisStep = useRef(0.000000001);
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
              // Sparse real history must not turn one candle into a full-width slab.
              maxBarSpacing: 36,
              lockVisibleTimeRangeOnResize: true,
              borderColor: light ? "#e4e4e7" : "#2a2a30",
            },
            localization: {
              priceFormatter: (value: number) =>
                formatChartAxisPrice(value, axisStep.current),
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
              formatter: (value: number) =>
                formatChartAxisPrice(value, axisStep.current),
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
    axisStep.current = Math.max(
      Number.MIN_VALUE,
      10 ** (Math.floor(Math.log10(minimum)) - 4),
    );
    api.series.applyOptions({
      priceFormat: {
        type: "custom",
        minMove: axisStep.current,
        formatter: (value: number) =>
          formatChartAxisPrice(value, axisStep.current),
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
    <div className={`relative ${compact ? terminalStyles.chartFrame : ""}`}>
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
  demandRoot,
  onBrowseMarkets,
}: {
  interval: SymfChartInterval;
  light: boolean;
  mint: string;
  symbol: string;
  endpoint: string;
  onMarket?: (market: ChartMarketData) => void;
  compact?: boolean;
  demandRoot: RefObject<HTMLDivElement | null>;
  onBrowseMarkets?: () => void;
}) {
  const { host } = useForumRuntime();
  const [data, setData] = useState<CheckedChartData | null>(null);
  const lastGood = useRef<CheckedChartData | null>(null);
  const [state, setState] = useState<ChartCacheState | null>(null);
  const [offline, setOffline] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const showData = useCallback(
    (next: CheckedChartData | null) => {
      const previous = lastGood.current;
      lastGood.current = next;
      setData(next);
      if (!next) {
        // Zero is an internal invalidation sentinel, never a displayed check time.
        onMarket?.({
          mint,
          checkedAt: previous?.checkedAt ?? 0,
          stale: true,
          stats: null,
          priceUsd: null,
        });
      } else if (next.stats !== undefined || next.priceUsd !== undefined) {
        onMarket?.({
          mint: next.mint,
          checkedAt: next.checkedAt,
          stale: next.stale ?? false,
          stats: next.stats ?? null,
          priceUsd: next.priceUsd ?? null,
        });
      }
    },
    [mint, onMarket],
  );

  const ageData = useCallback(() => {
    const previous = lastGood.current;
    if (!previous) return;
    const current = retainedChartData(previous, Date.now());
    if (!current || current.stale !== previous.stale) showData(current);
  }, [showData]);

  useEffect(() => {
    if (!data) return;
    const deadline =
      data.checkedAt +
      (data.stale ? CHART_CACHE_RETENTION_MS : CHART_CACHE_FRESH_MS);
    const timer = setTimeout(ageData, Math.max(1, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [data, ageData]);

  useEffect(() => {
    const element = demandRoot.current;
    if (host !== "website" || !element) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let visible = false;
    let busy = false;
    let nextAttemptAt: number | null = 0;
    const keepLastGood = () =>
      showData(
        lastGood.current
          ? retainedChartData(lastGood.current, Date.now(), true)
          : null,
      );
    const demand = () => {
      clearTimeout(timer);
      if (controller.signal.aborted) return;
      ageData();
      setOffline(!navigator.onLine);
      if (
        !visible ||
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        !element.getClientRects().length ||
        busy ||
        nextAttemptAt === null
      )
        return;
      if (nextAttemptAt > Date.now()) {
        timer = setTimeout(demand, nextAttemptAt - Date.now());
        return;
      }
      void refresh();
    };
    async function refresh() {
      if (busy) return;
      busy = true;
      nextAttemptAt = Date.now() + 60_000;
      try {
        const response = await fetch(`${endpoint}?interval=${interval}`, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30_000),
          ]),
        });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        const policy = chartResponsePolicy(body, response, Date.now());
        nextAttemptAt = policy.nextRetryAt;
        setRetryAt(nextAttemptAt);
        setState(policy.state);
        if (response.ok) {
          const result = readChartData(body, mint, interval, Date.now());
          showData(
            retainedChartData(result, Date.now(), policy.state !== "ready"),
          );
        } else keepLastGood();
      } catch {
        if (!controller.signal.aborted) {
          setState("unavailable");
          setRetryAt(nextAttemptAt);
          keepLastGood();
        }
      } finally {
        busy = false;
        demand();
      }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      demand();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", demand);
    window.addEventListener("online", demand);
    window.addEventListener("offline", demand);
    return () => {
      controller.abort();
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", demand);
      window.removeEventListener("online", demand);
      window.removeEventListener("offline", demand);
    };
  }, [endpoint, mint, interval, demandRoot, host, showData, ageData]);
  const historyLabel = data ? chartHistoryLabel(data, data.checkedAt) : null;
  if (!data)
    return (
      <div
        className={`${styles.candleCanvas} ${compact ? `${terminalStyles.chartCanvas} ${terminalStyles.chartEmpty}` : ""}`}
        data-terminal-chart-empty={compact ? true : undefined}
      >
        {compact && (
          <span className={terminalStyles.chartEmptyLabel}>Market chart</span>
        )}
        <p
          role="status"
          title={
            retryAt
              ? `Next permitted check after ${new Date(retryAt).toLocaleString()}.`
              : undefined
          }
          className={
            compact
              ? terminalStyles.chartEmptyMessage
              : "grid h-full place-items-center px-6 text-center text-sm text-muted-foreground"
          }
        >
          {state || offline
            ? chartStateMessage(state, false, offline)
            : "Loading verified market data…"}
        </p>
        {compact && retryAt && (
          <p className={terminalStyles.chartEmptyHint}>
            Next eligible check{" "}
            {new Date(retryAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}
        {compact && onBrowseMarkets && (
          <Button
            variant="outline"
            className={`${terminalStyles.chartEmptyAction} focus-ring`}
            type="button"
            onClick={onBrowseMarkets}
          >
            Browse markets
          </Button>
        )}
      </div>
    );
  return (
    <>
      <div
        className={`${styles.priceBar} ${compact ? terminalStyles.chartQuote : ""}`}
      >
        <p className="font-mono tabular-nums">
          {compact && <span>Close </span>}
          {priceFormat.format(data.candles[data.candles.length - 1].close)}{" "}
          {compact && (
            <span className="sr-only">USD · latest candle close</span>
          )}
          {!compact && <span>USD · latest candle close</span>}
        </p>
        <p
          title={`Checked ${new Date(data.checkedAt).toLocaleString()}. USD candles, UTC.`}
        >
          {chartSourceLabel(data)} ·{" "}
          {`Checked ${new Date(data.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
          {historyLabel && (
            <span className={terminalStyles.historyNote} role="status">
              {historyLabel}
            </span>
          )}
          {(data.stale || offline) && (
            <span role="status">
              {" "}
              {chartStateMessage(state, true, offline)}
            </span>
          )}
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
        <CandleReadings
          candles={data.candles}
          compact={compact}
          formatPrice={priceFormat.format}
          evidence={{
            mint,
            interval,
            checkedAt: data.checkedAt,
            sourceLabel: chartSourceLabel(data),
          }}
        />
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
  onBrowseMarkets,
}: {
  mint: string;
  symbol: string;
  light: boolean;
  endpoint?: string;
  onMarket?: (market: ChartMarketData) => void;
  compact?: boolean;
  onBrowseMarkets?: () => void;
}) {
  const demandRoot = useRef<HTMLDivElement>(null);
  const [interval, setInterval] = useState<SymfChartInterval>("15m");
  return (
    <div
      ref={demandRoot}
      className={compact ? terminalStyles.chartLayout : undefined}
    >
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
        {!compact && <span>USD candles · UTC</span>}
      </div>
      <ChartData
        demandRoot={demandRoot}
        compact={compact}
        key={`${mint}:${interval}`}
        interval={interval}
        light={light}
        mint={mint}
        symbol={symbol}
        endpoint={endpoint}
        onMarket={onMarket}
        onBrowseMarkets={onBrowseMarkets}
      />
    </div>
  );
}
