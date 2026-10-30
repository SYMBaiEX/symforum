"use client";

import Image from "next/image";
import { useState } from "react";
import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  MARKET_CAP_BANDS,
  isMarketCapBand,
  type MarketCapBand,
} from "@/lib/forum-market-cap";
import type { TerminalMarket } from "@/lib/forum-terminal-model";
import { SYMF_TOKEN } from "@/lib/symf-token";
import { terminalApi } from "./terminal-api";
import {
  marketMoney,
  safeExternalUrl,
  searchMarkets,
  shortMint,
} from "./terminal-format";
import styles from "./forum-terminal.module.css";

export type MarketChoice = {
  mint: string;
  symbol: string;
  name: string;
  imageUrl?: string | null;
};
export const symfChoice: MarketChoice = {
  mint: SYMF_TOKEN.mint,
  symbol: SYMF_TOKEN.symbol,
  name: SYMF_TOKEN.name,
  imageUrl: "/images/brand/symforum-icon-64.png",
};

export function TokenLogo({ token }: { token: MarketChoice }) {
  const [failed, setFailed] = useState(false);
  const src = token.imageUrl?.startsWith("/images/")
    ? token.imageUrl
    : safeExternalUrl(token.imageUrl);
  return (
    <span className={styles.logo} aria-hidden="true">
      {src && !failed ? (
        <Image
          unoptimized
          src={src}
          alt=""
          width={40}
          height={40}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        token.symbol.slice(0, 2)
      )}
    </span>
  );
}

export function MarketPanel({
  selected,
  onSelect,
  now,
}: {
  selected: string;
  onSelect: (token: MarketChoice) => void;
  now: number;
}) {
  const [search, setSearch] = useState("");
  const [band, setBand] = useState<MarketCapBand>("all");
  const [platform, setPlatform] = useState<"all" | "bags" | "pumpfun">("all");
  const data = useQuery(terminalApi.listMarket, {
    band,
    ...(platform === "all" ? {} : { platform }),
    now,
    limit: 60,
  });
  const markets = searchMarkets(data?.markets ?? [], search);
  return (
    <section
      className={`${styles.panel} ${styles.discovery}`}
      aria-labelledby="terminal-discovery-title"
    >
      <header className={styles.panelHead}>
        <div>
          <h2 id="terminal-discovery-title">Markets</h2>
          <p>Scout samples, not a market-wide ranking.</p>
        </div>
      </header>
      <div className={styles.filters}>
        <div className={styles.search}>
          <Search aria-hidden="true" />
          <Input
            aria-label="Search sampled tokens"
            placeholder="Name, ticker or mint"
            maxLength={64}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <label>
          Market cap
          <select
            className={`${styles.select} focus-ring`}
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
          Platform
          <select
            className={`${styles.select} focus-ring`}
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
      {!search && band === "all" && platform === "all" && (
        <div className="px-2 pt-2">
          <button
            type="button"
            className={`${styles.marketButton} focus-ring`}
            aria-pressed={selected === symfChoice.mint}
            onClick={() => onSelect(symfChoice)}
          >
            <TokenLogo token={symfChoice} />
            <span className={styles.marketText}>
              <strong>${symfChoice.symbol}</strong>
              <small>SYMBaiEX Forum token</small>
            </span>
          </button>
        </div>
      )}
      {data === undefined ? (
        <p role="status" className={styles.empty}>
          Loading the latest sampled tokens…
        </p>
      ) : !markets.length ? (
        <p role="status" className={styles.empty}>
          {search
            ? "No matching token in this sample. The swap selector supports exact-mint search."
            : "No recent tokens match this sample. The swap selector supports exact-mint search."}
        </p>
      ) : (
        <ul className={styles.marketList} aria-label="Sampled tokens">
          {markets.map((market) => (
            <li key={market.mint}>
              <MarketRow
                market={market}
                selected={selected === market.mint}
                onSelect={onSelect}
                now={now}
              />
            </li>
          ))}
        </ul>
      )}
      <p className={styles.source} role="status">
        {data?.sampledAt
          ? `Sampled ${new Date(data.sampledAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}. ${data.stale ? "Data is stale; do not treat it as a current quote." : "Metrics can change before a trade."}`
          : "Scouts refresh on their existing schedules. Empty coverage is not a ranking."}{" "}
        Market cap is not FDV.
      </p>
    </section>
  );
}

function MarketRow({
  market,
  selected,
  onSelect,
  now,
}: {
  market: TerminalMarket;
  selected: boolean;
  onSelect: (token: MarketChoice) => void;
  now: number;
}) {
  return (
    <button
      type="button"
      className={`${styles.marketButton} focus-ring`}
      aria-pressed={selected}
      onClick={() => onSelect(market)}
      aria-label={`View ${market.symbol}, mint ${shortMint(market.mint)}`}
    >
      <TokenLogo token={market} />
      <span className={styles.marketText}>
        <strong>${market.symbol}</strong>
        <small>{market.name}</small>
        <span className={styles.marketNumbers}>
          <span title="Actual market capitalization">
            {marketMoney(market.marketCapUsd, true)}
          </span>
          <span title="One-hour volume">
            {marketMoney(market.volume1hUsd, true)}
          </span>
        </span>
        <small>
          {market.platform === "bags"
            ? "Bags.fm"
            : market.platform === "pumpfun"
              ? "Pump.fun"
              : "Solana"}
          {now - market.metricsAsOf > 15 * 60_000 ? " · stale sample" : ""}
        </small>
      </span>
    </button>
  );
}
