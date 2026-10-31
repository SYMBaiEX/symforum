"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Bookmark, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { terminalApi, type TokenAlert } from "./terminal-api";
import { marketMoney, shortMint } from "./terminal-format";
import type { MarketChoice } from "./market-identity";
import styles from "./forum-terminal.module.css";

export function WatchlistPanel({
  selected,
  onSelect,
}: {
  selected: MarketChoice;
  onSelect: (choice: MarketChoice) => void;
}) {
  const watches = useQuery(terminalApi.listWatchlist, {});
  const alerts = useQuery(terminalApi.listAlerts, {});
  const save = useMutation(terminalApi.setWatchlist);
  const acknowledge = useMutation(terminalApi.acknowledgeAlert);
  const [above, setAbove] = useState("");
  const [below, setBelow] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const saved = watches?.find((watch) => watch.mint === selected.mint);
  async function update(enabled: boolean, clearThresholds = false) {
    if (busy) return;
    const high = clearThresholds
      ? null
      : above.trim()
        ? Number(above)
        : (saved?.priceAboveUsd ?? null);
    const low = clearThresholds
      ? null
      : below.trim()
        ? Number(below)
        : (saved?.priceBelowUsd ?? null);
    if (
      enabled &&
      ([high, low].some(
        (value) => value != null && (!Number.isFinite(value) || value <= 0),
      ) ||
        (high != null && low != null && high <= low))
    ) {
      setMessage(
        "Enter positive USD prices. The upper threshold must be greater than the lower threshold.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await save({
        mint: selected.mint,
        enabled,
        ...(enabled ? { priceAboveUsd: high, priceBelowUsd: low } : {}),
      });
      if (clearThresholds) {
        setAbove("");
        setBelow("");
      }
      setMessage(
        enabled
          ? "Token saved. Alerts use scheduled source samples, not every trade."
          : "Token removed from your watchlist.",
      );
    } catch {
      setMessage(
        "The watchlist could not be updated. Your existing settings are unchanged.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function dismiss(alert: TokenAlert) {
    if (busy) return;
    setBusy(true);
    try {
      await acknowledge({ id: alert.id });
    } catch {
      setMessage("This alert could not be marked read. Try later.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={styles.panel}
      aria-labelledby="terminal-watchlist-title"
    >
      <header className={styles.panelHead}>
        <div>
          <h2 id="terminal-watchlist-title">Watchlist &amp; alerts</h2>
          <p>Private, mint-specific monitoring</p>
        </div>
        <Bookmark aria-hidden="true" className="size-4 text-muted-foreground" />
      </header>
      <div className={styles.body}>
        <p className={styles.muted}>
          Watch ${selected.symbol}. Optional thresholds are USD prices, not
          market cap. Monitoring follows existing scout samples; alerts are not
          instant or guaranteed coverage. Empty fields keep existing thresholds.
        </p>
        {saved && (
          <p className={`${styles.muted} mt-2`}>
            Saved thresholds: above{" "}
            {saved.priceAboveUsd == null
              ? "not set"
              : marketMoney(saved.priceAboveUsd)}
            , below{" "}
            {saved.priceBelowUsd == null
              ? "not set"
              : marketMoney(saved.priceBelowUsd)}
            .
          </p>
        )}
        <form
          className={`${styles.watchForm} mt-4`}
          onSubmit={(event) => {
            event.preventDefault();
            void update(true);
          }}
        >
          <label>
            Alert above, USD
            <Input
              inputMode="decimal"
              autoComplete="off"
              placeholder={
                saved?.priceAboveUsd == null
                  ? "Optional"
                  : `Keep ${saved.priceAboveUsd}`
              }
              value={above}
              maxLength={30}
              onChange={(event) => setAbove(event.target.value)}
            />
          </label>
          <label>
            Alert below, USD
            <Input
              inputMode="decimal"
              autoComplete="off"
              placeholder={
                saved?.priceBelowUsd == null
                  ? "Optional"
                  : `Keep ${saved.priceBelowUsd}`
              }
              value={below}
              maxLength={30}
              onChange={(event) => setBelow(event.target.value)}
            />
          </label>
          <div className={styles.toolbar}>
            <Button type="submit" disabled={busy || watches === undefined}>
              {busy ? "Saving…" : saved ? "Update watch" : "Watch token"}
            </Button>
            {saved && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => void update(false)}
              >
                Remove watch
              </Button>
            )}
            {saved &&
              (saved.priceAboveUsd != null || saved.priceBelowUsd != null) && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void update(true, true)}
                >
                  Clear thresholds
                </Button>
              )}
          </div>
        </form>
        <p role="status" className={`${styles.muted} mt-3`}>
          {message}
        </p>
        {watches === undefined ? (
          <p className={styles.muted}>Loading your watchlist…</p>
        ) : watches.length === 0 ? (
          <p className={styles.muted}>No watched tokens yet.</p>
        ) : (
          <ul className={styles.rows} aria-label="Watched tokens">
            {watches.map((watch) => (
              <li key={watch.mint}>
                <span>
                  <strong>
                    {watch.symbol ? `$${watch.symbol}` : shortMint(watch.mint)}
                  </strong>
                  <small>
                    <code>{shortMint(watch.mint)}</code>
                  </small>
                </span>
                <Button
                  variant="ghost"
                  disabled={watch.mint === selected.mint}
                  onClick={() =>
                    onSelect({
                      mint: watch.mint,
                      symbol: watch.symbol ?? shortMint(watch.mint),
                      name: "Watched Solana token",
                    })
                  }
                >
                  {watch.mint === selected.mint ? "Selected" : "View"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mb-2 mt-5 flex items-center gap-2 text-sm font-medium">
          <Bell className="size-4" aria-hidden="true" />
          Sample alerts
        </h3>
        {alerts === undefined ? (
          <p className={styles.muted}>Loading alerts…</p>
        ) : !alerts.some((alert) => !alert.acknowledged) ? (
          <p className={styles.muted}>
            No unread alerts. This does not imply the market has stayed inside
            your thresholds.
          </p>
        ) : (
          <ul className={styles.rows}>
            {alerts
              .filter((alert) => !alert.acknowledged)
              .map((alert) => (
                <li key={alert.id}>
                  <span>
                    <strong>
                      {alert.symbol ?? shortMint(alert.mint)} {alert.direction}{" "}
                      {marketMoney(alert.thresholdUsd)}
                    </strong>
                    <small>
                      Sample {marketMoney(alert.priceUsd)} at{" "}
                      {new Date(alert.observedAt).toLocaleString()}
                    </small>
                    <small>
                      Mint{" "}
                      <code title={alert.mint}>{shortMint(alert.mint)}</code>
                    </small>
                  </span>
                  <div className={styles.toolbar}>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy || alert.mint === selected.mint}
                      aria-label={`${alert.mint === selected.mint ? "Selected token" : "View token"} for alert, mint ${alert.mint}`}
                      onClick={() =>
                        onSelect({
                          mint: alert.mint,
                          symbol: alert.symbol ?? shortMint(alert.mint),
                          name: "Alerted Solana token",
                        })
                      }
                    >
                      {alert.mint === selected.mint ? "Selected" : "View token"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void dismiss(alert)}
                    >
                      Mark read
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}
