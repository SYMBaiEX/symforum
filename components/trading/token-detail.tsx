"use client";

import { useState } from "react";
import { useQuery, useAction } from "convex/react";
import { useTheme } from "next-themes";
import { Copy, Check, ArrowUpRight, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ForumLink } from "@/components/forum/forum-link";
import { terminalApi } from "./terminal-api";
import { TokenPriceChart } from "./price-chart";
import type { ChartMarketData } from "./price-chart-data";
import { TokenLogo, type MarketChoice } from "./market-panel";
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
}: {
  token: MarketChoice;
  now: number;
}) {
  const market = useQuery(terminalApi.getMarket, { mint: token.mint, now });
  const { resolvedTheme } = useTheme();
  const [copy, setCopy] = useState<"copied" | "failed" | null>(null);
  const [liveMarket, setLiveMarket] = useState<ChartMarketData | null>(null);
  async function copyMint() {
    try {
      await navigator.clipboard.writeText(token.mint);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }
  const fresh =
    liveMarket?.mint === token.mint &&
    !liveMarket.stale &&
    now - liveMarket.checkedAt <= 180_000
      ? liveMarket
      : null;
  const metrics = [
    ["Price", marketMoney(fresh ? fresh.priceUsd : market?.priceUsd)],
    [
      "Market cap",
      marketMoney(fresh ? fresh.stats?.marketCap : market?.marketCapUsd, true),
    ],
    [
      "Liquidity",
      marketMoney(fresh ? fresh.stats?.liquidity : market?.liquidityUsd, true),
    ],
    ["1h volume", marketMoney(market?.volume1hUsd, true)],
    ["FDV", marketMoney(fresh ? fresh.stats?.fdv : market?.fdvUsd, true)],
    ["Holders", marketQuantity(market?.holders)],
    [
      "24h volume",
      marketMoney(fresh ? fresh.stats?.volume24h : market?.volume24hUsd, true),
    ],
    [
      "1h change",
      market?.priceChange1hPercent == null
        ? "Unavailable"
        : `${market.priceChange1hPercent > 0 ? "+" : ""}${market.priceChange1hPercent.toFixed(2)}%`,
    ],
  ];
  const links = [
    ["Website", market?.website],
    ["X", market?.twitter],
    ["Telegram", market?.telegram],
    ["Market source", market?.sourceUrl],
  ].flatMap(([label, url]) => {
    const href = safeExternalUrl(url);
    return href ? [{ label, href }] : [];
  });
  return (
    <section className={styles.panel} aria-labelledby="terminal-token-title">
      <div className={styles.tokenHead}>
        <div className={styles.tokenTop}>
          <div className={styles.identity}>
            <TokenLogo key={token.mint} token={token} />
            <div>
              <h2 id="terminal-token-title">${token.symbol}</h2>
              <p>{token.name}</p>
            </div>
          </div>
          <a
            href={`https://solscan.io/token/${encodeURIComponent(token.mint)}`}
            {...external}
            className={styles.headerLink}
          >
            Explorer
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </a>
        </div>
        <div className={styles.mint}>
          <span>Mint</span>
          <code>{token.mint}</code>
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
          <span
            role="status"
            className={copy === "failed" ? styles.muted : "sr-only"}
          >
            {copy === "copied"
              ? "Mint copied."
              : copy === "failed"
                ? "Select the mint above to copy it."
                : ""}
          </span>
        </div>
        <dl className={styles.metrics}>
          {metrics.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd data-unavailable={value === "Unavailable"}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <TokenPriceChart
        key={token.mint}
        mint={token.mint}
        symbol={token.symbol}
        light={resolvedTheme === "light"}
        onMarket={setLiveMarket}
      />
      <div className={styles.source} role="status">
        {fresh
          ? `Price, market cap, FDV, liquidity and 24h volume checked ${new Date(fresh.checkedAt).toLocaleString()}. `
          : "Price, cap, FDV, liquidity and 24h volume use the indexed sample until a fresh checked market response arrives. "}
        {market
          ? `Holders and 1h volume/change sampled ${new Date(market.metricsAsOf).toLocaleString()}. ${now - market.metricsAsOf > 15 * 60_000 ? "Stale sampled metrics." : ""}`
          : market === undefined
            ? "Loading the indexed snapshot…"
            : "No indexed snapshot for this token. No estimates substituted."}{" "}
        Chart and sampled metrics can use different observation times. Only a
        fresh swap quote is executable.
      </div>
      <div className={styles.body}>
        {market?.description && (
          <p className={styles.muted}>{market.description}</p>
        )}
        <div className={styles.links}>
          {links.map((link) => (
            <a key={link.label} href={link.href} {...external}>
              {link.label}
              <ArrowUpRight aria-hidden="true" />
            </a>
          ))}
        </div>
        {market?.threadUrl && safeForumThread(market.threadUrl) ? (
          <ForumLink
            href={safeForumThread(market.threadUrl)!}
            className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary underline underline-offset-4"
          >
            Read the token discussion
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </ForumLink>
        ) : (
          <p className={`${styles.muted} mt-3`}>
            No canonical discussion is indexed for this mint yet.{" "}
            <ForumLink
              className="underline underline-offset-4"
              href="/forum/crypto"
            >
              Browse Web3
            </ForumLink>
          </p>
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
