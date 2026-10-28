"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, ArrowDownLeft } from "lucide-react";
import type { SymfMarketOverview } from "@/lib/symf-market-overview";
import styles from "./forum-symf.module.css";

export function useSymfMarket(enabled: boolean) {
  const [data, setData] = useState<SymfMarketOverview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch("/api/token/symf/market", {
          signal: controller.signal,
        });
        if (!response.ok) throw Error("market_unavailable");
        const result = (await response.json()) as SymfMarketOverview;
        if (!controller.signal.aborted) {
          setData(result);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
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
  }, [enabled]);
  return { data, failed };
}

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumSignificantDigits: 4,
});
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const price = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 5,
});
const quantity = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 4,
});
function money(value: number | null | undefined, compact = false) {
  return value == null
    ? "--"
    : value > 0 && value < 0.01
      ? "<$0.01"
      : compact
        ? compactUsd.format(value)
        : usd.format(value);
}

export function SymfStats({
  data,
  failed,
}: {
  data: SymfMarketOverview | null;
  failed: boolean;
}) {
  const stats = data?.stats;
  const values = [
    [
      "Market cap",
      stats?.marketCap,
      "Market capitalization reported by DEX Screener.",
    ],
    [
      "Fully diluted value",
      stats?.fdv,
      "FDV reported separately; never substituted for market cap.",
    ],
    [
      "Liquidity",
      stats?.liquidity,
      "USD liquidity reported for the verified SYMF / SOL pool.",
    ],
    ["24h volume", stats?.volume24h, "24-hour volume reported for this pool."],
  ] as const;
  return (
    <section aria-label="SYMF market statistics" className={styles.metrics}>
      {values.map(([label, value, description]) => (
        <div key={label} className={styles.metric} title={description}>
          <p>{label}</p>
          <p
            className="font-mono tabular-nums"
            title={value == null ? "Unavailable" : usd.format(value)}
          >
            {money(value, true)}
          </p>
          <span>DEX Screener</span>
        </div>
      ))}
      <p role="status" className={styles.marketStatus}>
        {data
          ? `${failed ? "Refresh unavailable. Last checked" : "Checked"} ${new Date(data.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
          : failed
            ? "Market statistics are temporarily unavailable."
            : "Loading market statistics…"}{" "}
        {data && !stats
          ? "Statistics unavailable; no supply-based estimate is substituted."
          : ""}
      </p>
    </section>
  );
}

export function SymfTrades({
  data,
  failed,
}: {
  data: SymfMarketOverview | null;
  failed: boolean;
}) {
  const trades = data?.trades;
  return (
    <section aria-labelledby="symf-trades-title" className={styles.trades}>
      <header className={styles.chartHeader}>
        <div>
          <h2 id="symf-trades-title" className={styles.chartTitle}>
            Recent trades
          </h2>
          <p className={styles.chartMeta}>
            Buys &amp; sells on the verified SYMF / SOL pool
          </p>
        </div>
        <span className="text-xs text-muted-foreground">No amount minimum</span>
      </header>
      {!trades?.length ? (
        <p
          role="status"
          className="px-6 py-12 text-center text-sm text-muted-foreground"
        >
          {trades?.length === 0
            ? "No recent indexed trades."
            : failed || data
              ? "Recent trades are temporarily unavailable."
              : "Loading recent trades…"}
        </p>
      ) : (
        <div className={styles.tradeScroll}>
          <table className={styles.tradeTable}>
            <caption className="sr-only">
              The latest {trades.length} indexed SYMF trades. Times use your
              local timezone. Amounts shown in USD and SYMF.
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Type</th>
                <th scope="col">USD</th>
                <th scope="col" className={styles.quantityColumn}>
                  SYMF
                </th>
                <th scope="col" className={styles.priceColumn}>
                  Price
                </th>
                <th scope="col">
                  <span className="sr-only">Transaction</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.id}>
                  <td>
                    <time
                      dateTime={new Date(trade.time).toISOString()}
                      title={new Date(trade.time).toLocaleString()}
                    >
                      {new Date(trade.time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        hour12: false,
                      })}
                    </time>
                  </td>
                  <td>
                    <span
                      className={
                        trade.side === "buy" ? styles.buy : styles.sell
                      }
                    >
                      {trade.side === "buy" ? (
                        <ArrowUpRight aria-hidden="true" className="size-3" />
                      ) : (
                        <ArrowDownLeft aria-hidden="true" className="size-3" />
                      )}
                      {trade.side === "buy" ? "Buy" : "Sell"}
                    </span>
                  </td>
                  <td
                    className="font-mono tabular-nums"
                    title={usd.format(trade.valueUsd)}
                  >
                    {money(trade.valueUsd)}
                    <span className={styles.mobileQuantity}>
                      {quantity.format(trade.amount)} SYMF
                    </span>
                  </td>
                  <td
                    className={`${styles.quantityColumn} font-mono tabular-nums`}
                    title={String(trade.amount)}
                  >
                    {quantity.format(trade.amount)}
                  </td>
                  <td
                    className={`${styles.priceColumn} font-mono tabular-nums`}
                  >
                    {trade.priceUsd === null
                      ? "--"
                      : price.format(trade.priceUsd)}
                  </td>
                  <td>
                    <a
                      href={`https://solscan.io/tx/${trade.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View ${trade.side} transaction on Solscan`}
                      title={trade.hash}
                      className="focus-ring inline-flex size-11 items-center justify-center text-muted-foreground hover:text-primary"
                    >
                      <ArrowUpRight aria-hidden="true" className="size-3.5" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className={styles.chartFooter}>
        <p>
          Latest indexed trades from GeckoTerminal. Coverage and timing depend
          on the provider.
        </p>
        <p>
          {failed
            ? "Refresh unavailable; showing previously checked trades."
            : "Refreshes about every minute."}
        </p>
      </footer>
    </section>
  );
}
