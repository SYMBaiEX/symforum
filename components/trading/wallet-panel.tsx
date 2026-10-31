"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { RefreshCw, ArrowUpRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { SYMF_TOKEN } from "@/lib/symf-token";
import type { TerminalWalletReadState } from "@/lib/forum-terminal-model";
import { terminalApi } from "./terminal-api";
import { shortMint } from "./terminal-format";
import { walletAmountLabel, walletSolReadings } from "./wallet-readings-model";
import { useTerminalAttention } from "./terminal-attention";
import styles from "./forum-terminal.module.css";

const SOL = "So11111111111111111111111111111111111111112";

export function WalletPanel({
  wallet,
  selectedMint,
  selectedSymbol,
}: {
  wallet: string;
  selectedMint: string;
  selectedSymbol: string;
}) {
  const balanceContextId = useId();
  const read = useAction(terminalApi.getWalletReadState);
  const [data, setData] = useState<TerminalWalletReadState | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0);
  useEffect(() => {
    const current = ++revision.current;
    let cancelled = false;
    void read({ wallet, selectedMint })
      .then((result) => {
        if (!cancelled && current === revision.current) {
          setData(result);
          if (!result)
            setError(
              "Balance data is unavailable or the shared request allowance is busy. Try later.",
            );
        }
      })
      .catch(() => {
        if (!cancelled && current === revision.current)
          setError(
            "Balances are unavailable. Wallet transactions remain separate.",
          );
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet, selectedMint, read]);
  async function refresh() {
    if (busy) return;
    const current = ++revision.current;
    setBusy(true);
    setError("");
    try {
      const result = await read({ wallet, selectedMint });
      if (current === revision.current) {
        setData(result);
        if (!result)
          setError(
            "Balance data is unavailable or the shared request allowance is busy. Try later.",
          );
      }
    } catch {
      if (current === revision.current)
        setError(
          "Balances could not be refreshed. No payment request was made.",
        );
    } finally {
      setBusy(false);
    }
  }
  const current = data?.wallet === wallet ? data : null;
  const solReadings = current ? walletSolReadings(current) : null;
  return (
    <section className={styles.panel} aria-labelledby="terminal-wallet-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="terminal-wallet-title">Your wallet</h2>
          <p>Private to your signed-in account</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label="Refresh wallet balances"
          onClick={() => void refresh()}
        >
          <RefreshCw
            className={`size-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
            aria-hidden="true"
          />
        </Button>
      </header>
      <div className={styles.body}>
        <p className={styles.muted}>
          Linked wallet <code title={wallet}>{shortMint(wallet)}</code>
        </p>
        <LinkedWalletIdentity key={wallet} wallet={wallet} />
        {current ? (
          <ul
            className={styles.rows}
            aria-label="Wallet balances"
            aria-describedby={balanceContextId}
          >
            {current.balances.map((balance) => (
              <li key={balance.mint}>
                <span className="min-w-0">
                  <strong>
                    {balance.mint === SOL
                      ? "SOL"
                      : balance.mint === SYMF_TOKEN.mint
                        ? SYMF_TOKEN.symbol
                        : balance.mint === selectedMint
                          ? selectedSymbol
                          : shortMint(balance.mint)}
                  </strong>
                  <small title={balance.mint}>{shortMint(balance.mint)}</small>
                </span>
                <span className={`${styles.balance} min-w-0`}>
                  {walletAmountLabel(balance.rawAmount, balance.decimals)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className={styles.muted}>
            {error || "Loading SOL and selected token balances…"}
          </p>
        )}
        {current && (
          <p className={`${styles.muted} mt-3`}>
            Checked {new Date(current.checkedAt).toLocaleTimeString()}.{" "}
            {current.expiresAt < Date.now()
              ? "Cached balances may be stale."
              : "Preparation checks balances again."}
          </p>
        )}
        {current && solReadings && (
          <>
            <p id={balanceContextId} className={`${styles.muted} mt-3`}>
              Displayed balances are not spendable limits.
              {solReadings.balance === "Unavailable" &&
                " SOL balance unavailable; no zero balance is assumed."}
            </p>
            <details className={`${styles.muted} mt-3`}>
              <summary className="focus-ring min-h-11 cursor-pointer content-center">
                Balance &amp; spendable SOL
              </summary>
              {solReadings.estimate !== "Unavailable" ? (
                <p className="break-words">
                  Returned spendable estimate: {solReadings.estimate} SOL.
                  Returned verified reserve: {solReadings.reserve} SOL.
                </p>
              ) : (
                <p>
                  Verified spendable estimate unavailable. Returned fields do
                  not establish a reliable spendable limit. No Max amount is
                  assumed.
                </p>
              )}
              <p>
                Keep SOL for network fees and token-account rent. The final
                route can require more rent or fees. Preparation checks balances
                and route-specific costs again; the displayed balance is not an
                amount to spend in full.
              </p>
            </details>
          </>
        )}
        {current &&
          !current.balances.some((entry) => entry.mint === selectedMint) && (
            <p className={`${styles.muted} mt-3`}>
              The selected token’s balance is unavailable; no zero balance is
              assumed.
            </p>
          )}
        {current && error && (
          <p role="status" className={`${styles.muted} mt-3`}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function LinkedWalletIdentity({ wallet }: { wallet: string }) {
  const addressId = useId();
  const active = useRef(true);
  const copying = useRef(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function copyAddress() {
    if (copying.current) return;
    copying.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      await navigator.clipboard.writeText(wallet);
      if (active.current) setFeedback("copied");
    } catch {
      if (active.current) setFeedback("failed");
    } finally {
      copying.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <details className="mt-3 min-w-0">
      <summary className="focus-ring min-h-11 cursor-pointer content-center text-sm">
        Full linked wallet address
      </summary>
      <code
        id={addressId}
        className="block min-w-0 break-all text-sm leading-6"
      >
        {wallet}
      </code>
      <Button
        type="button"
        variant="outline"
        className="mt-2 min-h-11"
        aria-label="Copy linked wallet address"
        aria-describedby={addressId}
        disabled={busy}
        onClick={() => void copyAddress()}
      >
        {busy ? "Copying…" : "Copy address"}
      </Button>
      {feedback && (
        <p
          role={feedback === "failed" ? "alert" : "status"}
          className="mt-2 min-w-0 text-sm [overflow-wrap:anywhere]"
        >
          {feedback === "copied"
            ? "Linked wallet address copied."
            : "Could not copy. Select the full address above and copy it manually."}
        </p>
      )}
    </details>
  );
}

const statusLabels = {
  quoted: "Quote only",
  preparing: "Preparing",
  prepared: "Prepared",
  submitted: "Submitted",
  held: "Outcome protected",
  confirmed: "Confirmed",
  failed: "Not completed",
} as const;

export function SwapHistory() {
  const history = useQuery(api.forumSwaps.listMine, {});
  const protectedCount =
    history?.filter(
      (entry) => entry.status === "held" || entry.status === "submitted",
    ).length ?? 0;
  useTerminalAttention("receipts", protectedCount);
  return (
    <section className={styles.panel} aria-labelledby="terminal-history-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="terminal-history-title">Recent swap operations</h2>
          <p>Your latest records, with protected outcomes prioritized.</p>
        </div>
      </header>
      {protectedCount > 0 && (
        <p role="status" className={`${styles.warning} m-4`}>
          {protectedCount} operation{protectedCount === 1 ? " has" : "s have"} a
          submitted or uncertain outcome. The swap panel handles verification.
          Do not repeat a protected attempt.
        </p>
      )}
      {history === undefined ? (
        <p role="status" className={styles.empty}>
          Loading your operation receipts…
        </p>
      ) : history.length === 0 ? (
        <p className={styles.empty}>
          No swap operations on this account yet. A quote or wallet connection
          does not move funds.
        </p>
      ) : (
        <div
          className={styles.tableWrap}
          tabIndex={0}
          role="region"
          aria-label="Your swap operation history"
        >
          <table className={styles.table}>
            <caption className="sr-only">
              Recent private swap operation receipts
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Pair</th>
                <th scope="col">Status</th>
                <th scope="col">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.quoteId}>
                  <td>
                    <time dateTime={new Date(entry.createdAt).toISOString()}>
                      {new Date(entry.createdAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </td>
                  <td title={`${entry.inputMint} → ${entry.outputMint}`}>
                    {entry.inputMint === SOL
                      ? "SOL"
                      : shortMint(entry.inputMint)}{" "}
                    /{" "}
                    {entry.outputMint === SYMF_TOKEN.mint
                      ? SYMF_TOKEN.symbol
                      : entry.outputMint === SOL
                        ? "SOL"
                        : shortMint(entry.outputMint)}
                  </td>
                  <td>
                    <span
                      className={styles.status}
                      data-held={entry.status === "held"}
                    >
                      {statusLabels[entry.status]}
                    </span>
                  </td>
                  <td>
                    {entry.signature ? (
                      <a
                        href={`https://solscan.io/tx/${encodeURIComponent(entry.signature)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View ${entry.inputMint === SOL ? "SOL" : shortMint(entry.inputMint)} / ${entry.outputMint === SYMF_TOKEN.mint ? SYMF_TOKEN.symbol : entry.outputMint === SOL ? "SOL" : shortMint(entry.outputMint)} swap from ${new Date(entry.createdAt).toISOString()} on Solscan, signature ${entry.signature}`}
                        className="inline-flex min-h-11 items-center gap-1"
                      >
                        Explorer
                        <ArrowUpRight className="size-3" aria-hidden="true" />
                      </a>
                    ) : (
                      "No signature recorded"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
