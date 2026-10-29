"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import {
  useQuery,
  useAction as useConvexAction,
  useMutation,
  useConvexAuth,
} from "convex/react";
import { useAction } from "@solana/react";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Megaphone, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ForumLink } from "@/components/forum/forum-link";
import { useForumRuntime } from "@/components/forum/forum-runtime-context";
import { formatTokenAmount } from "@/lib/swap-amounts";
import {
  requestReviewedTransaction,
  verifyPreparedTransaction,
  type CommerceWalletClient,
  type ReviewedTransaction,
} from "@/lib/commerce-wallet-client";
import {
  CommerceWalletProvider,
  CommerceWalletButton,
  useCommerceWallet,
} from "./commerce-wallet";
import { TokenSwap, type TradeToken } from "./token-swap";

export function ForumCommerceFrame({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  const runtime = useForumRuntime();
  if (runtime.host !== "website")
    return <div className="space-y-3">{children}</div>;
  return (
    <CommerceWalletProvider>
      <div className="commerce-thread-layout">
        <div className="min-w-0 space-y-3">{children}</div>
        <aside
          className="commerce-thread-aside"
          aria-label="Post token and promotion"
        >
          <CommerceBoundary>
            <ThreadCommerce threadId={threadId as Id<"forumThreads">} />
          </CommerceBoundary>
        </aside>
      </div>
    </CommerceWalletProvider>
  );
}
function ThreadCommerce({ threadId }: { threadId: Id<"forumThreads"> }) {
  const tokens = useQuery(api.forumCommerce.resolveThreadTokens, { threadId });
  const mapped = useQuery(api.forumCommerce.getThreadMint, { threadId });
  const [resolved, setResolved] = useState<TradeToken | null>(null),
    [chosen, setChosen] = useState("");
  const client = useCommerceWallet();
  const [wallet, setWallet] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    const sync = () =>
      setWallet(client.wallet.getState().connected?.account.address ?? null);
    sync();
    return client.wallet.subscribe(sync);
  }, [client]);
  const resolveMint = useConvexAction(api.forumCommerce.resolveMint);
  const resolve = useAction(async () => {
    if (!mapped || !wallet) return;
    try {
      setResolved(await resolveMint({ wallet, mint: mapped }));
    } catch {
      /* The explicit verified-mint gate remains closed. */
    }
  });
  const available = [...(tokens ?? []), ...(resolved ? [resolved] : [])].filter(
    (t, i, a) => a.findIndex((x) => x.mint === t.mint) === i,
  );
  const outputToken = available.find((t) => t.mint === chosen) ?? available[0];
  return (
    <>
      {outputToken && (
        <>
          <div className="commerce-post-token">
            <h2>Token mentioned in this post</h2>
            {available.length > 1 && (
              <select
                aria-label="Choose token mentioned in this post"
                value={outputToken.mint}
                onChange={(e) => setChosen(e.target.value)}
              >
                {available.map((t) => (
                  <option key={t.mint} value={t.mint}>
                    {t.symbol}
                  </option>
                ))}
              </select>
            )}
            <p>
              A mint match is not an endorsement. Check the full address in the
              swap review.
            </p>
          </div>
          <TokenSwap outputToken={outputToken} />
        </>
      )}
      {!outputToken && mapped && (
        <section className="commerce-panel">
          <h2>Token in this post</h2>
          <code className="commerce-mint">{mapped}</code>
          <CommerceWalletButton />
          <Button
            variant="outline"
            disabled={!wallet || resolve.isRunning}
            onClick={() => resolve.dispatch()}
          >
            Verify token for swaps
          </Button>
          <p>
            Sign in and link your wallet before verifying this post’s token.
          </p>
        </section>
      )}
      <PromotionCheckout threadId={threadId} />
    </>
  );
}
function PromotionCheckout({ threadId }: { threadId: Id<"forumThreads"> }) {
  const client = useCommerceWallet();
  return client ? <LivePromotion threadId={threadId} client={client} /> : null;
}
type Intent = FunctionReturnType<typeof api.forumPromotions.quotePromotion>;
const date = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(value);
function LivePromotion({
  threadId,
  client,
}: {
  threadId: Id<"forumThreads">;
  client: CommerceWalletClient;
}) {
  const config = useQuery(api.forumCommerce.getConfig, {}),
    connected = useConnectedWallet(client),
    { isAuthenticated } = useConvexAuth();
  const reserve = useConvexAction(api.forumPromotions.quotePromotion),
    prepare = useConvexAction(api.forumPromotions.prepare),
    submit = useConvexAction(api.forumPromotions.submitPromotion),
    hold = useMutation(api.forumPromotions.markUnknown),
    begin = useMutation(api.forumPromotions.beginWalletRequest);
  const [intent, setIntent] = useState<Intent | null>(null),
    [prepared, setPrepared] = useState<ReviewedTransaction | null>(null),
    [consent, setConsent] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [signature, setSignature] = useState(""),
    [sent, setSent] = useState(false);
  const active = useQuery(
    api.forumPromotions.getPromotion,
    intent ? { intentId: intent.intentId } : "skip",
  );
  const mine = useQuery(
    api.forumPromotions.listMine,
    isAuthenticated ? {} : "skip",
  );
  const dispatchGuard = useRef(false);
  const checkout = useAction(async () => {
    setError("");
    try {
      if (!connected) return;
      setIntent(await reserve({ wallet: connected.account.address, threadId }));
      setPrepared(null);
      setConsent(false);
    } catch {
      setError(
        "Promotion checkout is unavailable. Check your linked wallet, existing checkouts and the board queue; no payment was requested.",
      );
    }
  });
  const review = useAction(async () => {
    if (!intent || !connected) return;
    setError("");
    try {
      const data = await prepare({
        intentId: intent.intentId,
        supportsV1: connected.supportedTransactionVersions.has(1),
      });
      const walletNow = client.wallet.getState().connected;
      if (
        walletNow?.account.address !== data.wallet ||
        !walletNow.supportedTransactionVersions.has(data.transactionVersion)
      )
        throw new Error(
          "Connected wallet changed or unsupported transaction version.",
        );
      setPrepared(await verifyPreparedTransaction(data));
    } catch {
      setError(
        "The exact transfer and burn could not be simulated. Nothing was sent. This checkout cannot be retried; check its status before creating another.",
      );
    }
  });
  const send = useAction(async () => {
    if (dispatchGuard.current || !intent || !prepared || !consent) return;
    dispatchGuard.current = true;
    setSent(true);
    setError("");
    let walletInvoked = false;
    try {
      await begin({ intentId: intent.intentId });
      walletInvoked = true;
      const sig = await requestReviewedTransaction(client, prepared);
      setSignature(sig);
      const receipt = await submit({
        intentId: intent.intentId,
        signature: sig,
      });
      setIntent(receipt);
      setNotice(
        receipt.status === "scheduled"
          ? "Payment finalized. Your promotion is scheduled below."
          : "Payment receipt is pending or requires review. Do not submit another payment.",
      );
    } catch {
      if (walletInvoked)
        await hold({ intentId: intent.intentId }).catch(() => {});
      setError(
        walletInvoked
          ? "Wallet outcome is uncertain or declined. Do not repeat this payment. Keep the receipt and recheck its signature below."
          : "The wallet request could not be authorized. No wallet window was opened. Reload to inspect the saved checkout status; nothing is resent automatically.",
      );
    }
  });
  const check = useAction(async (_signal: AbortSignal, row: Intent) => {
    if (!signature && !row.signature) return;
    try {
      const next = await submit({
        intentId: row.intentId,
        signature: row.signature ?? signature,
      });
      setIntent(next);
      setNotice(`Promotion status: ${next.status}. No payment was resent.`);
    } catch {
      setError("Receipt could not be verified yet. No payment was resent.");
    }
  });
  const busy =
    checkout.isRunning || review.isRunning || send.isRunning || check.isRunning;
  const display = active ?? intent;
  return (
    <section id="promote-post" className="commerce-panel promotion-checkout">
      <h2>
        <Megaphone aria-hidden="true" />
        Promote this post
      </h2>
      <p>
        A clearly labeled placement in this board. At most five run at a time; a
        full board queues the next 24-hour slot.
      </p>
      <div className="commerce-promotion-price">
        <strong>
          {formatTokenAmount(config?.promotionAmountRaw ?? "10000000000", 6)}{" "}
          SYMF
        </strong>
        <span>24 hours</span>
      </div>
      <p>
        <Flame aria-hidden="true" />
        50% is burned; 50% goes to the platform treasury.
      </p>
      {!config?.promotionsEnabled && (
        <p>Paid placements are not yet enabled.</p>
      )}
      <CommerceWalletButton disabled={busy || sent} />
      {!isAuthenticated && (
        <p>
          <ForumLink href="/signin?redirectTo=/forum" className="underline">
            Sign in
          </ForumLink>{" "}
          to sponsor a post.
        </p>
      )}
      {!intent && (
        <Button
          className="w-full"
          variant="outline"
          disabled={
            !config?.promotionsEnabled || !isAuthenticated || !connected || busy
          }
          onClick={() => checkout.dispatch()}
        >
          Check next available slot
        </Button>
      )}
      {display && (
        <div className="commerce-review">
          <h3>Promotion review</h3>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{display.status}</dd>
            </div>
            <div>
              <dt>
                {display.status === "scheduled" ? "Starts" : "Estimated start"}
              </dt>
              <dd>{date(display.startsAt)}</dd>
            </div>
            <div>
              <dt>Ends</dt>
              <dd>{date(display.endsAt)}</dd>
            </div>
            <div>
              <dt>To treasury</dt>
              <dd>
                {formatTokenAmount(display.treasuryAmountRaw, display.decimals)}{" "}
                SYMF
              </dd>
            </div>
            <div>
              <dt>Permanent burn</dt>
              <dd>
                {formatTokenAmount(display.burnAmountRaw, display.decimals)}{" "}
                SYMF
              </dd>
            </div>
          </dl>
          <code className="commerce-mint">Treasury: {display.treasury}</code>
          <code className="commerce-mint">Mint: {display.mint}</code>
          <p>
            The interval is confirmed after finalization. Checkout expires{" "}
            {date(display.checkoutExpiresAt)}. Network fees and token-account
            rent are additional. The holder swap-fee waiver does not apply.
          </p>
          {!prepared && !sent && (
            <Button
              className="w-full"
              disabled={busy || display.status !== "checkout"}
              onClick={() => review.dispatch()}
            >
              {review.isRunning
                ? "Simulating transfer + burn…"
                : "Prepare and simulate"}
            </Button>
          )}
          {prepared && !sent && (
            <>
              <p>
                Estimated network fee:{" "}
                {formatTokenAmount(prepared.estimatedNetworkFeeLamports, 9)}{" "}
                SOL.
              </p>
              <label className="commerce-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I approve this payment, including the irreversible 50% burn.
                Promotion does not bypass moderation and is not refundable.
              </label>
              <Button
                className="w-full"
                disabled={
                  !consent || busy || Date.now() >= display.checkoutExpiresAt
                }
                onClick={() => send.dispatch()}
              >
                Pay and burn in wallet
              </Button>
            </>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="commerce-note">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="commerce-error">
          {error}
        </p>
      )}
      {sent && intent && (
        <div className="commerce-recovery">
          <label htmlFor={`promotion-receipt-${threadId}`}>
            Transaction signature (receipt check only)
          </label>
          <Input
            id={`promotion-receipt-${threadId}`}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="Paste signature from wallet history"
          />
          <Button
            disabled={!signature || busy}
            variant="outline"
            onClick={() => check.dispatch(intent)}
          >
            Check receipt without resending
          </Button>
        </div>
      )}
      {!!mine?.some((row) => row.threadId === threadId) && (
        <details className="commerce-details">
          <summary>Your promotion receipts for this post</summary>
          {mine
            .filter((row) => row.threadId === threadId)
            .map((row) => (
              <div className="commerce-history" key={row.intentId}>
                <span>
                  {row.status} · {date(row.startsAt)}
                </span>
                <Input
                  aria-label="Receipt signature"
                  placeholder="Signature from wallet history"
                  value={row.signature ?? signature}
                  onChange={(e) => setSignature(e.target.value)}
                />
                <Button
                  variant="ghost"
                  disabled={busy || (!row.signature && !signature)}
                  onClick={() => check.dispatch(row)}
                >
                  Check receipt
                </Button>
              </div>
            ))}
        </details>
      )}
      <p>
        Anyone can sponsor an eligible public post. Paying never changes
        moderation, reputation or organic ranking.
      </p>
    </section>
  );
}
export function BoardPromotions({ categorySlug }: { categorySlug: string }) {
  const runtime = useForumRuntime();
  return runtime.host === "website" ? (
    <CommerceBoundary quiet>
      <LiveBoardPromotions categorySlug={categorySlug} />
    </CommerceBoundary>
  ) : null;
}

export class CommerceBoundary extends Component<
  { children: ReactNode; quiet?: boolean },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      this.props.quiet ? null : (
        <section className="commerce-panel">
          <h2>Trading temporarily unavailable</h2>
          <p>
            No transactions are retried automatically. Check your wallet history
            before starting another operation. The forum remains available.
          </p>
        </section>
      )
    ) : (
      this.props.children
    );
  }
}
function LiveBoardPromotions({ categorySlug }: { categorySlug: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const rows = useQuery(api.forumPromotions.listPromoted, {
    categorySlug,
    now,
  });
  if (!rows?.length) return null;
  return (
    <section className="commerce-promoted" aria-label="Paid promoted posts">
      <div className="commerce-heading">
        <h2>Promoted</h2>
        <span>Paid placements · up to five</span>
      </div>
      {rows
        .filter((row) => row.startsAt <= now && row.endsAt > now)
        .map((row) => (
          <ForumLink
            key={row.intentId}
            href={`/forum/${row.categorySlug}/${row.slug}`}
            className="commerce-promoted-row"
          >
            <Megaphone aria-hidden="true" />
            <span>{row.title}</span>
            <small>Promoted</small>
          </ForumLink>
        ))}
    </section>
  );
}
