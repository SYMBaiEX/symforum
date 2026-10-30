"use client";

import { useId, useState } from "react";
import { useQuery } from "convex/react";
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
import type { TerminalMarket } from "@/lib/forum-terminal-model";
import { TokenLogo, symfChoice, type MarketChoice } from "./market-panel";
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
  marketObservation,
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
  function changeSort(key: MarketSortKey) {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  }
  return (
    <section className={styles.explorer} aria-label="Sampled token discovery">
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search aria-hidden="true" />
          <Input
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
      <div
        className={styles.scroll}
        role="region"
        aria-label="Market data"
        aria-describedby={coverageId}
        tabIndex={0}
      >
        <table aria-label="Sampled markets">
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
            {data === undefined || !markets.length ? (
              <tr>
                <td colSpan={9} className={styles.empty}>
                  <p role="status">
                    {data === undefined
                      ? "Loading the latest sampled tokens…"
                      : search
                        ? "No matching token in this sample."
                        : "No recent tokens match this sample."}
                  </p>
                  <span>
                    Discovery is limited to existing scout coverage. The swap
                    selector also supports exact-mint search.
                  </span>
                </td>
              </tr>
            ) : (
              markets.map((market) => (
                <MarketDataRow
                  key={market.mint}
                  market={market}
                  selected={selected === market.mint}
                  staleSample={data.stale}
                  onSelect={onSelect}
                  now={now}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      <p id={coverageId} className={styles.coverage} role="status">
        {data?.sampledAt
          ? `Sample checked ${new Date(data.sampledAt).toLocaleString()}. ${data.stale ? "The retained sample is stale." : "Metrics are source samples, not executable quotes."}`
          : "Scouts refresh on their existing schedules. Empty coverage is not a ranking."}{" "}
        Market cap is not FDV. Sort applies only to this sample.
      </p>
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
  const observed = marketObservation(market.metricsAsOf, now);
  const source = safeExternalUrl(market.sourceUrl);
  const change = market.priceChange1hPercent;
  return (
    <tr data-selected={selected}>
      <td className={styles.tokenColumn}>
        <button
          className={styles.tokenButton}
          type="button"
          aria-label={`View ${market.symbol}, mint ${shortMint(market.mint)}`}
          aria-pressed={selected}
          onClick={() => onSelect(market)}
        >
          <TokenLogo token={market} />
          <span>
            <strong>
              ${market.symbol}
              <small title={market.name}>{market.name}</small>
            </strong>
            <code title={market.mint}>{shortMint(market.mint)}</code>
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
      />
      <td className={styles.observation}>
        <div>
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
          {(staleSample || observed.stale) && (
            <span className={styles.stale}>Stale</span>
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
      </td>
    </tr>
  );
}

function NumberCell({ value, label }: { value: number | null; label: string }) {
  return (
    <td
      className={styles.number}
      title={value != null && value >= 0 ? rawMarketNumber(value) : undefined}
      data-unavailable={label === "Unavailable"}
    >
      {label}
    </td>
  );
}
