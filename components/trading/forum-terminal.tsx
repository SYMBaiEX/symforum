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
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Landmark,
  ListFilter,
  PanelsTopLeft,
  ReceiptText,
  Users,
  Wallet,
  X,
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
import {
  TerminalAttentionProvider,
  useTerminalAttentionSnapshot,
} from "./terminal-attention";
import styles from "./forum-terminal.module.css";

const toolGroups = [
  {
    label: "Account",
    items: [
      {
        value: "wallet",
        label: "Wallet & watches",
        description: "Balances, token watches and alerts.",
        icon: Wallet,
      },
      {
        value: "receipts",
        label: "Swap receipts",
        description: "Original swap records and protected attempts.",
        icon: ReceiptText,
      },
    ],
  },
  {
    label: "Research & community",
    items: [
      {
        value: "research",
        label: "Research",
        description: "Research access and its payment receipts.",
        icon: BookOpen,
      },
      {
        value: "community",
        label: "Community",
        description: "Project hubs, tips, bounties and community receipts.",
        icon: Users,
      },
    ],
  },
  {
    label: "Transparency",
    items: [
      {
        value: "treasury",
        label: "Treasury & burns",
        description: "Recorded platform fees and token burns.",
        icon: Landmark,
      },
    ],
  },
] as const;

