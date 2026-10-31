"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useAction, useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  MARKET_CAP_BANDS,
  isMarketCapBand,
  type MarketCapBand,
} from "@/lib/forum-market-cap";
import type {
  TerminalMarket,
  TerminalMarketRefreshResult,
} from "@/lib/forum-terminal-model";
import { useForumRuntime } from "@/components/forum/forum-runtime-context";
import { TokenLogo, symfChoice, type MarketChoice } from "./market-identity";
import { terminalApi } from "./terminal-api";
import {
  marketMoney,
  marketQuantity,
  safeExternalUrl,
  searchMarkets,
  shortMint,
} from "./terminal-format";
import {
  formatMarketPercent,
  marketSources,
  rawMarketNumber,
  sortMarketRows,
  type MarketSortDirection,
  type MarketSortKey,
} from "./market-explorer-model";
import styles from "./market-explorer.module.css";

const columns = [
  ["price", "Price"],
  ["change1h", "1h change"],
  ["marketCap", "Market cap"],
  ["liquidity", "Liquidity"],
  ["volume1h", "1h volume"],
  ["volume24h", "24h volume"],
  ["holders", "Holders"],
] as const;

const MARKET_REFRESH_INTERVAL_MS = 10 * 60_000;

/** Demand only: the server owns batch membership, lease and all quota checks. */
function useVisibleMarketRefresh(root: RefObject<HTMLElement | null>) {
  const { host } = useForumRuntime();
  const refresh = useAction(terminalApi.refreshMarketSample);
  const [result, setResult] = useState<TerminalMarketRefreshResult | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [offline, setOffline] = useState(false);
  const nextAttemptAt = useRef(0);
  useEffect(() => {
    const element = root.current;
    if (host !== "website" || !element) return;
    let disposed = false;
    let visible = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearTimer = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const demand = () => {
      clearTimer();
      if (disposed) return;
      setOffline(!navigator.onLine);
      if (
        !visible ||
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        !element.getClientRects().length ||
        running
      )
        return;
      const remaining = nextAttemptAt.current - Date.now();
      if (remaining > 0) {
        timer = setTimeout(demand, remaining);
        return;
      }
      running = true;
      setPending(true);
      nextAttemptAt.current = Date.now() + MARKET_REFRESH_INTERVAL_MS;
      void refresh({})
        .then((value) => {
          if (disposed) return;
          if (
            value.nextRefreshAt != null &&
            Number.isFinite(value.nextRefreshAt)
          )
            nextAttemptAt.current = Math.max(
              nextAttemptAt.current,
              value.nextRefreshAt,
            );
          setResult(value);
        })
        .catch(() => {
          if (!disposed)
            setResult((previous) => ({
              state: "unavailable",
              checkedAt: previous?.checkedAt ?? null,
              nextRefreshAt: nextAttemptAt.current,
            }));
        })
        .finally(() => {
          running = false;
          if (!disposed) {
            setPending(false);
            demand();
          }
        });
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      demand();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", demand);
    window.addEventListener("online", demand);
    window.addEventListener("offline", demand);
    return () => {
      disposed = true;
      clearTimer();
      observer.disconnect();
      document.removeEventListener("visibilitychange", demand);
      window.removeEventListener("online", demand);
      window.removeEventListener("offline", demand);
    };
  }, [host, refresh, root]);
  return { result, pending, offline };
}

export function MarketExplorer({
  selected,
  onSelect,
  now,
}: {
  selected: string;
  onSelect: (choice: MarketChoice) => void;
  now: number;
}) {
  const [search, setSearch] = useState("");
  const [band, setBand] = useState<MarketCapBand>("all");
  const [platform, setPlatform] = useState<"all" | "bags" | "pumpfun">("all");
  const [sort, setSort] = useState<{
    key: MarketSortKey;
    direction: MarketSortDirection;
  }>({ key: "volume1h", direction: "desc" });
  const coverageId = useId();
  const scrollHintId = useId();
  const root = useRef<HTMLElement>(null);
  const refresh = useVisibleMarketRefresh(root);
  const searchInput = useRef<HTMLInputElement>(null);
  const data = useQuery(terminalApi.listMarket, {
    band,
    ...(platform === "all" ? {} : { platform }),
    now,
    limit: 60,
  });
  const markets = sortMarketRows(
    searchMarkets(data?.markets ?? [], search),
    sort.key,
    sort.direction,
  );
  const filtered =
    search.trim().length > 0 || band !== "all" || platform !== "all";
  const empty = data === undefined || markets.length === 0;
  function resetFilters() {
    setSearch("");
    setBand("all");
    setPlatform("all");
    searchInput.current?.focus();
  }
  function changeSort(key: MarketSortKey) {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  }
  return (
    <section
      ref={root}
      className={styles.explorer}
      aria-label="Sampled token discovery"
    >
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search aria-hidden="true" />
          <Input
            ref={searchInput}
            aria-label="Search sampled tokens"
            placeholder="Search name, ticker or mint"
            maxLength={64}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <label>
          <span>Market cap</span>
          <select
            value={band}
            onChange={(event) => {
              if (isMarketCapBand(event.target.value))
                setBand(event.target.value);
            }}
          >
            {MARKET_CAP_BANDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Platform</span>
          <select
            value={platform}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "all" || value === "bags" || value === "pumpfun")
                setPlatform(value);
            }}
          >
            <option value="all">All platforms</option>
            <option value="pumpfun">Pump.fun</option>
            <option value="bags">Bags.fm</option>
          </select>
        </label>
      </div>
      <div className={styles.pinned}>
        <span>Forum token</span>
        <button
          type="button"
          aria-label="Show SYMF market"
          aria-pressed={selected === symfChoice.mint}
          onClick={() => onSelect(symfChoice)}
          title={symfChoice.mint}
        >
          <TokenLogo token={symfChoice} />
          <strong>${symfChoice.symbol}</strong>
          <span>{shortMint(symfChoice.mint)}</span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
        <small>Quick access, not a market ranking</small>
      </div>
      <div className={styles.context} role="group" aria-label="Sample context">
        <p role="status">
          <strong>
            {data === undefined
              ? "Loading sample"
              : `${markets.length} ${markets.length === 1 ? "token" : "tokens"}`}
          </strong>
          <span>Sampled data</span>
        </p>
        <label className={styles.sortControl}>
          <span>Sort</span>
          <select
            aria-label="Sort sampled tokens"
            value={`${sort.key}:${sort.direction}`}
            onChange={(event) => {
              const [key, direction] = event.target.value.split(":");
              const column = columns.find(([value]) => value === key);
              if (column && (direction === "asc" || direction === "desc"))
                setSort({ key: column[0], direction });
            }}
          >
            {columns.flatMap(([key, label]) =>
              (["desc", "asc"] as const).map((direction) => (
                <option
                  key={`${key}:${direction}`}
                  value={`${key}:${direction}`}
                >
                  {label} · {direction === "desc" ? "descending" : "ascending"}
                </option>
              )),
            )}
          </select>
        </label>
      </div>
      <p id={scrollHintId} className={styles.scrollHint}>
        Scroll for more metrics
      </p>
      <div
        className={styles.scroll}
        role="region"
        aria-label="Market data"
        aria-describedby={`${coverageId} ${scrollHintId}`}
        tabIndex={0}
      >
        <div className={styles.empty} hidden={!empty}>
          <p>
            {data === undefined
              ? "Loading the latest sampled tokens…"
              : filtered
                ? "No matching token in this sample."
                : "No recent tokens match this sample."}
          </p>
          <span>
            Discovery is limited to existing scout coverage. The swap selector
            also supports exact-mint search.
          </span>
          {data !== undefined && filtered && (
            <div className={styles.emptyActions}>
              {search.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    searchInput.current?.focus();
                  }}
                >
                  Clear search
                </button>
              )}
              {(band !== "all" || platform !== "all") && (
                <button type="button" onClick={resetFilters}>
                  Reset filters
                </button>
              )}
            </div>
          )}
        </div>
        <table aria-label="Sampled markets" hidden={empty}>
          <thead>
            <tr>
              <th scope="col" className={styles.tokenColumn}>
                Token
              </th>
              {columns.map(([key, label]) => (
                <th
                  key={key}
                  scope="col"
                  aria-sort={
                    sort.key === key
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  <button
                    type="button"
                    aria-label={`Sort by ${label}`}
                    onClick={() => changeSort(key)}
                  >
                    {label}
                    {sort.key !== key ? (
                      <ArrowUpDown aria-hidden="true" />
                    ) : sort.direction === "desc" ? (
                      <ArrowDown aria-hidden="true" />
                    ) : (
                      <ArrowUp aria-hidden="true" />
                    )}
                  </button>
                </th>
              ))}
              <th scope="col">Observed / source</th>
            </tr>
          </thead>
          <tbody>
            {data !== undefined &&
              markets.map((market) => (
                <MarketDataRow
                  key={market.mint}
                  market={market}
                  selected={selected === market.mint}
                  staleSample={data.stale}
                  onSelect={onSelect}
                  now={now}
                />
              ))}
          </tbody>
        </table>
      </div>
      <div className={styles.coverage}>
        <p role="status">
          {refresh.offline
            ? "Offline · refresh paused"
            : refresh.pending
              ? "Checking shared market cache"
              : refresh.result?.state === "budget"
                ? "Free-data allowance reached · retained rows"
                : refresh.result?.state === "unavailable"
                  ? "Refresh unavailable · retained rows"
                  : refresh.result?.state === "loading"
                    ? "Shared refresh in progress"
                    : "Shared cache · up to 30 mints"}
        </p>
        <details className={styles.coverageDetails}>
          <summary>Coverage &amp; sources</summary>
          <p id={coverageId}>
            {data?.sampledAt
              ? `Sample checked ${new Date(data.sampledAt).toLocaleString()}. ${data.stale ? "The discovery sample is stale; refreshed market fields are dated separately." : "Metrics are source samples, not executable quotes."}`
              : "Scouts refresh on their existing schedules. Empty coverage is not a ranking."}{" "}
            Market fields refresh for up to 30 recent mints while Markets is
            visible, within the shared free-data allowance. Holders retain their
            original scout timestamp. Market cap is not FDV. Sort applies only
            to this sample.
          </p>
        </details>
      </div>
    </section>
  );
}

