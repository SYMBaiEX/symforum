"use client";

import { useRef, useState, useEffect, useId } from "react";
import {
  useQuery,
  useAction as useConvexAction,
  useMutation,
} from "convex/react";
import { useAction } from "@solana/react";
import { ArrowDownUp, ArrowUpRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ForumLink } from "@/components/forum/forum-link";
import { useForumRuntime } from "@/components/forum/forum-runtime-context";
import { forumSiteUrl } from "@/lib/site-urls";
import {
  parseTokenAmount,
  formatTokenAmount,
  normalizeTokenAmount,
} from "@/lib/swap-amounts";
import { publicSwapPreparationError } from "@/lib/swap-preparation-errors";
import {
  refreshedQuoteNeedsReview,
  walletHandoffAllowed,
} from "@/lib/swap-review";
import {
  requestReviewedTransaction,
  verifyPreparedTransaction,
  CommerceWalletRequestError,
  supportsCommerceTransaction,
  commerceWalletFailureMessage,
  signReviewedSwap,
  type CommerceWalletClient,
  type ReviewedTransaction,
} from "@/lib/commerce-wallet-client";
import {
  CommerceWalletButton,
  CommerceWalletProvider,
  useCommerceWallet,
  useCommerceIdentity,
} from "./commerce-wallet";
import { TokenPicker } from "./token-picker";

export type TradeToken = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  tokenProgram: string;
  icon?: string | null;
  verified?: boolean;
};
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
type QuoteResult = FunctionReturnType<typeof api.forumSwaps.quote>;
type Quote = QuoteResult["quotes"][number];
type ReadySwap = {
  quote: Quote;
  transaction: ReviewedTransaction;
  revision: number;
};
const short = (mint: string) => `${mint.slice(0, 5)}…${mint.slice(-5)}`;

