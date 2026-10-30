"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { RefreshCw, ArrowUpRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { SYMF_TOKEN } from "@/lib/symf-token";
import type { TerminalWalletReadState } from "@/lib/forum-terminal-model";
import { terminalApi } from "./terminal-api";
import { balanceLabel, shortMint } from "./terminal-format";
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
        {current ? (
          <ul className={styles.rows} aria-label="Wallet balances">
            {current.balances.map((balance) => (
              <li key={balance.mint}>
                <span>
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
                <span className={styles.balance}>
                  {balanceLabel(balance.rawAmount, balance.decimals)}
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
        {current?.maxSolRaw != null && (
          <p className={`${styles.muted} mt-3`}>
            Estimated spendable SOL {balanceLabel(current.maxSolRaw, 9)} after a
            verified reserve. The final route can require more rent or fees.
          </p>
        )}
        {current && current.maxSolRaw == null && (
          <p className={`${styles.muted} mt-3`}>
            Keep SOL for network fees and token-account rent. Max is unavailable
            until route-specific costs are verified.
          </p>
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
                        className="inline-flex min-h-9 items-center gap-1"
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
