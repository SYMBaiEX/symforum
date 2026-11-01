"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  getBase64EncodedWireTransaction,
  isTransactionModifyingSigner,
} from "@solana/kit";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import type { ClientSvmSigner } from "@x402/svm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  CommerceWalletButton,
  useCommerceIdentity,
  useCommerceWallet,
} from "@/components/swap/commerce-wallet";
import type { CommerceWalletClient } from "@/lib/commerce-wallet-client";
import { supportsCommerceTransaction } from "@/lib/commerce-wallet-client";
import {
  RESEARCH_TREASURY,
  researchPaymentRequired,
} from "@/lib/forum-research";
import type { ResearchReport, ResearchState } from "@/lib/forum-research";
import { useTerminalAttention } from "./terminal-attention";
import { researchExportPreviewJson } from "./research-export-preview";
import {
  researchReceiptView,
  type ReceiptFilter,
} from "./research-receipt-view";

type Quote = {
  intentKey: string;
  expiresAt: number;
  requirementsJson: string;
  resource: string;
};
type Receipt = {
  intentKey: string;
  mint: string;
  state: ResearchState;
  createdAt: number;
  expiresAt: number;
  signature: string | null;
  finalizedAt: number | null;
  report: ResearchReport | null;
};
const configRef = makeFunctionReference<
  "query",
  { now: number },
  {
    enabled: boolean;
    amountRaw: string;
    asset: string;
    network: string;
    product: string;
    priceLabel: string;
    reason: "ready" | "setup_required" | "free_credits_exhausted";
  }
>("forumResearch:getConfig");
const quoteRef = makeFunctionReference<
  "action",
  { wallet: string; mint: string; idempotencyKey: string },
  Quote
>("forumResearchActions:quote");
const statusRef = makeFunctionReference<
  "query",
  { intentKey: string },
  Receipt
>("forumResearch:status");
const historyRef = makeFunctionReference<
  "query",
  Record<string, never>,
  Receipt[]
>("forumResearch:listMine");
const simulateRef = makeFunctionReference<
  "action",
  { intentKey: string; transactionBase64: string },
  null
>("forumResearchActions:simulate");
const payRef = makeFunctionReference<
  "action",
  { intentKey: string; paymentHeader: string },
  { state: "protected" | "rejected" | "fulfilled"; signature: string | null }
>("forumResearchActions:pay");
const checkRef = makeFunctionReference<
  "action",
  { intentKey: string },
  boolean
>("forumResearchActions:check");

/** Presentation only: never drives config reads, quotes or payment recovery. */
function useQuotedIntentClock(prepared: Quote | null, active: boolean) {
  const intentKey = prepared?.intentKey;
  const deadline = prepared?.expiresAt;
  const validDeadline =
    typeof deadline === "number" &&
    Number.isFinite(deadline) &&
    deadline > 0 &&
    deadline <= 8_640_000_000_000_000;
  const [tick, setTick] = useState<{
    intentKey: string;
    deadline: number;
    now: number;
    foreground: boolean;
  } | null>(null);
  useEffect(() => {
    if (!active || !intentKey || !validDeadline || deadline === undefined)
      return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
    };
    const sync = () => {
      if (stopped) return;
      clearTimeout(timer);
      const current = Date.now();
      const foreground = document.visibilityState !== "hidden";
      setTick({ intentKey, deadline, now: current, foreground });
      if (!foreground) return;
      if (current >= deadline) {
        stop();
        return;
      }
      timer = setTimeout(sync, Math.min(1000, deadline - current));
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    sync();
    return stop;
  }, [active, intentKey, deadline, validDeadline]);
  const currentTick =
    active &&
    tick !== null &&
    tick.intentKey === intentKey &&
    tick.deadline === deadline
      ? tick
      : null;
  const current = currentTick?.now ?? Date.now();
  return {
    active,
    expired: deadline !== undefined && deadline <= current,
    remainingSeconds: validDeadline
      ? Math.max(0, Math.ceil((deadline! - current) / 1000))
      : null,
    dateTime: validDeadline ? new Date(deadline!).toISOString() : null,
    foreground:
      currentTick?.foreground ??
      (typeof document === "undefined" ||
        document.visibilityState !== "hidden"),
  };
}

