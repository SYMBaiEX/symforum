"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useAction, useConvexAuth } from "convex/react";
import {
  ArrowDown,
  ArrowUpRight,
  ChartNoAxesCombined,
  ListFilter,
  Wallet,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useForumRuntime } from "@/components/forum/forum-runtime-context";
import { ForumLink } from "@/components/forum/forum-link";
import {
  CommerceWalletButton,
  CommerceWalletProvider,
  useCommerceIdentity,
  useCommerceWallet,
} from "@/components/swap/commerce-wallet";
import { TokenSwap, type TradeToken } from "@/components/swap/token-swap";
import { Button } from "@/components/ui/button";
import type { CommerceWalletClient } from "@/lib/commerce-wallet-client";
import { forumSiteUrl } from "@/lib/site-urls";
import { symfChoice, type MarketChoice } from "./market-identity";
import { MarketExplorer } from "./market-explorer";
import { TokenDetail, RiskPanel } from "./token-detail";
import { TerminalBoundary } from "./terminal-boundary";
import { SwapHistory, WalletPanel } from "./wallet-panel";
import { WatchlistPanel } from "./watchlist-panel";
import { TransparencyPanel } from "./transparency-panel";
import styles from "./forum-terminal.module.css";

export type ForumTerminalProps = {
  enabled: boolean;
  initialMint?: string;
  renderUtilities?: (mint: string) => ReactNode;
};

export function ForumTerminal({
  enabled,
  initialMint,
  renderUtilities,
}: ForumTerminalProps) {
  const { host } = useForumRuntime();
  if (host !== "website")
    return (
      <section className={styles.native}>
        <h1>Solana trading terminal</h1>
        <p>
          Research and community discussions stay together. Open the first-party
          website for interactive charts, private wallet data and
          wallet-approved payments.
        </p>
        <a
          href={forumSiteUrl("/trade")}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center gap-2 text-primary underline underline-offset-4"
        >
          Open the trading terminal
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </a>
      </section>
    );
  if (!enabled)
    return (
      <section className={styles.native}>
        <h1>Solana trading terminal</h1>
        <p>
          The terminal is not connected in this environment. No quotes or wallet
          transactions are available.
        </p>
        <ForumLink href="/forum">Return to the forum</ForumLink>
      </section>
    );
  return (
    <CommerceWalletProvider>
      <TerminalWorkspace
        initialMint={initialMint}
        renderUtilities={renderUtilities}
      />
    </CommerceWalletProvider>
  );
}

