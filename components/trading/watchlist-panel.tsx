"use client";

import { useId, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Bookmark, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { terminalApi, type TokenAlert } from "./terminal-api";
import { marketMoney, shortMint } from "./terminal-format";
import { rawMarketNumber } from "./market-explorer-model";
import type { MarketChoice } from "./market-identity";
import styles from "./forum-terminal.module.css";

function thresholdLabel(value: number | null) {
  if (value === null) return "not set";
  if (value < 0) return "Unavailable";
  const raw = rawMarketNumber(value);
  if (raw === undefined) return "Unavailable";
  const [whole, fraction = ""] = raw.split(".");
  return `$${whole}.${fraction.padEnd(2, "0")}`;
}

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
  const [clearAbove, setClearAbove] = useState(false);
  const [clearBelow, setClearBelow] = useState(false);
  const [errors, setErrors] = useState<{ above?: string; below?: string }>({});
  const [pending, setPending] = useState<
    { kind: "save" | "remove" } | { kind: "acknowledge"; id: string } | null
  >(null);
  const busy = pending !== null;
  const admission = useRef(false);
  const aboveInput = useRef<HTMLInputElement>(null);
  const belowInput = useRef<HTMLInputElement>(null);
  const formId = useId();
  const [message, setMessage] = useState("");
  const saved = watches?.find((watch) => watch.mint === selected.mint);
  async function update(enabled: boolean) {
    if (admission.current || watches === undefined) return;
    const high = clearAbove
      ? null
      : above.trim()
        ? Number(above)
        : (saved?.priceAboveUsd ?? null);
    const low = clearBelow
      ? null
      : below.trim()
        ? Number(below)
        : (saved?.priceBelowUsd ?? null);
    const invalid: { above?: string; below?: string } = {};
    if (enabled) {
      if (high != null && (!Number.isFinite(high) || high <= 0))
        invalid.above = "Enter a positive USD price for the upper threshold.";
      if (low != null && (!Number.isFinite(low) || low <= 0))
        invalid.below = "Enter a positive USD price for the lower threshold.";
      if (
        !invalid.above &&
        !invalid.below &&
        high != null &&
        low != null &&
        high <= low
      )
        invalid.above =
          "The upper threshold must be greater than the lower threshold.";
    }
    setErrors(invalid);
    setMessage("");
    if (invalid.above || invalid.below) {
      (invalid.above ? aboveInput : belowInput).current?.focus();
      return;
    }
    admission.current = true;
    setPending({ kind: enabled ? "save" : "remove" });
    try {
      await save({
        mint: selected.mint,
        enabled,
        // Omit KEEP fields so the server preserves their latest values, even
        // when another tab updated them before this subscription caught up.
        ...(enabled && (clearAbove || above.trim())
          ? { priceAboveUsd: high }
          : {}),
        ...(enabled && (clearBelow || below.trim())
          ? { priceBelowUsd: low }
          : {}),
      });
      setAbove("");
      setBelow("");
      setClearAbove(false);
      setClearBelow(false);
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
      admission.current = false;
      setPending(null);
    }
  }
  async function dismiss(alert: TokenAlert) {
    if (admission.current) return;
    admission.current = true;
    setPending({ kind: "acknowledge", id: alert.id });
    setMessage("");
    try {
      await acknowledge({ id: alert.id });
    } catch {
      setMessage("This alert could not be marked read. Try later.");
    } finally {
      admission.current = false;
      setPending(null);
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
        <p id={`${formId}-help`} className={styles.muted}>
          Watch ${selected.symbol}. Optional thresholds are USD prices, not
          market cap. Monitoring follows existing scout samples; alerts are not
          instant or guaranteed coverage. Empty fields keep existing thresholds.
          Clear actions only change this draft; save to apply them.
        </p>
        {saved && (
          <p className={`${styles.muted} mt-2 break-all`}>
            Saved thresholds: above {thresholdLabel(saved.priceAboveUsd)}, below{" "}
            {thresholdLabel(saved.priceBelowUsd)}.
          </p>
        )}
        <form
          className={`${styles.watchForm} mt-4`}
          aria-label="Watch thresholds"
          aria-busy={pending?.kind === "save" || pending?.kind === "remove"}
          onSubmit={(event) => {
            event.preventDefault();
            void update(true);
          }}
        >
          <div>
            <label htmlFor={`${formId}-above`}>
              Alert above, USD
              <Input
                id={`${formId}-above`}
                ref={aboveInput}
                disabled={busy}
                aria-invalid={Boolean(errors.above)}
                aria-describedby={`${formId}-help${clearAbove ? ` ${formId}-clear-above` : ""}${errors.above ? ` ${formId}-above-error` : ""}`}
                inputMode="decimal"
                autoComplete="off"
                placeholder={
                  clearAbove
                    ? "Will clear on save"
                    : saved?.priceAboveUsd == null
                      ? "Optional"
                      : `Keep ${saved.priceAboveUsd}`
                }
                value={above}
                maxLength={30}
                onChange={(event) => {
                  setAbove(event.target.value);
                  setClearAbove(false);
                  setErrors({});
                  setMessage("");
                }}
              />
            </label>
            {saved?.priceAboveUsd != null && (
              <Button
                type="button"
                variant="ghost"
                className="mt-1 min-h-11"
                disabled={busy}
                onClick={() => {
                  setAbove("");
                  setClearAbove(!clearAbove);
                  setErrors({});
                  setMessage("");
                }}
              >
                {clearAbove ? "Keep saved above" : "Clear above"}
              </Button>
            )}
            {clearAbove && (
              <p
                id={`${formId}-clear-above`}
                className={`${styles.muted} mt-1`}
              >
                Above threshold will be cleared when you save.
              </p>
            )}
            {errors.above && (
              <p
                id={`${formId}-above-error`}
                role="alert"
                className="mt-1 text-xs text-destructive"
              >
                {errors.above}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={`${formId}-below`}>
              Alert below, USD
              <Input
                id={`${formId}-below`}
                ref={belowInput}
                disabled={busy}
                aria-invalid={Boolean(errors.below)}
                aria-describedby={`${formId}-help${clearBelow ? ` ${formId}-clear-below` : ""}${errors.below ? ` ${formId}-below-error` : ""}`}
                inputMode="decimal"
                autoComplete="off"
                placeholder={
                  clearBelow
                    ? "Will clear on save"
                    : saved?.priceBelowUsd == null
                      ? "Optional"
                      : `Keep ${saved.priceBelowUsd}`
                }
                value={below}
                maxLength={30}
                onChange={(event) => {
                  setBelow(event.target.value);
                  setClearBelow(false);
                  setErrors({});
                  setMessage("");
                }}
              />
            </label>
            {saved?.priceBelowUsd != null && (
              <Button
                type="button"
                variant="ghost"
                className="mt-1 min-h-11"
                disabled={busy}
                onClick={() => {
                  setBelow("");
                  setClearBelow(!clearBelow);
                  setErrors({});
                  setMessage("");
                }}
              >
                {clearBelow ? "Keep saved below" : "Clear below"}
              </Button>
            )}
            {clearBelow && (
              <p
                id={`${formId}-clear-below`}
                className={`${styles.muted} mt-1`}
              >
                Below threshold will be cleared when you save.
              </p>
            )}
            {errors.below && (
              <p
                id={`${formId}-below-error`}
                role="alert"
                className="mt-1 text-xs text-destructive"
              >
                {errors.below}
              </p>
            )}
          </div>
          <div className={styles.toolbar}>
            <Button type="submit" disabled={busy || watches === undefined}>
              {pending?.kind === "save"
                ? "Saving…"
                : saved
                  ? "Update watch"
                  : "Watch token"}
            </Button>
            {saved && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => void update(false)}
              >
                {pending?.kind === "remove" ? "Removing…" : "Remove watch"}
              </Button>
            )}
            {saved &&
              (saved.priceAboveUsd != null || saved.priceBelowUsd != null) && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setAbove("");
                    setBelow("");
                    setClearAbove(saved.priceAboveUsd != null);
                    setClearBelow(saved.priceBelowUsd != null);
                    setErrors({});
                    setMessage("");
                  }}
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
                      {pending?.kind === "acknowledge" &&
                      pending.id === alert.id
                        ? "Marking read…"
                        : "Mark read"}
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
