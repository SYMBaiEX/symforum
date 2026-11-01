"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
import { TerminalBoundary } from "./terminal-boundary";
import styles from "./forum-terminal.module.css";
import { useForumRuntime } from "@/components/forum/forum-runtime-context";

const SOL = "So11111111111111111111111111111111111111112";

export function WalletPanel({
  wallet,
  selectedMint,
  selectedSymbol,
  active = true,
}: {
  wallet: string;
  selectedMint: string;
  selectedSymbol: string;
  active?: boolean;
}) {
  const balanceContextId = useId();
  const read = useAction(terminalApi.getWalletReadState);
  const [data, setData] = useState<TerminalWalletReadState | null>(null);
  const [busy, setBusy] = useState(false);
  const [canRead, setCanRead] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const root = useRef<HTMLElement>(null);
  const activeView = useRef(active);
  const checkDemand = useRef<(() => void) | null>(null);
  const requestRefresh = useRef<(() => void) | null>(null);
  const { host } = useForumRuntime();
  useLayoutEffect(() => {
    activeView.current = active;
    checkDemand.current?.();
  }, [active]);
  useEffect(() => {
    const element = root.current;
    if (host !== "website" || !element) return;
    let cancelled = false;
    let intersecting = false;
    let admitted = false;
    let running = false;
    const eligible = () => {
      if (
        !activeView.current ||
        !intersecting ||
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        !element.getClientRects().length
      )
        return false;
      // Observer delivery can lag an online/explicit-refresh event. Recheck
      // current rendering and viewport bounds at the actual admission point.
      const visibility = getComputedStyle(element).visibility;
      const bounds = element.getBoundingClientRect();
      return (
        visibility !== "hidden" &&
        visibility !== "collapse" &&
        bounds.bottom > 0 &&
        bounds.right > 0 &&
        bounds.top < window.innerHeight &&
        bounds.left < window.innerWidth
      );
    };
    const request = (manual = false) => {
      if (cancelled || running || !eligible()) return;
      const current = ++revision.current;
      admitted = true;
      running = true;
      setBusy(true);
      setError("");
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
              manual
                ? "Balances could not be refreshed. No payment request was made."
                : "Balances are unavailable. Wallet transactions remain separate.",
            );
        })
        .finally(() => {
          if (!cancelled && current === revision.current) {
            running = false;
            setBusy(false);
          }
        });
    };
    const demand = () => {
      if (cancelled) return;
      setCanRead(eligible());
      if (!admitted) request();
    };
    const refresh = () => request(true);
    checkDemand.current = demand;
    requestRefresh.current = refresh;
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      demand();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", demand);
    window.addEventListener("online", demand);
    window.addEventListener("offline", demand);
    return () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", demand);
      window.removeEventListener("online", demand);
      window.removeEventListener("offline", demand);
      if (checkDemand.current === demand) checkDemand.current = null;
      if (requestRefresh.current === refresh) requestRefresh.current = null;
    };
  }, [wallet, selectedMint, read, host]);
  const current = data?.wallet === wallet ? data : null;
  const solReadings = current ? walletSolReadings(current) : null;
  return (
    <section
      ref={root}
      className={styles.panel}
      aria-labelledby="terminal-wallet-title"
    >
      <header className={styles.panelHead}>
        <div>
          <h2 id="terminal-wallet-title">Your wallet</h2>
          <p>Private to your signed-in account</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="!min-h-11 !min-w-11"
          disabled={busy || !canRead}
          aria-label="Refresh wallet balances"
          onClick={() => requestRefresh.current?.()}
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
            {error ||
              (busy
                ? "Loading SOL and selected token balances…"
                : "Balance reads wait until this panel is visible, online and in the foreground.")}
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

function receiptIsoTime(createdAt: number) {
  const date = new Date(createdAt);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export function SwapHistory({ ownerId }: { ownerId: string | null }) {
  // Only this read-only projection resets when the verified owner changes.
  // A missing identity is not permission to retain or query another account.
  return ownerId ? (
    <OwnerSwapHistory key={ownerId} />
  ) : (
    <p role="status" className={`${styles.panel} ${styles.empty}`}>
      Confirming your account before loading private operation receipts…
    </p>
  );
}

function OwnerSwapHistory() {
  const [protectedCount, setProtectedCount] = useState<number | null>(null);
  const rememberProtection = useCallback((count: number) => {
    setProtectedCount(count);
  }, []);
  // The attention owner must outlive a failed/retried reader. An unavailable
  // read never replaces a known protected count with an invented zero.
  useTerminalAttention("receipts", protectedCount ?? 0);
  return (
    <section
      className={`${styles.panel} focus-ring [&&_button]:!min-h-11`}
      aria-labelledby="terminal-history-title"
      tabIndex={-1}
    >
      <header className={styles.panelHead}>
        <div>
          <h2 id="terminal-history-title">Recent swap operations</h2>
          <p>Your latest records, with protected outcomes prioritized.</p>
        </div>
      </header>
      {protectedCount !== null && protectedCount > 0 && (
        <p role="status" className={`${styles.warning} m-4`}>
          Last confirmed records include {protectedCount} operation
          {protectedCount === 1 ? " with" : "s with"} a submitted or uncertain
          outcome. The history may be unavailable; the swap panel handles
          verification. Do not repeat a protected attempt.
        </p>
      )}
      <TerminalBoundary label="Swap history" recovery="read-only">
        <SwapHistoryReader rememberProtection={rememberProtection} />
      </TerminalBoundary>
    </section>
  );
}

function SwapHistoryReader({
  rememberProtection,
}: {
  rememberProtection: (count: number) => void;
}) {
  const history = useQuery(api.forumSwaps.listMine, {});
  useLayoutEffect(() => {
    if (history !== undefined)
      rememberProtection(
        history.filter(
          (entry) => entry.status === "held" || entry.status === "submitted",
        ).length,
      );
  }, [history, rememberProtection]);
  return history === undefined ? (
    <p role="status" className={styles.empty}>
      Loading your operation receipts…
    </p>
  ) : history.length === 0 ? (
    <p className={styles.empty}>
      No swap operations on this account yet. A quote or wallet connection does
      not move funds.
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
                <time dateTime={receiptIsoTime(entry.createdAt)}>
                  {new Date(entry.createdAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </td>
              <td title={`${entry.inputMint} → ${entry.outputMint}`}>
                {entry.inputMint === SOL ? "SOL" : shortMint(entry.inputMint)} /{" "}
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
                    aria-label={`View ${entry.inputMint === SOL ? "SOL" : shortMint(entry.inputMint)} / ${entry.outputMint === SYMF_TOKEN.mint ? SYMF_TOKEN.symbol : entry.outputMint === SOL ? "SOL" : shortMint(entry.outputMint)} swap from ${receiptIsoTime(entry.createdAt) ?? "time unavailable"} on Solscan, signature ${entry.signature}`}
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
  );
}