function MarketDataRow({
  market,
  selected,
  staleSample,
  onSelect,
  now,
}: {
  market: TerminalMarket;
  selected: boolean;
  staleSample: boolean;
  onSelect: (choice: MarketChoice) => void;
  now: number;
}) {
  const sources = marketSources(market, now);
  const observed = sources.market;
  const stale = observed.stale || (!sources.refreshed && staleSample);
  const source = sources.sourceUrl ? safeExternalUrl(sources.sourceUrl) : null;
  const change = market.priceChange1hPercent;
  return (
    <tr data-selected={selected}>
      <td className={styles.tokenColumn}>
        <button
          className={styles.assetChoice}
          type="button"
          aria-label={`View ${market.symbol}, mint ${shortMint(market.mint)}`}
          aria-pressed={selected}
          onClick={() => onSelect(market)}
        >
          <TokenLogo token={market} />
          <span>
            <strong>
              <span className={styles.symbol} title={market.symbol}>
                ${market.symbol}
              </span>
              <small title={market.name}>{market.name}</small>
            </strong>
            <span className={styles.mintLine}>
              <code title={market.mint}>{shortMint(market.mint)}</code>
              {(stale || sources.unavailable) && (
                <span className={styles.stale}>
                  {sources.unavailable ? "Unavailable" : "Stale"}
                </span>
              )}
            </span>
          </span>
        </button>
      </td>
      <NumberCell
        value={market.priceUsd}
        label={marketMoney(market.priceUsd)}
      />
      <td
        className={styles.number}
        title={rawMarketNumber(change)}
        data-direction={
          change == null || !Number.isFinite(change) || change === 0
            ? undefined
            : change > 0
              ? "positive"
              : "negative"
        }
      >
        {formatMarketPercent(change)}
      </td>
      <NumberCell
        value={market.marketCapUsd}
        label={marketMoney(market.marketCapUsd, true)}
      />
      <NumberCell
        value={market.liquidityUsd}
        label={marketMoney(market.liquidityUsd, true)}
      />
      <NumberCell
        value={market.volume1hUsd}
        label={marketMoney(market.volume1hUsd, true)}
      />
      <NumberCell
        value={market.volume24hUsd}
        label={marketMoney(market.volume24hUsd, true)}
      />
      <NumberCell
        value={market.holders}
        label={marketQuantity(market.holders)}
        description={
          sources.refreshed
            ? `${marketQuantity(market.holders)} holders. Original scout sample: ${sources.holders.full}.`
            : undefined
        }
        detail={
          sources.refreshed
            ? `${sources.holders.label}${sources.holders.stale ? " · stale" : ""}`
            : undefined
        }
      />
      <td className={styles.observation}>
        <div>
          {sources.refreshed && <span>Market checked</span>}
          {observed.dateTime ? (
            <time
              dateTime={observed.dateTime}
              title={observed.full}
              aria-label={observed.full}
            >
              {observed.label}
            </time>
          ) : (
            <span>{observed.label}</span>
          )}
          {(stale || sources.unavailable) && (
            <span className={styles.stale}>
              {sources.unavailable ? "Unavailable" : "Stale"}
            </span>
          )}
        </div>
        {source ? (
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${market.symbol} source`}
          >
            Source <ArrowUpRight aria-hidden="true" />
          </a>
        ) : (
          <span className={styles.unavailable}>Source unavailable</span>
        )}
        {sources.refreshed && (
          <div>
            <span>Holder sample</span>
            {sources.holders.dateTime ? (
              <time
                dateTime={sources.holders.dateTime}
                title={sources.holders.full}
                aria-label={`Holder sample: ${sources.holders.full}`}
              >
                {sources.holders.label}
              </time>
            ) : (
              <span>{sources.holders.label}</span>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function NumberCell({
  value,
  label,
  description,
  detail,
}: {
  value: number | null;
  label: string;
  description?: string;
  detail?: string;
}) {
  return (
    <td
      className={styles.number}
      title={value != null && value >= 0 ? rawMarketNumber(value) : undefined}
      data-unavailable={label === "Unavailable"}
      aria-label={description}
    >
      {label}
      {detail && (
        <small className="block text-xs text-muted-foreground">{detail}</small>
      )}
    </td>
  );
}