export function TokenSwap({ outputToken }: { outputToken?: TradeToken }) {
  const client = useCommerceWallet();
  return client ? (
    <LiveSwap
      key={outputToken?.mint ?? "swap"}
      client={client}
      outputToken={outputToken}
    />
  ) : (
    <section className="commerce-panel" aria-busy="true">
      <h2>Swap tokens</h2>
      <p>Loading wallet support…</p>
    </section>
  );
}
export function StandaloneSwap({ enabled }: { enabled: boolean }) {
  const runtime = useForumRuntime();
  if (runtime.host !== "website")
    return (
      <section className="commerce-panel">
        <h1>Swap on Solana</h1>
        <p>
          Wallet transactions are available only on the first-party Forum
          website, not inside an embedded agent app.
        </p>
        <a
          href={forumSiteUrl("/swap")}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open the secure swap page
        </a>
      </section>
    );
  if (!enabled) return <p>Swaps are unavailable in this environment.</p>;
  return (
    <CommerceWalletProvider>
      <div className="commerce-page">
        <header>
          <h1>Swap on Solana</h1>
          <p>
            Compare routes without leaving the forum. Your wallet approves every
            transaction.
          </p>
        </header>
        <div className="commerce-swap-layout">
          <TokenSwap />
          <section className="commerce-guide">
            <h2>One review. Your wallet.</h2>
            <p>
              Jupiter finds a route across supported Solana pools and manages
              transaction delivery. We independently verify and simulate the
              transaction before your wallet signs. Execution is not guaranteed.
            </p>
            <h3>Hold SYMF, skip the platform fee</h3>
            <p>
              Wallets holding strictly more than $1 of verified SYMF pay no
              SYMBaiEX swap fee. The managed route’s regular integrator fee is
              0.50%, including Jupiter’s 20% share of that fee. When our fee is
              waived, Jupiter’s own quoted fee can still apply. Fees are shown
              before approval; pool fees, network costs and account rent remain.
            </p>
            <h3>Know the mint</h3>
            <p>
              Names and tickers can be copied. Verify the full mint before
              approving. A token appearing here is not an endorsement, audit or
              promise of returns.
            </p>
            <ForumLink href="/forum/symf" className="underline">
              About the official SYMF token
            </ForumLink>
          </section>
        </div>
      </div>
    </CommerceWalletProvider>
  );
}
function LiveSwap({
  client,
  outputToken,
}: {
  client: CommerceWalletClient;
  outputToken?: TradeToken;
}) {
  const { connected, isAuthenticated, linked, session } =
    useCommerceIdentity(client);
  const config = useQuery(api.forumCommerce.getConfig, {}),
    tokens = useQuery(api.forumCommerce.searchTokens, {});
  const quoteAction = useConvexAction(api.forumSwaps.quote),
    prepareAction = useConvexAction(api.forumSwaps.prepare),
    confirm = useConvexAction(api.forumSwaps.confirm),
    hold = useMutation(api.forumSwaps.markUnknown),
    begin = useMutation(api.forumSwaps.beginWalletRequest);
  const refresh = useConvexAction(api.forumCommerce.refreshBenefit);
  const mine = useQuery(api.forumSwaps.listMine, isAuthenticated ? {} : "skip");
  const ensureRecovery = useMutation(api.forumSwapRecovery.ensure);
  const registerSigned = useMutation(api.forumSwapSubmission.registerSigned);
  const cancelUnsubmitted = useMutation(
    api.forumSwapSubmission.cancelUnsubmitted,
  );
  const relaySigned = useConvexAction(api.forumSwapSubmission.relay);
  const recoveryAdmissions = useRef(new Set<string>());
  const [recoveryUnavailable, setRecoveryUnavailable] = useState<string | null>(
    null,
  );
  const [inputMint, setInputMint] = useState(SOL),
    [outputMint, setOutputMint] = useState(outputToken?.mint ?? USDC),
    [amount, setAmount] = useState(""),
    [slippage, setSlippage] = useState(50);
  const [format, setFormat] = useState<"auto" | "v0">("auto");
  const supportsV1 =
    format === "auto" &&
    supportsCommerceTransaction(client, 1, config?.signatureFirstEnabled);
  const supportsV0 = supportsCommerceTransaction(
    client,
    0,
    config?.signatureFirstEnabled,
  );
  const [extra, setExtra] = useState<TradeToken[]>([]);
  const [result, setResult] = useState<QuoteResult | null>(null),
    [selected, setSelected] = useState<Quote | null>(null),
    [prepared, setPrepared] = useState<ReviewedTransaction | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [walletDiagnostic, setWalletDiagnostic] = useState(""),
    [sent, setSent] = useState(false),
    [signature, setSignature] = useState("");
  const [recoverySignatures, setRecoverySignatures] = useState<
    Record<string, string>
  >({});
  const [finalized, setFinalized] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dispatched = useRef(false),
    purchaseActive = useRef(false),
    busyGuard = useRef(false),
    identity = useRef("");
  const revision = useRef(0),
    attemptedQuote = useRef("");
  const identityKey = `${isAuthenticated ? (session?.authUserId ?? "loading") : "guest"}:${connected?.account.address ?? ""}:${linked}`;
  const unresolved =
    mine?.some(
      (row) =>
        row.wallet === connected?.account.address &&
        ["held", "submitted"].includes(row.status),
    ) ?? false;
  const recovering = mine?.find(
    (row) =>
      row.wallet === connected?.account.address &&
      ["held", "submitted"].includes(row.status),
  );
  // Admission is idempotent and ownership-checked. Durable verification runs on
  // Convex, never in a browser interval; remounts cannot reset its attempt cap.
  useEffect(() => {
    if (!recovering || !linked || !isAuthenticated) return;
    const key = `${session?.authUserId}:${recovering.quoteId}`;
    if (recoveryAdmissions.current.has(key)) return;
    recoveryAdmissions.current.add(key);
    void ensureRecovery({ quoteId: recovering.quoteId })
      .then((job) => {
        if (!job) setRecoveryUnavailable(recovering.quoteId);
      })
      .catch(() => setRecoveryUnavailable(recovering.quoteId));
  }, [
    recovering,
    linked,
    isAuthenticated,
    session?.authUserId,
    ensureRecovery,
  ]);
  useEffect(() => {
    if (!selected || !sent) return;
    const saved = mine?.find((row) => row.quoteId === selected.quoteId);
    if (saved?.status === "confirmed") {
      setFinalized(true);
      setNotice("Swap finalized. The exact reviewed transaction was verified.");
    } else if (
      saved?.status === "failed" &&
      [
        "reconciled_expired_not_landed",
        "finalized_transaction_failed",
        "signature_expired_not_found",
        "app_submission_not_started",
      ].includes(saved.issue ?? "")
    ) {
      // Unlock the form, not the payment. Only a new explicit Buy can sign.
      dispatched.current = false;
      purchaseActive.current = false;
      attemptedQuote.current = "";
      setSent(false);
      setPrepared(null);
      setSelected(null);
      setResult(null);
      setError("");
      setNotice(
        saved.issue === "finalized_transaction_failed"
          ? "The previous swap failed on-chain. Network fees may apply. Nothing will be retried automatically."
          : saved.issue === "app_submission_not_started"
            ? "Submission was cancelled before the app sent anything. You can request a fresh quote."
            : "The previous swap expired without landing. Trading is unlocked; nothing was resent.",
      );
    }
  }, [mine, selected, sent]);
  const id = useId();
  const history = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (identity.current !== identityKey) {
      identity.current = identityKey;
      revision.current++;
      setResult(null);
      setSelected(null);
      setPrepared(null);
    }
  }, [identityKey]);
  const all = [
    ...(tokens ?? []),
    ...(outputToken ? [outputToken] : []),
    ...extra,
  ].filter((t, i, a) => a.findIndex((x) => x.mint === t.mint) === i);
  const input = all.find((t) => t.mint === inputMint),
    output = all.find((t) => t.mint === outputMint);
  const feeLabel = (q: Quote) =>
    q.fees
      ? `${q.platformFeeBps ? `${q.platformFeeBps / 100}% integrator fee (Jupiter share included)` : `SYMBaiEX waived · Jupiter ${q.fees.jupiterFeeBps / 100}%`} · collected in ${all.find((t) => t.mint === q.fees?.feeMint)?.symbol ?? short(q.fees.feeMint)}`
      : q.platformFeeBps === 0
        ? "Waived"
        : `${formatTokenAmount(q.platformFeeRaw, input?.decimals ?? 9)} ${input?.symbol ?? ""} (${q.platformFeeBps / 100}%)`;
  let rawAmount = "";
  try {
    if (input) rawAmount = parseTokenAmount(amount, input.decimals);
  } catch {
    /* Invalid amounts never reach the provider. */
  }
  const inputKey = `${identityKey}:${inputMint}:${outputMint}:${rawAmount}:${slippage}:${supportsV1}:${format}`;
  const clear = () => {
    revision.current++;
    setResult(null);
    setSelected(null);
    setPrepared(null);
    setError("");
    setNotice("");
    setWalletDiagnostic("");
  };
  const routes = useAction(async () => {
    if (busyGuard.current || dispatched.current) return;
    busyGuard.current = true;
    clear();
    attemptedQuote.current = inputKey;
    const started = revision.current;
    try {
      if (!connected || !input || !linked || !isAuthenticated)
        throw new Error("Connect a linked payment wallet.");
      const data = await quoteAction({
        wallet: connected.account.address,
        inputMint,
        outputMint,
        amountRaw: parseTokenAmount(amount, input.decimals),
        slippageBps: slippage,
        supportsV1,
      });
      if (
        client.wallet.getState().connected?.account.address !==
          connected.account.address ||
        revision.current !== started
      )
        return;
      setResult(data);
      if (!data.quotes.length)
        setNotice(
          "No safe routes responded. Nothing was signed. Try later or use a smaller amount.",
        );
      return data;
    } catch (reason) {
      const detail =
        reason &&
        typeof reason === "object" &&
        "data" in reason &&
        typeof reason.data === "string"
          ? reason.data
          : "";
      if (revision.current === started)
        setError(
          /Routing is busy|already in progress/.test(detail)
            ? "Routing is busy. Wait a few seconds, then choose Swap. No payment was requested and nothing is retried automatically."
            : "Routes could not be verified. Check the amount, your linked wallet in Account Connections, and try later if the free data limit has been reached.",
        );
    } finally {
      busyGuard.current = false;
    }
  });
  const prepare = useAction(async (_signal: AbortSignal, q: Quote) => {
    if (busyGuard.current || dispatched.current || !linked || !isAuthenticated)
      return;
    busyGuard.current = true;
    const started = revision.current;
    setError("");
    setSelected(q);
    try {
      const data = await prepareAction({ quoteId: q.quoteId });
      const walletNow = client.wallet.getState().connected;
      if (_signal.aborted || started !== revision.current) return;
      if (
        walletNow?.account.address !== data.wallet ||
        !supportsCommerceTransaction(
          client,
          data.transactionVersion,
          config?.signatureFirstEnabled,
        )
      )
        throw new Error(
          "Connected wallet changed or does not support this transaction version.",
        );
      const verified = await verifyPreparedTransaction(data);
      if (_signal.aborted || started !== revision.current) return;
      setPrepared(verified);
      return {
        quote: q,
        transaction: verified,
        revision: started,
      } satisfies ReadySwap;
    } catch (reason) {
      if (started !== revision.current) return;
      setSelected(null);
      setPrepared(null);
      setResult(null);
      setError(publicSwapPreparationError(reason));
    } finally {
      busyGuard.current = false;
    }
  });
  const send = useAction(async (_signal: AbortSignal, ready: ReadySwap) => {
    const { quote: selected, transaction: prepared } = ready;
    if (
      dispatched.current ||
      _signal.aborted ||
      ready.revision !== revision.current ||
      client.wallet.getState().connected?.account.address !== prepared.wallet ||
      selected.expiresAt <= Date.now()
    )
      return;
    if (!walletHandoffAllowed(selected.expiresAt)) {
      setNotice(
        "Return to this tab with an internet connection, then choose Swap. No wallet request was made.",
      );
      return;
    }
    dispatched.current = true;
    setSent(true);
    setError("");
    setNotice("Approve only if the amounts and destination match your review.");
    if (config?.signatureFirstEnabled) {
      let signed: Awaited<ReturnType<typeof signReviewedSwap>> | undefined;
      let stage = "signing";
      try {
        signed = await signReviewedSwap(client, prepared);
        setSignature(signed.signature);
        if (
          _signal.aborted ||
          ready.revision !== revision.current ||
          selected.expiresAt <= Date.now() ||
          client.wallet.getState().connected?.account.address !==
            prepared.wallet
        )
          throw Error("Signing interrupted before submission");
        stage = "registration";
        await registerSigned({
          quoteId: selected.quoteId,
          signedTransactionBase64: signed.signedTransactionBase64,
        });
        stage = "submission";
        await relaySigned({
          quoteId: selected.quoteId,
          signedTransactionBase64: signed.signedTransactionBase64,
        });
        setNotice((current) =>
          current.startsWith("Swap finalized.")
            ? current
            : "Transaction signature saved. Tracking confirmation automatically; nothing will be resent.",
        );
      } catch (reason) {
        const code =
          reason instanceof CommerceWalletRequestError ? reason.code : null;
        console.warn(
          "Swap signature-first step did not complete",
          JSON.stringify({
            stage,
            code,
            walletPhase:
              reason instanceof CommerceWalletRequestError
                ? reason.phase
                : null,
            responseIssue:
              reason instanceof CommerceWalletRequestError
                ? reason.responseIssue
                : null,
          }),
        );
        setWalletDiagnostic(
          `Stage: ${stage}; code: ${code ?? "none"}${reason instanceof CommerceWalletRequestError ? `; wallet phase: ${reason.phase}; issue: ${reason.responseIssue ?? "none"}` : ""}.`,
        );
        const cancelled = await cancelUnsubmitted({
          quoteId: selected.quoteId,
        }).catch(() => false);
        if (cancelled) {
          dispatched.current = false;
          setSent(false);
          setPrepared(null);
          setSelected(null);
          setResult(null);
          setSignature("");
          setNotice("");
          setError(
            stage === "signing"
              ? "Wallet signing did not complete. The app did not submit a transaction. You can request a fresh quote."
              : "Submission did not start. The saved attempt was cancelled before any relay was authorized. You can request a fresh quote.",
          );
        } else {
          setNotice("");
          setError(
            signed
              ? "The signature is available. Submission status needs verification; tracking continues from the saved operation. Do not submit again."
              : "The signing attempt could not be closed safely. Open the saved operation status; no automatic resend will occur.",
          );
        }
      }
      return;
    }
    let walletInvoked = false;
    let returnedSignature = false;
    try {
      await begin({ quoteId: selected.quoteId });
      // The account/visibility/deadline may change during server admission.
      // Keep the durable fence if interrupted here; never open a stale wallet prompt.
      if (
        _signal.aborted ||
        ready.revision !== revision.current ||
        !walletHandoffAllowed(selected.expiresAt)
      )
        throw new Error("Wallet handoff interrupted before approval.");
      walletInvoked = true;
      const sig = await requestReviewedTransaction(client, prepared);
      returnedSignature = true;
      setSignature(sig);
      setNotice(
        "Submitted. Verifying the finalized receipt; do not submit again.",
      );
      const receipt = await confirm({
        quoteId: selected.quoteId,
        signature: sig,
      });
      setFinalized(receipt.status === "confirmed");
      setNotice(
        receipt.status === "confirmed"
          ? "Swap finalized. The exact reviewed transaction was verified."
          : "Receipt not finalized or requires review. This operation remains held; do not repeat it.",
      );
    } catch (reason) {
      const code =
        reason &&
        typeof reason === "object" &&
        "code" in reason &&
        typeof reason.code === "number" &&
        Number.isSafeInteger(reason.code)
          ? reason.code
          : null;
      const diagnostic = {
        stage: returnedSignature
          ? "receipt"
          : walletInvoked
            ? "wallet"
            : "authorization",
        code,
        walletPhase:
          reason instanceof CommerceWalletRequestError ? reason.phase : null,
        responseIssue:
          reason instanceof CommerceWalletRequestError
            ? reason.responseIssue
            : null,
      };
      console.warn(
        "Swap approval did not complete",
        JSON.stringify(diagnostic),
      );
      setWalletDiagnostic(
        `Stage: ${diagnostic.stage}; wallet phase: ${diagnostic.walletPhase ?? "none"}; code: ${diagnostic.code ?? "none"}; response: ${diagnostic.responseIssue ?? "none"}.`,
      );
      if (walletInvoked)
        await hold({ quoteId: selected.quoteId }).catch(() => {});
      setNotice("");
      setError(
        returnedSignature
          ? "Your wallet returned a transaction signature, but its receipt could not be checked. Use Check receipt below; do not submit another swap."
          : walletInvoked
            ? `${commerceWalletFailureMessage(reason)} The attempt remains protected; see its verification status below. Do not repeat this swap until its outcome is verified.`
            : "The wallet request could not be authorized. No wallet window was opened. Reload to inspect the saved operation status; nothing is resent automatically.",
      );
    }
  });
  const benefit = useAction(async () => {
    if (!connected) return;
    try {
      const b = await refresh({
        wallet: connected.account.address,
        refresh: true,
      });
      setNotice(
        b.status === "verified"
          ? b.eligible
            ? "Holder benefit verified for 60 seconds. Request routes to apply the fee waiver."
            : "Balance verified: the wallet needs strictly more than $1 of SYMF for the waiver."
          : "Holder value unavailable. Routes will disclose the regular platform fee before you approve.",
      );
    } catch {
      setError(
        "Link this wallet in Account Connections before checking benefits, or try later.",
      );
    }
  });
  const buy = useAction(async (signal: AbortSignal) => {
    try {
      if (dispatched.current || unresolved) return;
      let q = result?.quotes[0];
      const previous = q;
      if (!q || q.expiresAt <= Date.now() + 5000) {
        const freshResult = await routes.dispatchAsync();
        q = freshResult?.quotes[0];
        if (previous && q && refreshedQuoteNeedsReview(previous, q)) {
          setNotice(
            "Quote updated: the minimum received or fee changed. Review the new amounts, then choose Swap if you accept. No wallet request was made.",
          );
          return;
        }
      }
      if (!q) return;
      const ready = await prepare.dispatchAsync(q);
      if (ready && !signal.aborted) await send.dispatchAsync(ready);
    } finally {
      purchaseActive.current = false;
    }
  });
  const busy =
    routes.isRunning || prepare.isRunning || send.isRunning || buy.isRunning;
  const needsRecovery = unresolved || (sent && !finalized && !busy);
  const locked = prepare.isRunning || send.isRunning || buy.isRunning || sent;
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const canQuote =
    config?.swapsEnabled &&
    online &&
    (supportsV1 || supportsV0) &&
    isAuthenticated &&
    linked &&
    connected &&
    input &&
    output &&
    rawAmount &&
    BigInt(rawAmount) > 0n &&
    inputMint !== outputMint &&
    !unresolved &&
    !locked;
  const quoteKey = canQuote ? inputKey : "";
  const quoteDispatch = useRef(routes.dispatch);
  useEffect(() => {
    quoteDispatch.current = routes.dispatch;
  }, [routes.dispatch]);
  useEffect(() => {
    if (
      !quoteKey ||
      !visible ||
      locked ||
      routes.isRunning ||
      attemptedQuote.current === quoteKey
    )
      return;
    const timer = setTimeout(() => {
      attemptedQuote.current = quoteKey;
      quoteDispatch.current();
    }, 1000);
    return () => clearTimeout(timer);
  }, [quoteKey, locked, routes.isRunning, visible]);
  const best = result?.quotes[0];
  const fresh = !!best && best.expiresAt > now;
  function pickToken(t: TradeToken, side: "input" | "output") {
    setExtra((xs) => [...xs.filter((x) => x.mint !== t.mint), t]);
    if (side === "input") setInputMint(t.mint);
    else setOutputMint(t.mint);
    clear();
  }
  return (
    <section className="commerce-panel token-swap" aria-label="Token swap">
      <div className="commerce-heading">
        <h2>Market swap</h2>
        <span className="swap-network">
          <i aria-hidden="true" />
          Solana mainnet
        </span>
      </div>
      <CommerceWalletButton disabled={locked} />
      {!isAuthenticated && (
        <p>
          <ForumLink
            className="underline"
            href="/signin?redirectTo=/forum/swap"
          >
            Sign in
          </ForumLink>{" "}
          with any method, or use the same wallet sign-in above. One profile for
          the forum and swaps.
        </p>
      )}
      {config && !config.swapsEnabled && (
        <p className="commerce-note">
          Swaps are not yet enabled. No payments can be made here.
        </p>
      )}
      <div className="commerce-amount">
        <label htmlFor={`${id}-amount`}>You pay</label>
        <div>
          <Input
            id={`${id}-amount`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            disabled={locked}
            onChange={(e) => {
              setAmount(normalizeTokenAmount(e.target.value));
              clear();
            }}
          />
          <TokenPicker
            token={input}
            tokens={all}
            label="Pay token"
            disabled={locked}
            wallet={linked ? connected?.account.address : undefined}
            onSelect={(t) => pickToken(t, "input")}
          />
        </div>
        {input && <code title={input.mint}>{short(input.mint)}</code>}
      </div>
      <button
        type="button"
        className="commerce-reverse focus-ring"
        aria-label="Reverse token pair"
        disabled={locked}
        onClick={() => {
          setInputMint(outputMint);
          setOutputMint(inputMint);
          clear();
        }}
      >
        <ArrowDownUp aria-hidden="true" />
      </button>
      <div className="commerce-amount">
        <label htmlFor={`${id}-to`}>You receive</label>
        <div>
          <output id={`${id}-to`} className="swap-receive" aria-live="polite">
            {routes.isRunning
              ? "…"
              : fresh && output
                ? formatTokenAmount(best.outputAmountRaw, output.decimals)
                : "0.00"}
          </output>
          <TokenPicker
            token={output}
            tokens={all}
            label="Receive token"
            disabled={locked}
            wallet={linked ? connected?.account.address : undefined}
            onSelect={(t) => pickToken(t, "output")}
          />
        </div>
        {output && <code title={output.mint}>{short(output.mint)}</code>}
      </div>
      <div className="commerce-inline">
        <label htmlFor={`${id}-slip`}>Slippage limit</label>
        <select
          id={`${id}-slip`}
          value={slippage}
          disabled={locked}
          onChange={(e) => {
            setSlippage(Number(e.target.value));
            clear();
          }}
        >
          <option value={10}>0.1%</option>
          <option value={50}>0.5%</option>
          <option value={100}>1%</option>
        </select>
      </div>
      <details className="commerce-details">
        <summary>Wallet compatibility</summary>
        <div className="commerce-inline">
          <label htmlFor={`${id}-format`}>Transaction format</label>
          <select
            id={`${id}-format`}
            value={format}
            disabled={locked}
            onChange={(e) => {
              setFormat(e.target.value === "v0" ? "v0" : "auto");
              clear();
            }}
          >
            <option value="auto">Automatic</option>
            <option value="v0">v0 compatibility</option>
          </select>
        </div>
        <p>
          Automatic checks the wallet send capability. If your wallet reports an
          internal error with v1, you can select v0 for a future swap after any
          held outcome is verified. This never retries an existing payment.
        </p>
      </details>
      {best && fresh && input && output && (
        <div className="swap-preview" aria-label="Swap estimate">
          <dl>
            <div>
              <dt>Minimum received</dt>
              <dd>
                {formatTokenAmount(
                  best.minimumOutputAmountRaw,
                  output.decimals,
                )}{" "}
                {output.symbol}
              </dd>
            </div>
            <div>
              <dt>Platform fee · included</dt>
              <dd>{feeLabel(best)}</dd>
            </div>
            <div>
              <dt>Price impact</dt>
              <dd>{(best.priceImpactBps / 100).toFixed(2)}%</dd>
            </div>
          </dl>
          <div className="commerce-inline">
            <span>
              {best.execution === "jupiter-managed"
                ? "Jupiter managed · verified Metis route"
                : `${best.provider === "jupiter" ? "Jupiter" : "Raydium"} · highest quoted output`}
            </span>
            <span>
              Quote valid{" "}
              {Math.max(0, Math.ceil((best.expiresAt - now) / 1000))}s
            </span>
          </div>
          <p>
            Network fees and any token-account rent are extra. Wallet approval
            shows the final transaction.
          </p>
          {best.priceImpactBps >= 100 && (
            <p role="status">
              High price impact: this trade may move the pool price
              significantly. Consider a smaller amount.
            </p>
          )}
        </div>
      )}
      {!online && (
        <p className="commerce-note" role="status">
          You are offline. Reconnect before requesting a quote or opening wallet
          approval.
        </p>
      )}
      <Button
        className="w-full swap-primary"
        disabled={
          finalized ? busy : needsRecovery ? busy : !canQuote || busy || sent
        }
        aria-controls={needsRecovery ? `${id}-history` : undefined}
        onClick={() => {
          if (finalized && !unresolved) {
            revision.current++;
            dispatched.current = false;
            purchaseActive.current = false;
            attemptedQuote.current = "";
            setSent(false);
            setFinalized(false);
            setSignature("");
            setAmount("");
            setPrepared(null);
            setSelected(null);
            setResult(null);
            setNotice("");
            setError("");
            return;
          }
          if (needsRecovery) {
            if (history.current) {
              history.current.open = true;
              history.current.scrollIntoView({ block: "nearest" });
              history.current.querySelector("summary")?.focus();
            }
            return;
          }
          if (purchaseActive.current || dispatched.current || unresolved)
            return;
          purchaseActive.current = true;
          buy.dispatch();
        }}
      >
        {send.isRunning
          ? "Waiting for wallet / receipt…"
          : needsRecovery
            ? recovering?.recovery?.state === "checking"
              ? "Checking swap outcome…"
              : !recovering?.recovery || recovering.recovery.state === "review"
                ? "View swap status"
                : recovering?.signature
                  ? recovering.recovery?.progress === "confirmed"
                    ? "Confirmed · finalizing…"
                    : "Awaiting confirmation"
                  : "Waiting for verification"
            : sent
              ? finalized
                ? "New swap"
                : "Wallet request completed"
              : prepare.isRunning
                ? "Preparing swap…"
                : routes.isRunning || buy.isRunning
                  ? "Finding your route…"
                  : !online
                    ? "Reconnect to swap"
                    : !isAuthenticated
                      ? "Sign in to swap"
                      : !linked
                        ? "Connect your linked wallet"
                        : !supportsV0 && !supportsV1
                          ? config?.signatureFirstEnabled
                            ? "Wallet cannot sign this format"
                            : "Wallet cannot send this format"
                          : !rawAmount || BigInt(rawAmount) === 0n
                            ? "Enter an amount"
                            : outputToken
                              ? `Buy ${output?.symbol ?? "token"}`
                              : "Swap"}
      </Button>
      {recovering && (
        <div className="commerce-note" role="status">
          {recovering.recovery?.state === "review" ? (
            <p>
              Automatic checks could not prove the outcome. This swap needs
              review; it has not been retried. Receipt details are available
              below.
            </p>
          ) : recovering.recovery?.state === "checking" ? (
            <p>
              Verifying the outcome against independent chain records. Nothing
              is being resent.
            </p>
          ) : recovering.recovery?.reason === "waiting_expiry" ? (
            <p>
              Checking automatically after the transaction expires. A 15-minute
              safety window and two independent chain checks protect against
              duplicate payments.
              {recovering.recovery.nextCheckAt > now
                ? ` Next check in ${Math.ceil((recovering.recovery.nextCheckAt - now) / 60_000)} min.`
                : " Verification is due now."}
            </p>
          ) : recovering.recovery?.reason === "budget_unavailable" ? (
            <p>
              Verification is waiting for free-tier capacity. The swap stays
              protected; no extra fees or automatic payment retry.
              {recovering.recovery.nextCheckAt > now
                ? ` Next check in ${Math.ceil((recovering.recovery.nextCheckAt - now) / 60_000)} min.`
                : ""}
            </p>
          ) : !recovering.recovery ? (
            <p>
              {recoveryUnavailable === recovering.quoteId
                ? "Automatic verification could not be scheduled. The saved swap remains protected; open swap status for receipt details. Nothing was resent."
                : "Requesting automatic outcome verification. Nothing is being resent."}
            </p>
          ) : (
            <p>
              Automatic outcome verification is queued. You do not need to click
              again or keep this page open. Nothing will be resent.
              {recovering.recovery.nextCheckAt > now
                ? recovering.recovery.nextCheckAt - now < 60000
                  ? ` Next check in ${Math.ceil((recovering.recovery.nextCheckAt - now) / 1000)} sec.`
                  : ` Next check in ${Math.ceil((recovering.recovery.nextCheckAt - now) / 60_000)} min.`
                : ""}
            </p>
          )}
        </div>
      )}
      {recovering?.recovery?.diagnostic && (
        <p className="commerce-note">
          Last check: {recovering.recovery.diagnostic.replaceAll("_", " ")}.
          Nothing is being resent.
        </p>
      )}
      {best && !fresh && !sent && (
        <p className="commerce-note">
          Quote expired. A fresh quote will be checked when you swap.
        </p>
      )}
      {result && (
        <details className="commerce-details commerce-routes">
          <summary>
            Route and fees ·{" "}
            {result.platformFeeBps === 0
              ? "Platform fee waived"
              : `${result.platformFeeBps / 100}% platform fee`}
          </summary>
          <div className="commerce-heading">
            <h3>Route comparison</h3>
            <span>
              {result.platformFeeBps === 0
                ? "Platform fee waived"
                : `${result.platformFeeBps / 100}% platform fee`}
            </span>
          </div>
          <p>
            Highest quoted output first. Network costs and rent are not part of
            this ranking.
          </p>
          <dl className="swap-mints">
            <div>
              <dt>Pay mint</dt>
              <dd>
                <code>{inputMint}</code>
              </dd>
            </div>
            <div>
              <dt>Receive mint</dt>
              <dd>
                <code>{outputMint}</code>
              </dd>
            </div>
          </dl>
          {result.quotes.map((q, i) => (
            <div key={q.quoteId} className="commerce-route">
              <span>
                <strong>
                  {q.provider === "jupiter" ? "Jupiter" : "Raydium"}
                </strong>
                {i === 0 && <small>Highest quoted output</small>}
              </span>
              <span>
                <strong>
                  {formatTokenAmount(q.outputAmountRaw, output?.decimals ?? 6)}{" "}
                  {output?.symbol}
                </strong>
                <small>
                  {Math.max(0, Math.ceil((q.expiresAt - now) / 1000))}s to quote
                </small>
              </span>
            </div>
          ))}
          {result.failures.length > 0 && (
            <p>
              {result.failures
                .map((f) => (f.provider === "jupiter" ? "Jupiter" : "Raydium"))
                .join(", ")}{" "}
              unavailable. Comparison coverage is limited.
            </p>
          )}
        </details>
      )}
      {prepared && selected && (
        <details className="commerce-details commerce-review">
          <summary>Transaction details</summary>
          <dl>
            <div>
              <dt>Minimum received</dt>
              <dd>
                {formatTokenAmount(
                  selected.minimumOutputAmountRaw,
                  output?.decimals ?? 6,
                )}{" "}
                {output?.symbol}
              </dd>
            </div>
            <div>
              <dt>Platform fee (included)</dt>
              <dd>{feeLabel(selected)}</dd>
            </div>
            <div>
              <dt>Price impact</dt>
              <dd>{(selected.priceImpactBps / 100).toFixed(2)}%</dd>
            </div>
            <div>
              <dt>Estimated network fee</dt>
              <dd>
                {formatTokenAmount(prepared.estimatedNetworkFeeLamports, 9)} SOL
              </dd>
            </div>
          </dl>
          <p>
            New token-account rent may also be required. Pool fees are included
            in the route quote. Simulation is not a guarantee of execution.
          </p>
        </details>
      )}
      {signature && (
        <a
          className="commerce-receipt"
          href={`https://solscan.io/tx/${signature}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View transaction <ArrowUpRight aria-hidden="true" />
        </a>
      )}
      {walletDiagnostic && (
        <details className="commerce-details">
          <summary>Safe wallet diagnostic</summary>
          <p>{walletDiagnostic}</p>
          <p>
            No keys, transaction contents or provider error text are included.
          </p>
        </details>
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
      <div className="commerce-benefit">
        <span>Hold more than $1 of SYMF to waive our swap fee.</span>
        <Button
          variant="ghost"
          disabled={
            !connected || !isAuthenticated || locked || benefit.isRunning
          }
          onClick={() => benefit.dispatch()}
        >
          Refresh benefit
        </Button>
      </div>
      <ForumLink className="commerce-account" href="/account/connections">
        Manage linked wallets
      </ForumLink>
      {(!!mine?.length || needsRecovery) && (
        <details
          className="commerce-details"
          id={`${id}-history`}
          ref={history}
        >
          <summary>Recent operations</summary>
          {needsRecovery && (
            <div className="commerce-note" role="status">
              <p>
                A previous wallet request needs verification. New swaps are
                paused to avoid a duplicate payment; this button never resends
                it.
              </p>
              <p>
                {recovering?.signature ? (
                  "The transaction signature is saved. Outcome checks continue automatically, including after you leave this page. Use the saved receipt link for independent transaction details."
                ) : (
                  <>
                    If wallet Activity has a transaction signature, paste it
                    below and choose Check receipt. If Activity is empty, the
                    hold needs an independent expiry and transaction-history
                    check. An empty Activity list alone does not clear it.
                  </>
                )}
              </p>
              {connected && (
                <a
                  href={`https://solscan.io/account/${connected.account.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  View wallet transactions
                </a>
              )}
            </div>
          )}
          {(mine ?? []).map((row) => (
            <div className="commerce-history" key={row.quoteId}>
              <span>
                {short(row.inputMint)} / {short(row.outputMint)} · {row.status}
              </span>
              {!row.signature && ["held", "submitted"].includes(row.status) && (
                <Input
                  aria-label={`Receipt signature for ${row.quoteId}`}
                  placeholder="Signature from wallet history"
                  value={recoverySignatures[row.quoteId] ?? ""}
                  onChange={(e) =>
                    setRecoverySignatures((old) => ({
                      ...old,
                      [row.quoteId]: e.target.value,
                    }))
                  }
                />
              )}
              {(row.signature || recoverySignatures[row.quoteId]) && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    void confirm({
                      quoteId: row.quoteId,
                      signature:
                        row.signature ?? recoverySignatures[row.quoteId],
                    })
                      .then((r) => {
                        if (
                          r.status === "confirmed" &&
                          row.quoteId === selected?.quoteId
                        )
                          setFinalized(true);
                        setNotice(`Receipt status: ${r.status}.`);
                      })
                      .catch(() =>
                        setError(
                          "Receipt check unavailable. No transaction was resent.",
                        ),
                      );
                  }}
                >
                  Check receipt
                </Button>
              )}
              {!row.signature &&
                ["held", "prepared", "submitted", "preparing"].includes(
                  row.status,
                ) && (
                  <small>
                    Unfinished operation. Check wallet history; never repeat
                    blindly.
                  </small>
                )}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