export function ResearchPurchase({ mint }: { mint: string }) {
  const client = useCommerceWallet();
  return client ? (
    <ResearchPurchaseConnected key={mint} mint={mint} client={client} />
  ) : (
    <p className="text-sm text-muted-foreground" role="status">
      Wallet services are loading. Research payment readiness has not been
      checked.
    </p>
  );
}
function ResearchPurchaseConnected({
  mint,
  client,
}: {
  mint: string;
  client: CommerceWalletClient;
}) {
  const { isAuthenticated } = useConvexAuth();
  const { connected, linked, session } = useCommerceIdentity(
    client,
    "solana:signTransaction",
  );
  const [now, setNow] = useState(
    () => Math.floor(Date.now() / 60_000) * 60_000,
  );
  const config = useQuery(configRef, { now });
  const readinessId = useId();
  const readiness = !config
    ? "loading"
    : config.enabled && config.reason === "ready"
      ? "ready"
      : !config.enabled && config.reason === "setup_required"
        ? "setup"
        : !config.enabled && config.reason === "free_credits_exhausted"
          ? "exhausted"
          : "unavailable";
  const readinessLabel = {
    loading: "Checking research payment readiness…",
    ready: "Research payments are available for review.",
    setup: "Research payments need setup.",
    exhausted: "Research payments are paused.",
    unavailable: "Research payment readiness is unavailable.",
  }[readiness];
  const readinessHelp = {
    loading:
      "Availability is not confirmed yet. No wallet action is needed to check it.",
    ready:
      "Source coverage and payment readiness are checked again before a quote. Reviewing an export does not authorize payment.",
    setup:
      "Payments open only after treasury, facilitator and free-credit checks pass. No wallet action is needed while setup is incomplete.",
    exhausted:
      "The free facilitator allowance is exhausted. Payments are paused; no paid upgrade will be used.",
    unavailable:
      "Payments stay closed until availability can be confirmed. No wallet action is needed.",
  }[readiness];
  const history = useQuery(historyRef, isAuthenticated ? {} : "skip");
  const quote = useAction(quoteRef),
    simulate = useAction(simulateRef),
    pay = useAction(payRef),
    check = useAction(checkRef);
  const [open, setOpen] = useState(false),
    [prepared, setPrepared] = useState<Quote | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receiptMessage, setReceiptMessage] = useState("");
  const lock = useRef(false);
  const reviewTrigger = useRef<HTMLButtonElement>(null);
  const reviewSurface = useRef<HTMLElement>(null);
  const receipt = useQuery(
    statusRef,
    prepared && isAuthenticated ? { intentKey: prepared.intentKey } : "skip",
  );
  const quoteExpiry = useQuotedIntentClock(
    prepared,
    open && receipt?.state === "quoted" && !busy,
  );
  const held = history?.find((item) =>
    ["verifying", "settlement_claimed", "unknown"].includes(item.state),
  );
  const protectedIntents = new Set(
    isAuthenticated
      ? history
          ?.filter((item) =>
            ["verifying", "settlement_claimed", "unknown"].includes(item.state),
          )
          .map((item) => item.intentKey)
      : [],
  );
  if (
    isAuthenticated &&
    receipt &&
    ["verifying", "settlement_claimed", "unknown"].includes(receipt.state)
  )
    protectedIntents.add(receipt.intentKey);
  useTerminalAttention("research", protectedIntents.size);
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 60_000) * 60_000),
      60_000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (receipt?.state !== "unknown" || !receipt.signature) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let count = 0;
    const poll = () => {
      timer = setTimeout(async () => {
        if (stopped) return;
        try {
          if (await check({ intentKey: receipt.intentKey })) return;
        } catch {
          /* Keep the durable hold; never retry payment. */
        }
        if (!stopped && ++count < 4) poll();
      }, 12_000);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [receipt?.state, receipt?.signature, receipt?.intentKey, check]);
  const verifySaved = async (intentKey: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setReceiptMessage("");
    try {
      setReceiptMessage(
        (await check({ intentKey }))
          ? "Finalized receipt verified. Your report is available below."
          : "Finality is not proven yet. The saved payment stays protected; nothing was resent.",
      );
    } catch {
      setReceiptMessage(
        "Receipt verification is unavailable. The saved payment stays protected; nothing was resent.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const review = async () => {
    if (!connected || !linked || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      setPrepared(
        await quote({
          wallet: connected.account.address,
          mint,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      setOpen(true);
    } catch {
      setError(
        "Fresh citable coverage or payment readiness is unavailable. Nothing was charged.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const approve = async () => {
    if (
      !prepared ||
      !connected ||
      !linked ||
      lock.current ||
      prepared.expiresAt <= Date.now()
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    let settlementRequested = false;
    try {
      const current = client.wallet.getState().connected;
      if (
        !current ||
        !current.signer ||
        current.account.address !== connected.account.address ||
        !supportsCommerceTransaction(client, 0, true) ||
        !isTransactionModifyingSigner(current.signer)
      )
        throw new Error("Wallet changed");
      const walletSigner = current.signer;
      // A sign-only projection: the x402 SDK never receives a send capability.
      const signer: ClientSvmSigner = {
        address: walletSigner.address,
        modifyAndSignTransactions: async (transactions, options) => {
          if (
            transactions.length !== 1 ||
            client.wallet.getState().connected?.account.address !==
              current.account.address
          )
            throw new Error("Wallet changed");
          await simulate({
            intentKey: prepared.intentKey,
            transactionBase64: getBase64EncodedWireTransaction(transactions[0]),
          });
          return await walletSigner.modifyAndSignTransactions(
            transactions,
            options,
          );
        },
      };
      const requirements = JSON.parse(
        prepared.requirementsJson,
      ) as PaymentRequirements;
      const x402 = new x402Client().register(
        requirements.network,
        new ExactSvmScheme(signer, {
          rpcUrl: `${location.origin}/api/research/rpc?intentKey=${prepared.intentKey}`,
        }),
      );
      const payload = await x402.createPaymentPayload(
        researchPaymentRequired(prepared.intentKey, requirements),
      );
      settlementRequested = true;
      await pay({
        intentKey: prepared.intentKey,
        paymentHeader: encodePaymentSignatureHeader(payload),
      });
    } catch {
      setError(
        settlementRequested
          ? "Payment verification is protected. Check this saved receipt; do not repeat payment."
          : "Preparation or signing did not complete. The app did not request settlement.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      ref={reviewSurface}
      tabIndex={-1}
      className="focus-ring rounded-xl border bg-card p-4 text-card-foreground"
      aria-labelledby="research-purchase-heading"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="research-purchase-heading" className="font-semibold">
            Token research export
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            A timestamped, source-backed brief with liquidity and turnover
            analysis. No new AI spend.
          </p>
        </div>
        <span className="shrink-0 text-sm font-medium">$0.10 USDC</span>
      </div>
      <p className="my-3 text-xs text-muted-foreground">
        Optional Solana x402 purchase. Forum content stays free. No recurring
        charges or automatic payments.
      </p>
      <details className="mb-3 min-w-0 text-sm">
        <summary className="focus-ring min-h-11 cursor-pointer content-center">
          Preview export format &amp; methodology
        </summary>
        <div className="min-w-0 space-y-3 pb-3 [overflow-wrap:anywhere]">
          <p className="font-medium">
            Illustrative schema only · not a generated report
          </p>
          <p>
            This preview describes the JSON fields, not current token data.
            Opening it does not request a quote, contact a wallet or authorize
            payment.
          </p>
          <h4 className="font-semibold">How the export is assembled</h4>
          <p>
            The versioned export deterministically assembles timestamped public
            observations with a recorded market source and forum coverage. Both
            citations and source freshness must pass checks before quotation. No
            new model call is made. Coverage is sampled, not an exhaustive
            ranking.
          </p>
          <p>
            Facts include reported price, market capitalization (not FDV), pool
            liquidity, one-hour volume, holder count and one-hour price change.
            Missing metrics remain unavailable, not zero. Export creation time
            (generatedAt) is separate from source observation time
            (metricsAsOf). These are snapshots, not live prices or executable
            quotes.
          </p>
          <p>
            Analysis uses liquidity / market capitalization and one-hour volume
            / market capitalization when calculable. Ratios do not prove safe
            exits, organic demand, holder concentration, audit status or future
            returns. This is not investment advice or an endorsement. The charge
            buys this versioned export; existing forum content stays free.
          </p>
          <pre
            className="max-h-64 min-w-0 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-sm leading-6 [overflow-wrap:anywhere]"
            tabIndex={0}
            aria-label="Illustrative research export JSON schema"
          >
            {researchExportPreviewJson}
          </pre>
        </div>
      </details>
      <div
        id={readinessId}
        role="status"
        className="mb-3 rounded-lg bg-muted p-3 text-sm"
      >
        <p className="font-medium">{readinessLabel}</p>
        <p className="mt-1 text-xs text-muted-foreground">{readinessHelp}</p>
      </div>
      {!linked || !connected ? (
        <CommerceWalletButton
          requiredFeature="solana:signTransaction"
          disabled={busy || readiness !== "ready"}
        />
      ) : (
        <Button
          ref={reviewTrigger}
          onClick={() => void review()}
          disabled={busy || readiness !== "ready" || !!held}
          aria-describedby={readinessId}
        >
          {busy
            ? "Preparing…"
            : held
              ? "Payment receipt protected"
              : "Review research export"}
        </Button>
      )}
      {held && (
        <p className="mt-2 text-sm" role="status">
          A previous payment is awaiting verified settlement.{" "}
          {held.signature ? (
            <a
              className="underline"
              href={`https://solscan.io/tx/${held.signature}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View transaction
            </a>
          ) : (
            "No validated transaction signature is available yet."
          )}
        </p>
      )}
      {held?.state === "unknown" && held.signature ? (
        <Button
          className="mt-2"
          variant="outline"
          disabled={busy}
          onClick={() => void verifySaved(held.intentKey)}
        >
          Verify saved receipt
        </Button>
      ) : null}
      {receiptMessage ? (
        <p className="mt-2 text-sm" role="status">
          {receiptMessage}
        </p>
      ) : null}
      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {isAuthenticated && (
        <ResearchReceiptLibrary
          key={session?.authUserId ?? "current-owner"}
          receipts={history}
          now={now}
        >
          {(visibleRows) => (
            <ul className="mt-3 space-y-3">
              {visibleRows.map((item) => (
                <li
                  key={item.intentKey}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="text-xs text-muted-foreground">
                    {item.mint.slice(0, 4)}…{item.mint.slice(-4)} ·{" "}
                    {item.state === "quoted" && item.expiresAt <= now
                      ? "expired quote"
                      : item.state.replaceAll("_", " ")}
                  </span>
                  {item.state === "unknown" && item.signature ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void verifySaved(item.intentKey)}
                    >
                      Verify saved receipt
                    </Button>
                  ) : null}
                  {item.state === "fulfilled" ? (
                    <a
                      className="text-xs underline"
                      href={`/api/research/token/${item.intentKey}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open report + receipt
                    </a>
                  ) : item.signature ? (
                    <a
                      className="text-xs underline"
                      href={`https://solscan.io/tx/${item.signature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View transaction
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      No finalized payment receipt
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ResearchReceiptLibrary>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent
          data-surface="forum"
          className="max-h-[85dvh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const visible = (node: HTMLElement | null) => {
              if (!node?.isConnected || !node.getClientRects().length)
                return false;
              for (
                let parent: HTMLElement | null = node;
                parent;
                parent = parent.parentElement
              ) {
                const style = getComputedStyle(parent);
                if (
                  style.display === "none" ||
                  style.visibility !== "visible" ||
                  Number(style.opacity) === 0
                )
                  return false;
              }
              const bounds = node.getBoundingClientRect();
              return (
                bounds.bottom > 0 &&
                bounds.top < innerHeight &&
                bounds.right > 0 &&
                bounds.left < innerWidth
              );
            };
            const trigger = reviewTrigger.current;
            if (trigger && !trigger.disabled && visible(trigger))
              trigger.focus({ preventScroll: true });
            else if (visible(reviewSurface.current))
              reviewSurface.current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle>Research export · $0.10 USDC</DialogTitle>
            <DialogDescription>
              One explicit payment on Solana mainnet. The facilitator pays the
              network fee. Your wallet signs only this exact purchase; no
              transaction is submitted by the app before approval.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Token mint</dt>
              <dd className="break-all font-mono text-xs">{mint}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Recipient</dt>
              <dd className="break-all font-mono text-xs">
                {RESEARCH_TREASURY}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">What you receive</dt>
              <dd>
                Versioned source metrics, explicit ratio analysis, caveats and
                JSON export. Not personalized investment advice.
              </dd>
            </div>
          </dl>
          {quoteExpiry.active && quoteExpiry.dateTime && (
            <section
              aria-label="Quote expiry"
              className="min-w-0 space-y-1 text-sm [overflow-wrap:anywhere]"
            >
              <p aria-live="off">
                Original quote deadline:{" "}
                <time dateTime={quoteExpiry.dateTime}>
                  {quoteExpiry.dateTime} (UTC)
                </time>
              </p>
              {!quoteExpiry.expired && (
                <p aria-live="off">
                  Quote expires in {quoteExpiry.remainingSeconds} seconds.
                </p>
              )}
              <p role="status" aria-live="polite">
                {quoteExpiry.expired && quoteExpiry.foreground
                  ? "Quote expired. Close this review to request a fresh quote. Nothing is retried automatically."
                  : ""}
              </p>
            </section>
          )}
          {receipt?.state === "fulfilled" && receipt.report ? (
            <div>
              <h4 className="mb-2 font-semibold">{receipt.report.title}</h4>
              <ul className="space-y-2 text-sm">
                {receipt.report.analysis.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <a
                className="mt-4 inline-block underline"
                href={`/api/research/token/${receipt.intentKey}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open verified report and receipt
              </a>
            </div>
          ) : ["verifying", "settlement_claimed", "unknown"].includes(
              receipt?.state ?? "",
            ) ? (
            <p role="status" className="text-sm">
              Settlement is being verified. This request cannot be paid again.{" "}
              {receipt?.signature && (
                <a
                  className="underline"
                  href={`https://solscan.io/tx/${receipt.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View transaction
                </a>
              )}
            </p>
          ) : (
            <Button
              className="min-h-11"
              onClick={() => void approve()}
              disabled={
                busy ||
                !prepared ||
                quoteExpiry.expired ||
                receipt?.state !== "quoted"
              }
            >
              {busy
                ? "Verifying purchase…"
                : prepared && quoteExpiry.expired
                  ? "Quote expired · close to refresh"
                  : "Approve $0.10 USDC purchase"}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            If an outcome is uncertain it stays held, never paid again
            automatically. A settled payment with an unavailable export requires
            support review; automatic refunds are not promised.
          </p>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Local presentation only; all payment and recovery controllers stay above. */
function ResearchReceiptLibrary({
  receipts,
  now,
  children,
}: {
  receipts: Receipt[] | undefined;
  now: number;
  children: (rows: Receipt[]) => ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ReceiptFilter>("all");
  const searchInput = useRef<HTMLInputElement>(null);
  const description = useId();
  const view = researchReceiptView(receipts ?? [], search, filter, now);
  return (
    <section
      aria-label="Research receipt library"
      className="mt-4 min-w-0 border-t pt-3 text-sm [overflow-wrap:anywhere] [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_button]:!min-h-11 [&_button]:whitespace-normal [&_li]:min-w-0"
    >
      {view.pinned.length > 0 && (
        <section
          aria-label="Protected research payment attempts"
          className="mb-4 min-w-0 rounded-lg border p-3"
        >
          <h4 className="font-semibold">Protected payment attempts</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {view.pinned.length} protected attempts always shown;{" "}
            {view.pinnedSearchMatches} match this search. Search and status
            filters never hide these saved attempts. Missing finality is not
            proof of nonpayment.
          </p>
          {children(view.pinned)}
        </section>
      )}
      <details className="min-w-0">
        <summary className="focus-ring min-h-11 cursor-pointer content-center text-muted-foreground">
          Your recent research receipts
        </summary>
        <p id={description} className="my-3 text-xs text-muted-foreground">
          Filters only receipts already loaded for your account, not your
          complete history. Search exact-case mint text or receipt ID. No new
          data is requested.
        </p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0">
            Search loaded receipts
            <Input
              ref={searchInput}
              type="search"
              className="mt-1 min-h-11 w-full min-w-0 text-base"
              value={search}
              maxLength={256}
              disabled={receipts === undefined}
              aria-describedby={description}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="min-w-0">
            Receipt status
            <select
              className="focus-ring mt-1 min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-base"
              value={filter}
              disabled={receipts === undefined}
              onChange={(event) =>
                setFilter(event.target.value as ReceiptFilter)
              }
            >
              <option value="all">All other receipts</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="quoted">Quoted</option>
              <option value="expired">Expired quotes</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
        </div>
        {search && (
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => {
              setSearch("");
              searchInput.current?.focus();
            }}
          >
            Clear receipt search
          </Button>
        )}
        {receipts === undefined ? (
          <p role="status" className="mt-3">
            Loading your research receipts…
          </p>
        ) : (
          <>
            <p role="status" className="mt-3 text-xs text-muted-foreground">
              Showing {view.shown} of {view.loaded} loaded receipts.
            </p>
            {view.loaded === 0 ? (
              <p className="mt-3">No research receipts are loaded.</p>
            ) : view.matches.length === 0 ? (
              <p className="mt-3">No other loaded receipts match.</p>
            ) : (
              children(view.matches)
            )}
          </>
        )}
      </details>
    </section>
  );
}