export type ForumTerminalProps = {
  enabled: boolean;
  initialMint?: string;
  renderUtilities?: (
    mint: string,
    active: "research" | "community",
  ) => ReactNode;
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
      <TerminalAttentionProvider>
        <TerminalWorkspace
          initialMint={initialMint}
          renderUtilities={renderUtilities}
        />
      </TerminalAttentionProvider>
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
  const [pane, setPane] = useState<
    "chart" | "markets" | "trade" | "receipts" | "tools"
  >("chart");
  const [tool, setTool] = useState<
    "wallet" | "receipts" | "research" | "community" | "treasury" | null
  >(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const toolTrigger = useRef<HTMLElement | null>(null);
  const attention = useTerminalAttentionSnapshot();
  const chartTab = useRef<HTMLButtonElement>(null);
  const marketsTab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const root = workspace.current;
    const viewport = window.visualViewport;
    if (!root || !viewport) return;
    const update = () => {
      // Keyboard sizing is local to this workspace. Pinch zoom must retain
      // browser-controlled layout rather than treating magnification as a keyboard.
      if (
        Math.abs(viewport.scale - 1) > 0.01 ||
        !Number.isFinite(viewport.height) ||
        viewport.height <= 0
      )
        root.style.removeProperty("--terminal-visible-height");
      else
        root.style.setProperty(
          "--terminal-visible-height",
          `${viewport.height}px`,
        );
    };
    update();
    viewport.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      root.style.removeProperty("--terminal-visible-height");
    };
  }, []);
  useEffect(() => {
    const root = workspace.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    let wasWide = root.clientWidth > 840;
    const observer = new ResizeObserver(([entry]) => {
      const wide = entry.contentRect.width > 840;
      if (wasWide && !wide) {
        const order = root.querySelector<HTMLElement>("[data-terminal-order]");
        // A portalled picker stays open across CSS breakpoints. Keep its
        // original trigger visible so closing it can restore keyboard focus.
        if (
          order?.querySelector('[aria-haspopup="dialog"][data-state="open"]') ||
          order?.contains(document.activeElement)
        )
          setPane("trade");
      }
      wasWide = wide;
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  function focusPane(id: string) {
    requestAnimationFrame(() =>
      document.getElementById(id)?.focus({ preventScroll: true }),
    );
  }
  function openView(next: "chart" | "markets", focus = false) {
    setView(next);
    setPane(next);
    if (focus) focusPane(`terminal-${next}`);
  }
  function openTool(next: typeof tool, trigger?: HTMLElement) {
    if (trigger) toolTrigger.current = trigger;
    setTool(next);
    setDrawerOpen(true);
    setPane(next === "receipts" ? "receipts" : "tools");
    focusPane("terminal-tool-title");
  }
  function closeTools() {
    setDrawerOpen(false);
    setPane(view);
    requestAnimationFrame(() => {
      const previous = toolTrigger.current;
      if (previous?.getClientRects().length)
        previous.focus({ preventScroll: true });
      else {
        const fallback = workspace.current?.querySelector<HTMLElement>(
          '[data-terminal-dock="tools"]',
        );
        if (fallback?.getClientRects().length)
          fallback.focus({ preventScroll: true });
        else chartTab.current?.focus({ preventScroll: true });
      }
    });
  }
  function selectToken(token: MarketChoice) {
    setSelected(token);
    openView("chart");
    requestAnimationFrame(() => {
      if (chartTab.current?.getClientRects().length)
        chartTab.current.focus({ preventScroll: true });
      else
        document
          .getElementById("terminal-chart")
          ?.focus({ preventScroll: true });
    });
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
    openView(next);
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
    <div
      ref={workspace}
      className={styles.page}
      data-terminal-viewport
      data-pane={pane}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 aria-label="Trading terminal">
            <span className={styles.desktopTitle}>Trading terminal</span>
            <span className={styles.compactTitle} aria-hidden="true">
              Terminal
            </span>
          </h1>
          <span className={styles.network}>Solana</span>
        </div>
        <div
          role="tablist"
          aria-label="Terminal views"
          className={styles.viewTabs}
          data-terminal-header-tabs
        >
          <button
            ref={chartTab}
            id="terminal-chart-tab"
            type="button"
            role="tab"
            aria-selected={view === "chart"}
            aria-controls="terminal-chart"
            tabIndex={view === "chart" ? 0 : -1}
            onClick={() => openView("chart")}
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
            onClick={() => openView("markets")}
            onKeyDown={navigateViews}
          >
            <ListFilter size={15} aria-hidden="true" /> Markets
          </button>
        </div>
        <nav className={styles.headerActions} aria-label="Terminal shortcuts">
          <span
            className={styles.headerToken}
            data-terminal-header-token
            title={selected.mint}
          >
            {selected.symbol === "TOKEN"
              ? "Selected token"
              : `$${selected.symbol}`}
          </span>
          <ForumLink
            href="/forum/crypto"
            className={`${styles.headerLink} focus-ring`}
          >
            Web3 discussions
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </ForumLink>
        </nav>
      </header>
      {attention.length > 0 && (
        <div
          className={styles.attention}
          role="status"
          aria-label="Known protected operations"
        >
          <span>Known protected</span>
          {attention.map(({ target, count }) => (
            <button
              key={target}
              type="button"
              onClick={(event) => openTool(target, event.currentTarget)}
            >
              {target === "receipts"
                ? "Swap receipts"
                : target === "research"
                  ? "Research"
                  : "Community"}{" "}
              · {count} protected
            </button>
          ))}
        </div>
      )}
      <div className={styles.layout} data-terminal-layout data-pane={pane}>
        <div className={styles.analysis} data-terminal-analysis>
          <div className={styles.analysisMain} data-terminal-analysis-main>
            <div
              id="terminal-chart"
              role="tabpanel"
              aria-labelledby="terminal-chart-tab"
              hidden={view !== "chart"}
              className={styles.chartWorkspace}
              tabIndex={-1}
              aria-label="Chart workspace"
            >
              <TerminalBoundary
                key={`market:${selected.mint}`}
                label="Selected token data"
              >
                <TokenDetail
                  token={selected}
                  now={now}
                  onBrowseMarkets={() => openView("markets", true)}
                />
              </TerminalBoundary>
            </div>
            <div
              id="terminal-markets"
              role="tabpanel"
              aria-labelledby="terminal-markets-tab"
              hidden={view !== "markets"}
              className={styles.marketsWorkspace}
              tabIndex={-1}
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
          <section
            id="terminal-tools"
            className={styles.toolsDrawer}
            data-terminal-tools
            aria-label="Terminal tools"
            hidden={!drawerOpen}
            data-expanded={expanded}
            onKeyDown={(event) => {
              if (
                event.key !== "Escape" ||
                event.defaultPrevented ||
                (event.target instanceof Element &&
                  event.target.closest('[role="dialog"]'))
              )
                return;
              event.preventDefault();
              closeTools();
            }}
          >
            <div className={styles.toolsHeading}>
              <h2 id="terminal-tool-title" tabIndex={-1}>
                {tool === "wallet"
                  ? "Wallet & watches"
                  : tool === "receipts"
                    ? "Swap receipts"
                    : tool === "research"
                      ? "Research"
                      : tool === "community"
                        ? "Community"
                        : tool === "treasury"
                          ? "Treasury & burns"
                          : "Terminal tools"}
              </h2>
              <div>
                {tool && (
                  <button
                    className={styles.allToolsButton}
                    type="button"
                    onClick={() => openTool(null)}
                  >
                    <ChevronLeft size={15} aria-hidden="true" />
                    All tools
                  </button>
                )}
                <button
                  data-terminal-resize
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  aria-label={
                    expanded ? "Compact tools panel" : "Expand tools panel"
                  }
                  aria-expanded={expanded}
                >
                  {expanded ? (
                    <ChevronDown size={16} aria-hidden="true" />
                  ) : (
                    <ChevronUp size={16} aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={closeTools}
                  aria-label="Close tools panel"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div
              className={styles.toolsContent}
              tabIndex={0}
              role="region"
              aria-label="Active terminal tool"
            >
              <div className={styles.toolMenu} hidden={tool !== null}>
                {toolGroups.map((group) => (
                  <section key={group.label} aria-label={group.label}>
                    <h3>{group.label}</h3>
                    <ul>
                      {group.items.map(
                        ({ value, label, description, icon: Icon }) => (
                          <li key={value}>
                            <button
                              type="button"
                              aria-label={label}
                              aria-describedby={`terminal-tool-${value}-description`}
                              onClick={() => openTool(value)}
                            >
                              <Icon
                                className={styles.toolIcon}
                                size={18}
                                aria-hidden="true"
                              />
                              <span>
                                <strong>{label}</strong>
                                <small
                                  id={`terminal-tool-${value}-description`}
                                >
                                  {description}
                                </small>
                              </span>
                              <ChevronRight size={16} aria-hidden="true" />
                            </button>
                          </li>
                        ),
                      )}
                    </ul>
                  </section>
                ))}
              </div>
              <section
                id="terminal-account"
                hidden={tool !== "wallet" && tool !== "receipts"}
                className={styles.accountWorkspace}
                aria-label="Your workspace"
              >
                {client && (
                  <AccountPanels
                    key={selected.mint}
                    client={client}
                    selected={selected}
                    onSelect={selectToken}
                    active={tool === "receipts" ? "receipts" : "wallet"}
                    visible={drawerOpen && tool === "wallet"}
                  />
                )}
              </section>
              <div
                id="terminal-utilities"
                hidden={tool !== "research" && tool !== "community"}
                className={styles.utilities}
              >
                {renderUtilities?.(
                  selected.mint,
                  tool === "community" ? "community" : "research",
                )}
              </div>
              <div hidden={tool !== "treasury"}>
                <TerminalBoundary label="Treasury transparency">
                  <TransparencyPanel />
                </TerminalBoundary>
                <p className={styles.footer}>
                  Market discovery uses sampled source coverage under existing
                  free-tier caps. Missing values stay unavailable; FDV is not
                  market cap. Token names, images and links are untrusted
                  project metadata, not an endorsement or investment advice.
                </p>
              </div>
            </div>
          </section>
        </div>
        <aside
          id="terminal-order"
          className={styles.aside}
          data-terminal-order
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
                  signing. If an attempt is protected, check its original
                  receipt below. Never repeat it to force completion.
                </p>
              </details>
              <p className={styles.executionNote}>
                <button
                  type="button"
                  onClick={(event) => openTool("receipts", event.currentTarget)}
                >
                  Receipts &amp; protected attempts
                </button>
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
      <nav
        className={styles.dock}
        data-terminal-dock-nav
        aria-label="Terminal dock"
      >
        <button
          className={styles.mobileDock}
          data-terminal-dock-mode="mobile"
          data-terminal-dock="chart"
          type="button"
          aria-pressed={pane === "chart"}
          onClick={() => openView("chart", true)}
        >
          <ChartNoAxesCombined size={17} aria-hidden="true" />
          Chart
        </button>
        <button
          className={styles.mobileDock}
          data-terminal-dock-mode="mobile"
          data-terminal-dock="markets"
          type="button"
          aria-pressed={pane === "markets"}
          onClick={() => openView("markets", true)}
        >
          <ListFilter size={17} aria-hidden="true" />
          Markets
        </button>
        <button
          className={styles.mobileDock}
          data-terminal-dock-mode="mobile"
          data-terminal-dock="trade"
          type="button"
          aria-pressed={pane === "trade"}
          onClick={() => {
            setPane("trade");
            focusPane("terminal-order");
          }}
        >
          <Wallet size={17} aria-hidden="true" />
          Trade
        </button>
        <button
          data-terminal-dock-mode="desktop"
          data-terminal-dock="wallet"
          type="button"
          aria-pressed={drawerOpen && tool === "wallet"}
          onClick={(event) => openTool("wallet", event.currentTarget)}
        >
          <Wallet size={15} aria-hidden="true" />
          Wallet &amp; watches
        </button>
        <button
          data-terminal-dock="receipts"
          data-terminal-dock-mode="desktop"
          type="button"
          aria-pressed={drawerOpen && tool === "receipts"}
          onClick={(event) => openTool("receipts", event.currentTarget)}
        >
          <ReceiptText size={17} aria-hidden="true" />
          Receipts
        </button>
        <button
          className={styles.mobileDock}
          data-terminal-dock="receipts"
          data-terminal-dock-mode="mobile"
          type="button"
          aria-pressed={pane === "receipts"}
          onClick={(event) => openTool("receipts", event.currentTarget)}
        >
          <ReceiptText size={17} aria-hidden="true" />
          Receipts
        </button>
        {(
          [
            ["research", "Research"],
            ["community", "Community"],
            ["treasury", "Treasury"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            data-terminal-dock-mode="desktop"
            type="button"
            data-terminal-dock={value}
            aria-pressed={drawerOpen && tool === value}
            onClick={(event) => openTool(value, event.currentTarget)}
          >
            {label}
          </button>
        ))}
        <button
          className={styles.mobileDock}
          data-terminal-dock-mode="mobile"
          data-terminal-dock="tools"
          type="button"
          aria-pressed={pane === "tools"}
          onClick={(event) => openTool(null, event.currentTarget)}
        >
          <PanelsTopLeft size={17} aria-hidden="true" />
          Tools
        </button>
      </nav>
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
  active,
  visible = true,
}: {
  client: CommerceWalletClient;
  selected: MarketChoice;
  onSelect: (token: MarketChoice) => void;
  active: "wallet" | "receipts";
  visible?: boolean;
}) {
  const { isAuthenticated } = useConvexAuth();
  const identity = useCommerceIdentity(client, "solana:signTransaction");
  const wallet = identity.linked ? identity.connected!.account.address : null;
  if (!isAuthenticated)
    return (
      <section className={styles.panel}>
        <div className={styles.body}>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {active === "receipts" ? (
              <ReceiptText className="size-4" aria-hidden="true" />
            ) : (
              <Wallet className="size-4" aria-hidden="true" />
            )}
            {active === "receipts"
              ? "Swap receipts"
              : "Your wallet, watchlist and alerts"}
          </h2>
          <p className={`${styles.muted} mt-2`}>
            {active === "receipts"
              ? "Sign in to view your original swap records and protected attempts. Only your account can access these receipts."
              : "Sign in to save token watches and view private operation receipts. Public research and discussion remain free."}
          </p>
          <ForumLink
            className="mt-2 inline-flex min-h-10 items-center text-sm text-primary underline underline-offset-4"
            href="/signin?redirectTo=/trade"
          >
            {active === "receipts"
              ? "Sign in to view swap receipts"
              : "Sign in"}
          </ForumLink>
        </div>
      </section>
    );
  return (
    <>
      <div className={styles.below} hidden={active !== "wallet"}>
        {wallet ? (
          <TerminalBoundary label="Wallet balances">
            <WalletPanel
              key={`${wallet}:${selected.mint}`}
              wallet={wallet}
              selectedMint={selected.mint}
              selectedSymbol={selected.symbol}
              active={visible && active === "wallet"}
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
      <div hidden={active !== "receipts"}>
        <TerminalBoundary label="Swap history">
          <SwapHistory />
        </TerminalBoundary>
      </div>
    </>
  );
}
