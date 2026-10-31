"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { useTheme } from "next-themes";
import { Copy, Check, ArrowUpRight, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SYMF_TOKEN } from "@/lib/symf-token";
import { ForumLink } from "@/components/forum/forum-link";
import { terminalApi } from "./terminal-api";
import { TokenPriceChart } from "./price-chart";
import type { ChartMarketData } from "./price-chart-data";
import { TokenLogo, type MarketChoice } from "./market-identity";
import {
  formatMarketPercent,
  marketObservation,
  marketSources,
  rawMarketNumber,
} from "./market-explorer-model";
import {
  marketMoney,
  marketQuantity,
  safeExternalUrl,
  shortMint,
  riskIsStale,
  riskRefreshMessage,
} from "./terminal-format";
import styles from "./forum-terminal.module.css";

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

export function TokenDetail({
  token,
  now,
  onBrowseMarkets,
}: {
  token: MarketChoice;
  now: number;
  onBrowseMarkets?: () => void;
}) {
  const indexed = useQuery(terminalApi.getMarket, { mint: token.mint, now });
  const market = indexed && indexed.mint !== token.mint ? null : indexed;
  const sources = market ? marketSources(market, now) : null;
  const marketData = market?.marketData;
  const displayToken =
    token.symbol === "TOKEN" && market
      ? {
          ...token,
          symbol: market.symbol,
          name: market.name,
          imageUrl: market.imageUrl,
        }
      : token;
  const { resolvedTheme } = useTheme();
  const [copy, setCopy] = useState<"copied" | "failed" | null>(null);
  const copyRevision = useRef({ value: 0 });
  const projectMetadataId = useId();
  // Invalidate before paint, including when returning to an earlier mint.
  useLayoutEffect(() => {
    const revision = copyRevision.current;
    revision.value++;
    setCopy(null);
    return () => {
      revision.value++;
    };
  }, [token.mint]);
  const [liveMarket, setLiveMarket] = useState<ChartMarketData | null>(null);
  async function copyMint() {
    const revision = copyRevision.current;
    const attempt = ++revision.value;
    setCopy(null);
    try {
      await navigator.clipboard.writeText(token.mint);
      if (attempt === revision.value) setCopy("copied");
    } catch {
      if (attempt === revision.value) setCopy("failed");
    }
  }
  const fresh =
    liveMarket?.mint === token.mint &&
    !liveMarket.stale &&
    now - liveMarket.checkedAt <= 180_000
      ? liveMarket
      : null;
  const sampleSource = {
    label: marketData
      ? "Refreshed market sample"
      : market
        ? "Indexed market sample"
        : "Market source unavailable",
    observation: sources?.market,
    url: safeExternalUrl(sources?.sourceUrl),
    unavailable: sources?.unavailable ?? false,
  };
  const priceSource = fresh
    ? {
        label: "Chart market response (provider not supplied)",
        observation: marketObservation(fresh.checkedAt, now),
        url: null,
        unavailable: false,
      }
    : sampleSource;
  const holderSource = {
    label: market ? "Original holder sample" : "Holder source unavailable",
    observation: sources?.holders,
    url: safeExternalUrl(market?.sourceUrl),
    unavailable: false,
  };
  // The compact display and inspection share these exact selected values.
  // A checked chart response never replaces holder or one-hour samples.
  const readings = [
    {
      label: "Price",
      value: fresh ? fresh.priceUsd : market?.priceUsd,
      unit: "USD",
      source: priceSource,
    },
    {
      label: "Market cap",
      value: fresh ? fresh.stats?.marketCap : market?.marketCapUsd,
      unit: "USD",
      source: priceSource,
    },
    {
      label: "Liquidity",
      value: fresh ? fresh.stats?.liquidity : market?.liquidityUsd,
      unit: "USD",
      source: priceSource,
    },
    {
      label: "1h volume",
      value: market?.volume1hUsd,
      unit: "USD",
      source: sampleSource,
    },
    {
      label: "FDV",
      value: fresh ? fresh.stats?.fdv : market?.fdvUsd,
      unit: "USD",
      source: priceSource,
    },
    {
      label: "Holders",
      value: market?.holders,
      unit: "addresses",
      source: holderSource,
    },
    {
      label: "24h volume",
      value: fresh ? fresh.stats?.volume24h : market?.volume24hUsd,
      unit: "USD",
      source: priceSource,
    },
    {
      label: "1h change",
      value: market?.priceChange1hPercent,
      unit: "%",
      source: sampleSource,
    },
  ];
  const metrics = readings.map(({ label, value, unit }) => [
    label,
    unit === "addresses"
      ? marketQuantity(value)
      : unit === "%"
        ? formatMarketPercent(value)
        : marketMoney(value, label !== "Price"),
  ]);
  const links = [
    ["Website", market?.website],
    ["X", market?.twitter],
    ["Telegram", market?.telegram],
    ["Market source", sources?.sourceUrl],
  ].flatMap(([label, url]) => {
    const href = safeExternalUrl(url);
    return href ? [{ label, href }] : [];
  });
  const discussionPath =
    (market?.threadUrl ? safeForumThread(market.threadUrl) : null) ??
    (token.mint === SYMF_TOKEN.mint
      ? safeForumThread(SYMF_TOKEN.announcementPath)
      : null);
  return (
    <section
      className={styles.tokenSurface}
      aria-labelledby="terminal-token-title"
    >
      <div className={styles.tokenHead}>
        <div className={styles.tokenTop}>
          <div className={styles.identity}>
            <TokenLogo key={token.mint} token={displayToken} />
            <div>
              <h2 id="terminal-token-title">
                {displayToken.symbol === "TOKEN"
                  ? "Selected token"
                  : `$${displayToken.symbol}`}
              </h2>
              <p>
                <span className={styles.tokenName}>{displayToken.name}</span>
                <span className={styles.tokenMint} title={token.mint}>
                  {shortMint(token.mint)}
                </span>
              </p>
            </div>
            <button
              className={`${styles.iconButton} focus-ring`}
              type="button"
              aria-label="Copy selected token mint"
              onClick={() => void copyMint()}
            >
              {copy === "copied" ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
            </button>
          </div>
          <div className={styles.mint}>
            <span className="sr-only">Mint</span>
            <code title={token.mint}>{token.mint}</code>
          </div>
          <dl className={styles.price}>
            <div>
              <dt>
                {metrics[0][0]} <span>USD</span>
              </dt>
              <dd data-unavailable={metrics[0][1] === "Unavailable"}>
                {metrics[0][1]}
              </dd>
            </div>
          </dl>
        </div>
        <span
          role="status"
          className={copy === "failed" ? styles.copyStatus : "sr-only"}
        >
          {copy === "copied"
            ? "Mint copied."
            : copy === "failed"
              ? "Copy unavailable. The full mint is in Market details & sources."
              : ""}
        </span>
        <dl className={styles.topMetrics}>
          {[metrics[1], metrics[2], metrics[6], metrics[7]].map(
            ([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd
                  data-unavailable={value === "Unavailable"}
                  data-change={
                    label === "1h change" &&
                    market?.priceChange1hPercent != null
                      ? market.priceChange1hPercent > 0
                        ? "up"
                        : market.priceChange1hPercent < 0
                          ? "down"
                          : undefined
                      : undefined
                  }
                >
                  {value}
                </dd>
              </div>
            ),
          )}
        </dl>
        <p className={styles.marketStatus} role="status">
          {fresh
            ? "Checked market data"
            : sources?.refreshed
              ? sources.unavailable
                ? "Market fields unavailable"
                : "Checked market sample"
              : "Indexed market sample"}
          {market
            ? market.priceChange1hPercent == null
              ? " · 1h change unavailable"
              : sources?.market.stale
                ? " · 1h change is a stale sample"
                : " · 1h sampled"
            : " · 1h change unavailable"}
          . Not a quote.
        </p>
      </div>
      <TokenPriceChart
        compact
        key={token.mint}
        mint={token.mint}
        symbol={displayToken.symbol}
        light={resolvedTheme === "light"}
        onMarket={setLiveMarket}
        onBrowseMarkets={onBrowseMarkets}
      />
      <details className={styles.marketDetails}>
        <summary className="focus-ring">Market details &amp; sources</summary>
        <div className={styles.body}>
          <p className={styles.fullMint}>
            <span>Mint</span> <code>{token.mint}</code>
          </p>
          <dl className={styles.metrics}>
            {[metrics[3], metrics[4], metrics[5]].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd data-unavailable={value === "Unavailable"}>{value}</dd>
              </div>
            ))}
            {[metrics[6], metrics[7]].map(([label, value]) => (
              <div key={label} className={styles.compactExtraMetric}>
                <dt>{label}</dt>
                <dd data-unavailable={value === "Unavailable"}>{value}</dd>
              </div>
            ))}
          </dl>
          <details
            className={styles.metricGlossary}
            aria-label="Selected metric inspection"
          >
            <summary className="focus-ring">
              Inspect values &amp; observation times
            </summary>
            <p>
              Unabridged returned values for this mint; no extra precision or
              estimates added. Observation times belong to each source, not to
              when this panel was opened. Not an executable quote.
            </p>
            <ul className="m-0 grid min-w-0 list-none gap-3 p-0">
              {readings.map(({ label, value, unit, source }) => {
                const number = rawMarketNumber(value);
                const dateTime = source.observation?.dateTime;
                return (
                  <li key={label} aria-label={`${label} reading`}>
                    <strong>{label}</strong>{" "}
                    <span>
                      {number === undefined
                        ? "Unavailable"
                        : `${number} ${unit}`}
                    </span>
                    <p>
                      {source.label}.{" "}
                      {dateTime ? (
                        <time dateTime={dateTime}>{dateTime} (UTC)</time>
                      ) : (
                        "Observation time unavailable"
                      )}
                      {source.unavailable
                        ? " · Source data unavailable"
                        : source.observation?.stale
                          ? " · Stale sample"
                          : ""}
                      {source.url && (
                        <>
                          {" "}
                          ·{" "}
                          <a
                            href={source.url}
                            {...external}
                            aria-label={`${label} sample source for ${token.mint}`}
                            className="focus-ring underline"
                          >
                            Sample source
                          </a>
                        </>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          </details>
          <details className={styles.metricGlossary}>
            <summary className="focus-ring">What these metrics mean</summary>
            <dl>
              <div>
                <dt>Market cap</dt>
                <dd>Source-reported value of circulating supply. Not FDV.</dd>
              </div>
              <div>
                <dt>FDV</dt>
                <dd>
                  Source-reported fully diluted valuation. Not circulating
                  market cap.
                </dd>
              </div>
              <div>
                <dt>Liquidity</dt>
                <dd>
                  Source-reported pool liquidity, not a guarantee of executable
                  depth or the amount you can trade.
                </dd>
              </div>
              <div>
                <dt>Holders</dt>
                <dd>
                  Addresses in the original holder sample, not verified people.
                  A fresh price does not refresh this sample.
                </dd>
              </div>
              <div>
                <dt>1h / 24h volume</dt>
                <dd>
                  Source-reported USD trading volume over one-hour and 24-hour
                  windows. Source coverage and observation times can differ from
                  the chart.
                </dd>
              </div>
            </dl>
            <p>
              Missing values remain unavailable. Definitions do not refresh or
              verify metrics. Only a fresh swap quote is executable.
            </p>
          </details>
        </div>
        <div className={styles.source} role="status">
          {fresh
            ? `Price, market cap, FDV, liquidity and 24h volume checked ${new Date(fresh.checkedAt).toLocaleString()}. `
            : marketData
              ? `Market fields checked ${new Date(marketData.checkedAt).toLocaleString()}. ${sources?.unavailable ? "No supported pool data was available. " : sources?.market.stale ? "Stale checked market fields. " : ""}`
              : "Price, cap, FDV, liquidity and 24h volume use the indexed sample until a fresh checked market response arrives. "}
          {market
            ? marketData
              ? `1h volume/change checked ${new Date(marketData.checkedAt).toLocaleString()}. Holders sampled ${new Date(market.metricsAsOf).toLocaleString()}. ${sources?.holders.stale ? "Stale holder sample." : ""}`
              : `Holders and 1h volume/change sampled ${new Date(market.metricsAsOf).toLocaleString()}. ${now - market.metricsAsOf > 15 * 60_000 ? "Stale sampled metrics." : ""}`
            : market === undefined
              ? "Loading the indexed snapshot…"
              : "No indexed snapshot for this token. No estimates substituted."}{" "}
          Chart and sampled metrics can use different observation times. Only a
          fresh swap quote is executable.
        </div>
        <div className={styles.body}>
          <a
            href={`https://solscan.io/token/${encodeURIComponent(token.mint)}`}
            {...external}
            className={styles.headerLink}
          >
            Token explorer{" "}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
          {market?.description && (
            <p className={styles.muted}>{market.description}</p>
          )}
          {links.some((link) => link.label !== "Market source") && (
            <p id={projectMetadataId} className={styles.muted}>
              Website and social links are unverified project metadata, not
              endorsements.
            </p>
          )}
          <div className={styles.links}>
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                {...external}
                aria-describedby={
                  link.label === "Market source" ? undefined : projectMetadataId
                }
              >
                {link.label}
                <ArrowUpRight aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>
      </details>
      <div className={styles.discussionBar}>
        <span>From the forum</span>
        {discussionPath ? (
          <ForumLink href={discussionPath} className="focus-ring">
            Read the token discussion{" "}
            <ArrowUpRight size={14} aria-hidden="true" />
          </ForumLink>
        ) : (
          <ForumLink href="/forum/crypto" className="focus-ring">
            Browse Web3 discussions{" "}
            <ArrowUpRight size={14} aria-hidden="true" />
          </ForumLink>
        )}
      </div>
    </section>
  );
}

function safeForumThread(value: string) {
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"))
    return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["forum.symbaiex.com", "www.symbaiex.com"].includes(url.hostname)
      ? `${url.pathname}${url.hash}`
      : null;
  } catch {
    return null;
  }
}

export function RiskPanel({
  mint,
  wallet,
  now,
}: {
  mint: string;
  wallet: string | null;
  now: number;
}) {
  const risk = useQuery(terminalApi.getRisk, { mint });
  const refresh = useAction(terminalApi.refreshRisk);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function check() {
    if (!wallet || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await refresh({ wallet, mint });
      setMessage(riskRefreshMessage(result));
    } catch {
      setMessage(
        "Mint facts could not be refreshed. No wallet request was made.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-labelledby="terminal-risk-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="terminal-risk-title">Mint facts</h2>
          <p>Checked facts, not a safety score.</p>
        </div>
        <Shield className="size-4 text-muted-foreground" aria-hidden="true" />
      </header>
      <div className={styles.body}>
        {risk ? (
          <>
            {riskIsStale(risk.checkedAt, now) && (
              <p role="status" className={`${styles.warning} mb-4`}>
                These mint facts are stale. They describe the recorded check,
                not the mint’s current state.
              </p>
            )}
            <dl className={styles.metrics}>
              <div>
                <dt>Mint authority</dt>
                <dd>
                  {risk.mintAuthority ? "Present at check" : "Not set at check"}
                </dd>
              </div>
              <div>
                <dt>Freeze authority</dt>
                <dd>
                  {risk.freezeAuthority
                    ? "Present at check"
                    : "Not set at check"}
                </dd>
              </div>
            </dl>
            <p className={`${styles.muted} mt-4`}>
              Token program{" "}
              <code title={risk.tokenProgram}>
                {shortMint(risk.tokenProgram)}
              </code>
              . Checked {new Date(risk.checkedAt).toLocaleString()}.
            </p>
            {risk.unsupportedExtensions.length > 0 && (
              <p className={styles.warning}>
                Unsupported transfer-changing extensions:{" "}
                {risk.unsupportedExtensions.join(", ")}. Trading may be
                unavailable.
              </p>
            )}
          </>
        ) : (
          <p className={styles.muted}>
            {risk === undefined
              ? "Loading checked mint facts…"
              : "No recent mint facts are cached. Missing data does not mean the token is safe."}
          </p>
        )}
        <p className={`${styles.muted} mt-3`}>
          Holder concentration, liquidity locks, team identity and contract risk
          are not audited here. A revoked authority is not an endorsement.
        </p>
        {wallet && (
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void check()}
            disabled={busy}
          >
            {busy ? "Checking…" : "Refresh mint facts"}
          </Button>
        )}
        {!wallet && (
          <p className={`${styles.muted} mt-3`}>
            Link a wallet to request an on-chain refresh within the shared data
            allowance.
          </p>
        )}
        <p role="status" className={`${styles.muted} mt-2`}>
          {message}
        </p>
      </div>
    </section>
  );
}
