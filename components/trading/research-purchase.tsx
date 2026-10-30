"use client";

import { useEffect, useRef, useState } from "react";
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

export function ResearchPurchase({ mint }: { mint: string }) {
  const client = useCommerceWallet();
  return client ? (
    <ResearchPurchaseConnected key={mint} mint={mint} client={client} />
  ) : (
    <p className="text-sm text-muted-foreground">
      Wallet services are loading.
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
  const { connected, linked } = useCommerceIdentity(
    client,
    "solana:signTransaction",
  );
  const [now, setNow] = useState(
    () => Math.floor(Date.now() / 60_000) * 60_000,
  );
  const config = useQuery(configRef, { now });
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
  const receipt = useQuery(
    statusRef,
    prepared && isAuthenticated ? { intentKey: prepared.intentKey } : "skip",
  );
  const held = history?.find((item) =>
    ["verifying", "settlement_claimed", "unknown"].includes(item.state),
  );
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
      className="rounded-xl border bg-card p-4 text-card-foreground"
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
      {!linked || !connected ? (
        <CommerceWalletButton
          requiredFeature="solana:signTransaction"
          disabled={busy}
        />
      ) : (
        <Button
          onClick={() => void review()}
          disabled={busy || !config?.enabled || !!held}
        >
          {busy
            ? "Preparing…"
            : held
              ? "Payment receipt protected"
              : "Review research export"}
        </Button>
      )}
      {config && !config.enabled && (
        <p className="mt-2 text-xs text-muted-foreground">
          {config.reason === "free_credits_exhausted"
            ? "The free facilitator allowance is exhausted. Payments are paused; no paid upgrade will be used."
            : "Payments open only after treasury, facilitator and free-credit checks pass."}
        </p>
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
      {!!history?.length && (
        <details className="mt-4 border-t pt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Your recent research receipts
          </summary>
          <ul className="mt-3 space-y-3">
            {history.map((item) => (
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
        </details>
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
              onClick={() => void approve()}
              disabled={
                busy ||
                !prepared ||
                prepared.expiresAt <= now ||
                receipt?.state !== "quoted"
              }
            >
              {busy
                ? "Verifying purchase…"
                : prepared && prepared.expiresAt <= now
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
