"use client";

import { useRef, useState, useEffect, useId } from "react";
import {
  useQuery,
  useAction as useConvexAction,
  useMutation,
  useConvexAuth,
} from "convex/react";
import { useAction } from "@solana/react";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { ArrowDownUp, ArrowUpRight, ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ForumLink } from "@/components/forum/forum-link";
import { useForumRuntime } from "@/components/forum/forum-runtime-context";
import { forumSiteUrl } from "@/lib/site-urls";
import { parseTokenAmount, formatTokenAmount } from "@/lib/swap-amounts";
import {
  requestReviewedTransaction,
  verifyPreparedTransaction,
  type CommerceWalletClient,
  type ReviewedTransaction,
} from "@/lib/commerce-wallet-client";
import {
  CommerceWalletButton,
  CommerceWalletProvider,
  useCommerceWallet,
} from "./commerce-wallet";

export type TradeToken = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  tokenProgram: string;
};
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
type QuoteResult = FunctionReturnType<typeof api.forumSwaps.quote>;
type Quote = QuoteResult["quotes"][number];
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
              Our router compares quotes from Jupiter and Raydium. It selects
              the highest quoted token output among the sources that respond,
              not a guarantee of the best possible execution across every
              market.
            </p>
            <h3>Hold SYMF, skip the platform fee</h3>
            <p>
              Wallets holding strictly more than $1 of verified SYMF pay no
              platform swap fee. Other wallets pay 0.25%, included in the amount
              entered. Pool fees, Solana network costs and any new token-account
              rent still apply.
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
  const connected = useConnectedWallet(client),
    { isAuthenticated } = useConvexAuth();
  const config = useQuery(api.forumCommerce.getConfig, {}),
    tokens = useQuery(api.forumCommerce.searchTokens, {});
  const quoteAction = useConvexAction(api.forumSwaps.quote),
    prepareAction = useConvexAction(api.forumSwaps.prepare),
    confirm = useConvexAction(api.forumSwaps.confirm),
    hold = useMutation(api.forumSwaps.markUnknown),
    begin = useMutation(api.forumSwaps.beginWalletRequest);
  const refresh = useConvexAction(api.forumCommerce.refreshBenefit);
  const mine = useQuery(api.forumSwaps.listMine, isAuthenticated ? {} : "skip");
  const [inputMint, setInputMint] = useState(SOL),
    [outputMint, setOutputMint] = useState(outputToken?.mint ?? USDC),
    [amount, setAmount] = useState(""),
    [slippage, setSlippage] = useState(50);
  const [extra, setExtra] = useState<TradeToken[]>([]),
    [mintSearch, setMintSearch] = useState("");
  const resolveMint = useConvexAction(api.forumCommerce.resolveMint);
  const [result, setResult] = useState<QuoteResult | null>(null),
    [selected, setSelected] = useState<Quote | null>(null),
    [prepared, setPrepared] = useState<ReviewedTransaction | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [sent, setSent] = useState(false),
    [signature, setSignature] = useState("");
  const [recoverySignatures, setRecoverySignatures] = useState<
    Record<string, string>
  >({});
  const [finalized, setFinalized] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dispatched = useRef(false),
    busyGuard = useRef(false),
    identity = useRef(connected?.account.address);
  const id = useId();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (identity.current !== connected?.account.address) {
      identity.current = connected?.account.address;
      setResult(null);
      setSelected(null);
      setPrepared(null);
    }
  }, [connected?.account.address]);
  const all = [
    ...(tokens ?? []),
    ...(outputToken ? [outputToken] : []),
    ...extra,
  ].filter((t, i, a) => a.findIndex((x) => x.mint === t.mint) === i);
  const input = all.find((t) => t.mint === inputMint),
    output = all.find((t) => t.mint === outputMint);
  const clear = () => {
    setResult(null);
    setSelected(null);
    setPrepared(null);
    setError("");
    setNotice("");
  };
  const routes = useAction(async () => {
    if (busyGuard.current || dispatched.current) return;
    busyGuard.current = true;
    clear();
    try {
      if (!connected || !input)
        throw new Error("Connect a linked payment wallet.");
      const data = await quoteAction({
        wallet: connected.account.address,
        inputMint,
        outputMint,
        amountRaw: parseTokenAmount(amount, input.decimals),
        slippageBps: slippage,
        supportsV1: connected.supportedTransactionVersions.has(1),
      });
      if (
        client.wallet.getState().connected?.account.address !==
        connected.account.address
      )
        return;
      setResult(data);
      if (!data.quotes.length)
        setNotice(
          "No safe routes responded. Nothing was signed. Try later or use a smaller amount.",
        );
    } catch {
      setError(
        "Routes could not be verified. Check the amount, your linked wallet in Account Connections, and try later if the free data limit has been reached.",
      );
    } finally {
      busyGuard.current = false;
    }
  });
  const prepare = useAction(async (_signal: AbortSignal, q: Quote) => {
    if (busyGuard.current || dispatched.current) return;
    busyGuard.current = true;
    setError("");
    setSelected(q);
    try {
      const data = await prepareAction({ quoteId: q.quoteId });
      const walletNow = client.wallet.getState().connected;
      if (
        walletNow?.account.address !== data.wallet ||
        !walletNow.supportedTransactionVersions.has(data.transactionVersion)
      )
        throw new Error(
          "Connected wallet changed or does not support this transaction version.",
        );
      setPrepared(await verifyPreparedTransaction(data));
    } catch {
      setSelected(null);
      setPrepared(null);
      setResult(null);
      setError(
        "This route could not pass preparation and simulation, or its quote expired. No wallet request was made. Request fresh routes.",
      );
    } finally {
      busyGuard.current = false;
    }
  });
  const send = useAction(async () => {
    if (
      dispatched.current ||
      !selected ||
      !prepared ||
      selected.expiresAt <= Date.now()
    )
      return;
    dispatched.current = true;
    setSent(true);
    setError("");
    setNotice("Approve only if the amounts and destination match your review.");
    let walletInvoked = false;
    try {
      await begin({ quoteId: selected.quoteId });
      walletInvoked = true;
      const sig = await requestReviewedTransaction(client, prepared);
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
    } catch {
      if (walletInvoked)
        await hold({ quoteId: selected.quoteId }).catch(() => {});
      setError(
        walletInvoked
          ? "Wallet outcome is uncertain or the request was declined. Do not repeat this operation. Check wallet history and use the receipt check below if a signature is available."
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
  const lookup = useAction(async () => {
    if (!connected) return;
    try {
      const t = await resolveMint({
        wallet: connected.account.address,
        mint: mintSearch.trim(),
      });
      setExtra((xs) => [...xs.filter((x) => x.mint !== t.mint), t]);
      setOutputMint(t.mint);
      setMintSearch("");
      clear();
    } catch {
      setError(
        "Mint could not be verified, is unsupported, or the data limit has been reached.",
      );
    }
  });
  const busy =
    routes.isRunning || prepare.isRunning || send.isRunning || lookup.isRunning;
  const locked = busy || sent;
  const canQuote =
    config?.swapsEnabled &&
    isAuthenticated &&
    connected &&
    input &&
    output &&
    amount &&
    inputMint !== outputMint &&
    !locked;
  return (
    <section className="commerce-panel token-swap" aria-label="Token swap">
      <div className="commerce-heading">
        <h2>Swap tokens</h2>
        <span>Solana mainnet</span>
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
          and link your wallet to trade.
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
              setAmount(e.target.value);
              clear();
            }}
          />
          <label className="sr-only" htmlFor={`${id}-from`}>
            Pay token
          </label>
          <select
            id={`${id}-from`}
            value={inputMint}
            disabled={locked}
            onChange={(e) => {
              setInputMint(e.target.value);
              clear();
            }}
          >
            {all.map((t) => (
              <option value={t.mint} key={t.mint}>
                {t.symbol}
              </option>
            ))}
          </select>
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
        <select
          id={`${id}-to`}
          value={outputMint}
          disabled={locked}
          onChange={(e) => {
            setOutputMint(e.target.value);
            clear();
          }}
        >
          {all.map((t) => (
            <option value={t.mint} key={t.mint}>
              {t.symbol} · {t.name}
            </option>
          ))}
        </select>
        {output && <code className="commerce-mint">{output.mint}</code>}
      </div>
      <details className="commerce-details">
        <summary>Find another token by mint</summary>
        <label htmlFor={`${id}-mint`}>Exact Solana mint</label>
        <Input
          id={`${id}-mint`}
          value={mintSearch}
          disabled={locked}
          onChange={(e) => setMintSearch(e.target.value)}
          placeholder="Paste the full mint address"
        />
        <Button
          variant="outline"
          disabled={!connected || !isAuthenticated || !mintSearch || locked}
          onClick={() => lookup.dispatch()}
        >
          Verify mint
        </Button>
        <p>Verified on-chain metadata is not a security audit.</p>
      </details>
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
      <Button
        className="w-full"
        disabled={!canQuote}
        onClick={() => routes.dispatch()}
      >
        {routes.isRunning ? "Comparing routes…" : "Compare routes"}
      </Button>
      {result && (
        <div className="commerce-routes">
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
          {result.quotes.map((q, i) => (
            <button
              key={q.quoteId}
              type="button"
              className="commerce-route focus-ring"
              aria-pressed={selected?.quoteId === q.quoteId}
              disabled={locked || q.expiresAt <= now || !!prepared}
              onClick={() => prepare.dispatch(q)}
            >
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
                  {Math.max(0, Math.ceil((q.expiresAt - now) / 1000))}s to
                  review
                </small>
              </span>
            </button>
          ))}
          {result.failures.length > 0 && (
            <p>
              {result.failures
                .map((f) => (f.provider === "jupiter" ? "Jupiter" : "Raydium"))
                .join(", ")}{" "}
              unavailable. Comparison coverage is limited.
            </p>
          )}
        </div>
      )}
      {prepared && selected && (
        <section className="commerce-review" aria-label="Review swap">
          <h3>
            <ShieldCheck aria-hidden="true" />
            Review before approving
          </h3>
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
              <dd>
                {formatTokenAmount(
                  selected.platformFeeRaw,
                  input?.decimals ?? 9,
                )}{" "}
                {input?.symbol}
              </dd>
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
          <Button
            className="w-full"
            disabled={
              sent ||
              send.isRunning ||
              selected.expiresAt <= now ||
              !isAuthenticated ||
              connected?.account.address !== prepared.wallet
            }
            onClick={() => send.dispatch()}
          >
            {send.isRunning
              ? "Waiting for wallet / receipt…"
              : sent
                ? "Wallet request completed"
                : selected.expiresAt <= now
                  ? "Quote expired"
                  : "Approve in wallet"}
          </Button>
        </section>
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
      {finalized && (
        <Button
          variant="outline"
          onClick={() => {
            dispatched.current = false;
            setSent(false);
            setFinalized(false);
            setSignature("");
            clear();
          }}
        >
          Start a new swap
        </Button>
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
      {!!mine?.length && (
        <details className="commerce-details">
          <summary>Recent operations</summary>
          {mine.map((row) => (
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
                      .then((r) => setNotice(`Receipt status: ${r.status}.`))
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