function TerminalWorkspace({
  initialMint,
  renderUtilities,
}: Pick<ForumTerminalProps, "initialMint" | "renderUtilities">) {
  const client = useCommerceWallet();
  const [selected, setSelected] = useState<MarketChoice>(() =>
    initialMint && initialMint !== symfChoice.mint
      ? { mint: initialMint, symbol: "TOKEN", name: "Selected Solana token" }
      : symfChoice,
  );
  const [view, setView] = useState<"chart" | "markets">("chart");
  const chartTab = useRef<HTMLButtonElement>(null);
  const marketsTab = useRef<HTMLButtonElement>(null);
  function selectToken(token: MarketChoice) {
    setSelected(token);
    setView("chart");
    chartTab.current?.focus();
  }
  function navigateViews(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "chart"
        : event.key === "End"
          ? "markets"
          : view === "chart"
            ? "markets"
            : "chart";
    setView(next);
    (next === "chart" ? chartTab : marketsTab).current?.focus();
  }
  // Public query arguments share a minute bucket across viewers. Do not create
  // a distinct materialized-cache subscription for every visitor's millisecond.
  const [now, setNow] = useState(
    () => Math.floor(Date.now() / 60_000) * 60_000,
  );
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setNow(Math.floor(Date.now() / 60_000) * 60_000);
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1>Trading terminal</h1>
          <span className={styles.network}>Solana</span>
        </div>
        <div
          role="tablist"
          aria-label="Terminal views"
          className={styles.viewTabs}
        >
          <button
            ref={chartTab}
            id="terminal-chart-tab"
            type="button"
            role="tab"
            aria-selected={view === "chart"}
            aria-controls="terminal-chart"
            tabIndex={view === "chart" ? 0 : -1}
            onClick={() => setView("chart")}
            onKeyDown={navigateViews}
          >
            <ChartNoAxesCombined size={15} aria-hidden="true" /> Chart
          </button>
          <button
            ref={marketsTab}
            id="terminal-markets-tab"
            type="button"
            role="tab"
            aria-selected={view === "markets"}
            aria-controls="terminal-markets"
            tabIndex={view === "markets" ? 0 : -1}
            onClick={() => setView("markets")}
            onKeyDown={navigateViews}
          >
            <ListFilter size={15} aria-hidden="true" /> Markets
          </button>
        </div>
        <nav className={styles.headerActions} aria-label="Terminal shortcuts">
          <a
            href="#terminal-order"
            className={`${styles.tradeShortcut} focus-ring`}
          >
            Trade <ArrowDown className="size-3.5" aria-hidden="true" />
          </a>
          <a
            href="#terminal-account"
            className={`${styles.headerLink} focus-ring`}
          >
            Your workspace
          </a>
          <ForumLink
            href="/forum/crypto"
            className={`${styles.headerLink} focus-ring`}
          >
            Web3 discussions
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </ForumLink>
        </nav>
      </header>
      <div className={styles.layout}>
        <div className={styles.analysis}>
          <div
            id="terminal-chart"
            role="tabpanel"
            aria-labelledby="terminal-chart-tab"
            hidden={view !== "chart"}
            className={styles.chartWorkspace}
          >
            <TerminalBoundary
              key={`market:${selected.mint}`}
              label="Selected token data"
            >
              <TokenDetail token={selected} now={now} />
            </TerminalBoundary>
          </div>
          <div
            id="terminal-markets"
            role="tabpanel"
            aria-labelledby="terminal-markets-tab"
            hidden={view !== "markets"}
            className={styles.marketsWorkspace}
          >
            <TerminalBoundary label="Token discovery">
              <MarketExplorer
                selected={selected.mint}
                onSelect={selectToken}
                now={now}
              />
            </TerminalBoundary>
          </div>
        </div>
        <aside
          id="terminal-order"
          className={styles.aside}
          aria-label="Trade selected token"
          tabIndex={-1}
        >
          <TerminalBoundary label="Wallet and swap">
            <section className={styles.orderSurface}>
              <div className={styles.panelHead}>
                <div>
                  <h2>
                    {selected.symbol === "TOKEN"
                      ? "Trade selected token"
                      : `Trade $${selected.symbol}`}
                  </h2>
                  <p>Market order</p>
                </div>
              </div>
              <div className={styles.body}>
                {client ? (
                  <SelectedSwap
                    key={selected.mint}
                    client={client}
                    token={selected}
                  />
                ) : (
                  <p role="status" className={styles.muted}>
                    Loading shared wallet support…
                  </p>
                )}
              </div>
              <details className={styles.executionDetails}>
                <summary className="focus-ring">Before you approve</summary>
                <p>
                  A chart is not a quote. The swap panel verifies the mint,
                  compares available routes and simulates the prepared
                  transaction. Review fees, slippage and minimum received before
                  signing.
                </p>
              </details>
              <p className={styles.executionNote}>
                Protected attempt?{" "}
                <a href="#terminal-account">
                  Check the original receipt below.
                </a>{" "}
                Never repeat it to force completion.
              </p>
            </section>
          </TerminalBoundary>
          {client ? (
            <details className={styles.riskDisclosure}>
              <summary className="focus-ring">
                Mint facts <span>Authorities &amp; recorded checks</span>
              </summary>
              <ConnectedRisk
                key={`risk:${selected.mint}`}
                client={client}
                mint={selected.mint}
                now={now}
              />
            </details>
          ) : null}
        </aside>
      </div>
      <section
        id="terminal-account"
        className={styles.accountWorkspace}
        aria-labelledby="terminal-account-title"
        tabIndex={-1}
      >
        <div className={styles.sectionHeading}>
          <h2 id="terminal-account-title">Your workspace</h2>
          <p>Wallet · watches · original receipts</p>
        </div>
        {client && (
          <AccountPanels
            key={selected.mint}
            client={client}
            selected={selected}
            onSelect={selectToken}
          />
        )}
      </section>
      {renderUtilities && (
        <section
          id="terminal-utilities"
          className={styles.utilities}
          aria-labelledby="terminal-context-title"
        >
          <div className={styles.sectionHeading}>
            <h2 id="terminal-context-title">Research &amp; community</h2>
            <p>More context for the selected mint, separate from execution.</p>
          </div>
          {renderUtilities(selected.mint)}
        </section>
      )}
      <TerminalBoundary label="Treasury transparency">
        <TransparencyPanel />
      </TerminalBoundary>
      <p className={styles.footer}>
        Market discovery is limited to sampled source coverage under existing
        free-tier caps. Missing values stay unavailable; FDV is never
        substituted for market cap. Token names, images and links are untrusted
        project metadata. Nothing listed here is an endorsement or investment
        advice.
      </p>
    </div>
  );
}

