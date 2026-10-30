"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAction, useConvexAuth } from "convex/react";
import { ArrowUpRight, Wallet } from "lucide-react";
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
import { MarketPanel, symfChoice, type MarketChoice } from "./market-panel";
import { TokenDetail, RiskPanel } from "./token-detail";
import { TerminalBoundary } from "./terminal-boundary";
import { SwapHistory, WalletPanel } from "./wallet-panel";
import { WatchlistPanel } from "./watchlist-panel";
import { TransparencyPanel } from "./transparency-panel";
import styles from "./forum-terminal.module.css";

export type ForumTerminalProps = {
  enabled: boolean;
  renderUtilities?: (mint: string) => ReactNode;
};

export function ForumTerminal({
  enabled,
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
      <TerminalWorkspace renderUtilities={renderUtilities} />
    </CommerceWalletProvider>
  );
}

function TerminalWorkspace({
  renderUtilities,
}: Pick<ForumTerminalProps, "renderUtilities">) {
  const client = useCommerceWallet();
  const [selected, setSelected] = useState<MarketChoice>(symfChoice);
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
        <div>
          <h1>Research. Discuss. Trade.</h1>
          <p>
            Solana markets alongside the people and agents following them.
            Compare live routes, check the mint and keep your wallet in control.
          </p>
        </div>
        <ForumLink
          href="/forum/crypto"
          className={`${styles.headerLink} focus-ring`}
        >
          Web3 discussions
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </ForumLink>
      </header>
      <div className={styles.layout}>
        <TerminalBoundary label="Token discovery">
          <MarketPanel
            selected={selected.mint}
            onSelect={setSelected}
            now={now}
          />
        </TerminalBoundary>
        <div className={styles.stack}>
          <TerminalBoundary key={selected.mint} label="Selected token data">
            <TokenDetail token={selected} now={now} />
          </TerminalBoundary>
          {client ? (
            <ConnectedRisk
              key={selected.mint}
              client={client}
              mint={selected.mint}
              now={now}
            />
          ) : null}
        </div>
        <aside className={styles.aside} aria-label="Trade selected token">
          <TerminalBoundary label="Wallet and swap">
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Trade ${selected.symbol}</h2>
                  <p>Fresh quotes. Explicit wallet approval.</p>
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
            </section>
          </TerminalBoundary>
          <section
            className={styles.panel}
            aria-labelledby="terminal-execution-title"
          >
            <div className={styles.body}>
              <h2
                id="terminal-execution-title"
                className="text-sm font-semibold"
              >
                Before you approve
              </h2>
              <p className={`${styles.muted} mt-2`}>
                A chart is not a quote. The swap panel verifies the mint,
                compares available routes and simulates the prepared
                transaction. Fees, slippage and minimum received are shown
                before signing.
              </p>
              <p className={`${styles.muted} mt-3`}>
                If an outcome is uncertain, the original attempt stays
                protected. Never repeat it to try to force completion.
              </p>
            </div>
          </section>
        </aside>
      </div>
      {client && (
        <AccountPanels
          key={selected.mint}
          client={client}
          selected={selected}
          onSelect={setSelected}
        />
      )}
      {renderUtilities && (
        <div id="terminal-utilities">{renderUtilities(selected.mint)}</div>
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
