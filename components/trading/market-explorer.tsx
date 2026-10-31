"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefCallback,
  type RefObject,
} from "react";
import { useAction, useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Check,
  Copy,
  Search,
  X,
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
import { isSolanaAddress } from "@/lib/forum-commerce";
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
  MARKET_REFRESH_INTERVAL_MS,
  marketRefreshRetryAt,
  marketSources,
  rawMarketNumber,
  sortMarketRows,
  type MarketSortDirection,
  type MarketSortKey,
} from "./market-explorer-model";
import styles from "./market-explorer.module.css";
import { marketEligibility, marketSampleView } from "./market-sample-view";

const columns = [
  ["price", "Price"],
  ["change1h", "1h change"],
  ["marketCap", "Market cap"],
  ["liquidity", "Liquidity"],
  ["volume1h", "1h volume"],
  ["volume24h", "24h volume"],
  ["holders", "Holders"],
] as const;

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
          nextAttemptAt.current = marketRefreshRetryAt(
            value,
            Date.now(),
            nextAttemptAt.current,
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
  const [copyMessage, setCopyMessage] = useState("");
  const [freshOnly, setFreshOnly] = useState(false);
  const [viewAnnouncement, setViewAnnouncement] = useState({
    pending: false,
    text: "",
  });
  const [band, setBand] = useState<MarketCapBand>("all");
  const [platform, setPlatform] = useState<"all" | "bags" | "pumpfun">("all");
  const [sort, setSort] = useState<{
    key: MarketSortKey;
    direction: MarketSortDirection;
  }>({ key: "volume1h", direction: "desc" });
  const coverageId = useId();
  const scrollHintId = useId();
  const freshnessHintId = useId();
  const root = useRef<HTMLElement>(null);
  const refresh = useVisibleMarketRefresh(root);
  const searchInput = useRef<HTMLInputElement>(null);
  const freshControl = useRef<HTMLButtonElement>(null);
  const rowFocusRef = useCallback<RefCallback<HTMLTableRowElement>>((row) => {
    if (!row) return;
    return () => {
      const control = freshControl.current;
      if (
        row.contains(document.activeElement) &&
        root.current?.isConnected &&
        control?.isConnected &&
        control.getClientRects().length &&
        getComputedStyle(control).visibility === "visible"
      ) {
        control.focus({ preventScroll: true });
      }
    };
  }, []);
  const data = useQuery(terminalApi.listMarket, {
    band,
    ...(platform === "all" ? {} : { platform }),
    now,
    limit: 60,
  });
  const exactMint = isSolanaAddress(search.trim()) ? search.trim() : null;
  const matchingRows = exactMint
    ? (data?.markets ?? []).filter((market) => market.mint === exactMint)
    : searchMarkets(data?.markets ?? [], search);
  const sampleView = marketSampleView(matchingRows, now, freshOnly);
  const markets = sortMarketRows(sampleView.rows, sort.key, sort.direction);
  const filtered =
    search.trim().length > 0 ||
    band !== "all" ||
    platform !== "all" ||
    freshOnly;
  const empty = data === undefined || markets.length === 0;
  const eligibility = marketEligibility(refresh.result?.nextRefreshAt);
  // Consume a deliberate control change once loaded, not on later clock/data updates.
  if (viewAnnouncement.pending && data !== undefined) {
    const sortLabel = columns.find(([key]) => key === sort.key)![1];
    setViewAnnouncement({
      pending: false,
      text: `${markets.length} sampled ${markets.length === 1 ? "token" : "tokens"} · ${sortLabel} ${sort.direction === "asc" ? "ascending" : "descending"}.`,
    });
  }
  function announceViewChange() {
    setViewAnnouncement({ pending: true, text: "Updating sampled results…" });
  }
  function clearSearch() {
    setSearch("");
    announceViewChange();
    searchInput.current?.focus();
  }
  async function copyMint(mint: string) {
    try {
      await navigator.clipboard.writeText(mint);
      setCopyMessage("Exact mint copied.");
    } catch {
      setCopyMessage(`Could not copy mint. Copy it manually: ${mint}`);
    }
  }
  function resetFilters() {
    setSearch("");
    setBand("all");
    setPlatform("all");
    setFreshOnly(false);
    announceViewChange();
    searchInput.current?.focus();
  }
  function changeSort(key: MarketSortKey) {
    announceViewChange();
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
            onChange={(event) => {
              setSearch(event.target.value);
              announceViewChange();
            }}
          />
        </div>
        {search.length > 0 && (
          <button
            type="button"
            className="focus-ring inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-border"
            aria-label="Clear search"
            title="Clear search only"
            onClick={clearSearch}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
        <label>
          <span>Market cap</span>
          <select
            value={band}
            onChange={(event) => {
              if (isMarketCapBand(event.target.value)) {
                setBand(event.target.value);
                announceViewChange();
              }
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
              if (value === "all" || value === "bags" || value === "pumpfun") {
                setPlatform(value);
                announceViewChange();
              }
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
        <p>
          <strong>
            {data === undefined
              ? "Loading sample"
              : `${markets.length} ${markets.length === 1 ? "token" : "tokens"}`}
          </strong>
          <span>
            {freshOnly && data !== undefined
              ? `${sampleView.excluded} excluded · market age only`
              : "Sampled data"}
          </span>
        </p>
        <button
          ref={freshControl}
          type="button"
          className={styles.freshOnly}
          aria-label="Fresh market rows only"
          aria-pressed={freshOnly}
          aria-describedby={freshnessHintId}
          onClick={() => {
            setFreshOnly((value) => !value);
            announceViewChange();
          }}
        >
          {freshOnly && <Check aria-hidden="true" />}
          Fresh market only
        </button>
        <label className={styles.sortControl}>
          <span>Sort</span>
          <select
            aria-label="Sort sampled tokens"
            value={`${sort.key}:${sort.direction}`}
            onChange={(event) => {
              const [key, direction] = event.target.value.split(":");
              const column = columns.find(([value]) => value === key);
              if (column && (direction === "asc" || direction === "desc")) {
                setSort({ key: column[0], direction });
                announceViewChange();
              }
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
      <p
        role="status"
        aria-live="polite"
        aria-label="Market view updates"
        className="sr-only"
      >
        {viewAnnouncement.text}
      </p>
      <p
        role="status"
        className={copyMessage ? "break-all px-3 py-1 text-xs" : "sr-only"}
      >
        {copyMessage}
      </p>
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
              {exactMint && (
                <button
                  type="button"
                  className="focus-ring"
                  onClick={() =>
                    onSelect({
                      mint: exactMint,
                      symbol: "TOKEN",
                      name: "Selected Solana token",
                    })
                  }
                >
                  View exact mint
                </button>
              )}
              {(band !== "all" || platform !== "all" || freshOnly) && (
                <button type="button" onClick={resetFilters}>
                  Reset filters
                </button>
              )}
            </div>
          )}
          {data !== undefined && exactMint && (
            <p className="mt-2 text-xs">
              Address format only; token identity and market data are not
              verified.
            </p>
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
                  rowFocusRef={rowFocusRef}
                  market={market}
                  selected={selected === market.mint}
                  staleSample={data.stale}
                  onSelect={onSelect}
                  onCopy={copyMint}
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
                  : refresh.result?.state === "deferred"
                    ? "Waiting for shared data window"
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
          {data !== undefined && (
            <p>
              Within {matchingRows.length} loaded matches: {sampleView.fresh}{" "}
              fresh, {sampleView.stale} stale, {sampleView.unknown} unavailable
              or undated.
            </p>
          )}
          <p id={freshnessHintId}>
            Only known fresh market observations qualify. Holder age does not
            decide this filter. Stale, unavailable and undated rows are excluded
            while enabled. This filter does not fetch data.
          </p>
          <p>
            {eligibility ? (
              <>
                Server eligibility:{" "}
                <time dateTime={eligibility}>{eligibility}</time>.
              </>
            ) : (
              "Server eligibility time unavailable."
            )}{" "}
            Eligibility is not a scheduled or guaranteed refresh. Visible online
            demand and shared allowances still apply.
          </p>
        </details>
      </div>
    </section>
  );
}

function MarketDataRow({
  rowFocusRef,
  market,
  selected,
  staleSample,
  onSelect,
  onCopy,
  now,
}: {
  rowFocusRef: RefCallback<HTMLTableRowElement>;
  market: TerminalMarket;
  selected: boolean;
  staleSample: boolean;
  onSelect: (choice: MarketChoice) => void;
  onCopy: (mint: string) => Promise<void>;
  now: number;
}) {
  const sources = marketSources(market, now);
  const observed = sources.market;
  const stale = observed.stale || (!sources.refreshed && staleSample);
  const source = sources.sourceUrl ? safeExternalUrl(sources.sourceUrl) : null;
  const change = market.priceChange1hPercent;
  return (
    <tr ref={rowFocusRef} data-selected={selected}>
      <td className={styles.tokenColumn}>
        <div className="flex min-w-0 items-center gap-1">
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
          <button
            type="button"
            className="focus-ring inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md"
            aria-label={`Copy exact mint for ${market.symbol}, ${market.mint}`}
            title={`Copy exact mint: ${market.mint}`}
            onClick={() => void onCopy(market.mint)}
          >
            <Copy size={14} aria-hidden="true" />
          </button>
        </div>
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
            aria-label={`View ${market.symbol} source, mint ${market.mint}`}
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