function ConnectedRisk({
  client,
  mint,
  now,
}: {
  client: CommerceWalletClient;
  mint: string;
  now: number;
}) {
  const identity = useCommerceIdentity(client, "solana:signTransaction");
  const wallet = identity.linked ? identity.connected!.account.address : null;
  return (
    <TerminalBoundary label="Mint facts">
      <RiskPanel mint={mint} wallet={wallet} now={now} />
    </TerminalBoundary>
  );
}

function SelectedSwap({
  client,
  token,
}: {
  client: CommerceWalletClient;
  token: MarketChoice;
}) {
  const identity = useCommerceIdentity(client, "solana:signTransaction");
  const wallet = identity.linked ? identity.connected!.account.address : null;
  if (!wallet)
    return (
      <div>
        <CommerceWalletButton requiredFeature="solana:signTransaction" />
        <p className={`${styles.muted} mt-3`}>
          Use the wallet linked to your forum account. Connecting does not
          authorize a payment.
        </p>
      </div>
    );
  return (
    <ResolvedSwap
      key={`${wallet}:${token.mint}`}
      wallet={wallet}
      token={token}
    />
  );
}

function ResolvedSwap({
  wallet,
  token,
}: {
  wallet: string;
  token: MarketChoice;
}) {
  const resolve = useAction(api.forumCommerce.resolveMint);
  const [verified, setVerified] = useState<TradeToken | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void resolve({ wallet, mint: token.mint })
      .then((result) => {
        if (!cancelled && result.mint === token.mint) {
          setVerified(result);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet, token.mint, resolve, revision]);
  if (!verified)
    return (
      <div>
        <p role="status" className={styles.muted}>
          {failed
            ? "This mint could not be verified for trading. No wallet request was made."
            : "Verifying the exact mint and token program…"}
        </p>
        {failed && (
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              setFailed(false);
              setRevision((value) => value + 1);
            }}
          >
            Retry mint check
          </Button>
        )}
      </div>
    );
  return <TokenSwap outputToken={verified} />;
}

function AccountPanels({
  client,
  selected,
  onSelect,
}: {
  client: CommerceWalletClient;
  selected: MarketChoice;
  onSelect: (token: MarketChoice) => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const identity = useCommerceIdentity(client, "solana:signTransaction");
  const wallet = identity.linked ? identity.connected!.account.address : null;
  if (!isAuthenticated)
    return (
      <section className={styles.panel}>
        <div className={styles.body}>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Wallet className="size-4" aria-hidden="true" />
            Your wallet, watchlist and alerts
          </h2>
          <p className={`${styles.muted} mt-2`}>
            Sign in to save token watches and view private operation receipts.
            Public research and discussion remain free.
          </p>
          <ForumLink
            className="mt-2 inline-flex min-h-10 items-center text-sm text-primary underline underline-offset-4"
            href="/signin?redirectTo=/trade"
          >
            Sign in
          </ForumLink>
        </div>
      </section>
    );
  return (
    <>
      <div className={styles.below}>
        {wallet ? (
          <TerminalBoundary label="Wallet balances">
            <WalletPanel
              key={`${wallet}:${selected.mint}`}
              wallet={wallet}
              selectedMint={selected.mint}
              selectedSymbol={selected.symbol}
            />
          </TerminalBoundary>
        ) : (
          <section className={styles.panel}>
            <div className={styles.body}>
              <h2 className="text-sm font-semibold">Your wallet</h2>
              <p className={`${styles.muted} mt-2`}>
                Connect a wallet linked to this account to read your SOL and
                selected-token balances.
              </p>
              <div className="mt-3">
                <CommerceWalletButton requiredFeature="solana:signTransaction" />
              </div>
            </div>
          </section>
        )}
        <TerminalBoundary label="Watchlist and alerts">
          <WatchlistPanel
            key={selected.mint}
            selected={selected}
            onSelect={onSelect}
          />
        </TerminalBoundary>
      </div>
      <TerminalBoundary label="Swap history">
        <SwapHistory />
      </TerminalBoundary>
    </>
  );
}
