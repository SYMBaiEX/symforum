"use client";
import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import {
  Search,
  ChevronDown,
  Check,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { TradeToken } from "./token-swap";
import type { DiscoveredToken } from "@/lib/swap-token-discovery";
import { SYMF_TOKEN } from "@/lib/symf-token";
import { isSolanaAddress } from "@/lib/forum-commerce";

export function TokenIcon({ token }: { token?: TradeToken }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [token?.mint]);
  const icon =
    token?.icon ??
    (token?.mint === SYMF_TOKEN.mint
      ? "/images/brand/symforum-icon-64.png"
      : null);
  return (
    <span
      className="swap-token-icon"
      data-token={token?.symbol}
      aria-hidden="true"
    >
      {icon && !failed ? (
        <img // eslint-disable-line @next/next/no-img-element -- Remote token icons are untrusted and must not enter the image optimizer.
          src={icon}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : token?.mint === "So11111111111111111111111111111111111111112" ? (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M6 4h15l-3 4H3zm-3 6h15l3 4H6zm3 6h15l-3 4H3z" />
        </svg>
      ) : token?.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? (
        <svg
          viewBox="0 0 24 24"
          width="23"
          height="23"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M7 4a9 9 0 0 0 0 16m10-16a9 9 0 0 1 0 16M12 5v14m3-11h-4a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 1 0 5H9" />
        </svg>
      ) : (
        (token?.symbol?.slice(0, 2) ?? "?")
      )}
    </span>
  );
}
export function TokenPicker({
  token,
  tokens,
  label,
  disabled,
  wallet,
  onSelect,
}: {
  token?: TradeToken;
  tokens: TradeToken[];
  label: string;
  disabled: boolean;
  wallet?: string;
  onSelect: (token: TradeToken) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [discovered, setDiscovered] = useState<DiscoveredToken[]>([]),
    [loading, setLoading] = useState(false),
    [verifying, setVerifying] = useState(false),
    [error, setError] = useState("");
  const discover = useAction(api.forumTokenDiscovery.search),
    resolve = useAction(api.forumCommerce.resolveMint);
  const generation = useRef(0);
  useEffect(() => {
    const run = ++generation.current;
    if (
      !open ||
      !wallet ||
      (search.trim().length > 0 && search.trim().length < 2)
    ) {
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      void discover({ wallet, search: search.trim() })
        .then((rows) => {
          if (run === generation.current) setDiscovered(rows);
        })
        .catch(() => {
          if (run === generation.current)
            setError(
              "Live search unavailable. Listed tokens and exact mint verification remain available.",
            );
        })
        .finally(() => {
          if (run === generation.current) setLoading(false);
        });
    }, 650);
    return () => {
      clearTimeout(timer);
      if (generation.current === run) generation.current = run + 1;
    };
  }, [open, search, wallet, discover]);
  const rows = [...tokens, ...discovered]
    .filter((t, i, all) => all.findIndex((x) => x.mint === t.mint) === i)
    .filter(
      (t) =>
        !search ||
        t.mint === search.trim() ||
        `${t.symbol} ${t.name}`
          .toLowerCase()
          .includes(search.trim().replace(/^\$/, "").toLowerCase()),
    );
  const exactMintQuery = isSolanaAddress(search.trim()) ? search.trim() : null;
  async function choose(candidate: TradeToken) {
    if (verifying) return;
    if (tokens.some((t) => t.mint === candidate.mint)) {
      onSelect(candidate);
      setOpen(false);
      return;
    }
    if (!wallet) return;
    setVerifying(true);
    setError("");
    try {
      const verified = await resolve({ wallet, mint: candidate.mint });
      onSelect({
        ...candidate,
        ...verified,
        ...(candidate.tokenProgram
          ? { symbol: candidate.symbol, name: candidate.name }
          : {}),
      });
      setOpen(false);
    } catch {
      setError("This mint could not be verified. No wallet request was made.");
    } finally {
      setVerifying(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!verifying) {
          setOpen(value);
          if (!value) setSearch("");
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="swap-token-select focus-ring"
          aria-label={label}
          disabled={disabled}
        >
          <TokenIcon token={token} />
          <span>{token?.symbol ?? "Select token"}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent
        data-surface="forum"
        className="swap-token-picker [&>div]:min-w-0"
        overlayClassName="wallet-picker-overlay"
      >
        <DialogHeader>
          <DialogTitle>Select a token</DialogTitle>
          <DialogDescription>
            Search Solana tokens by name, symbol or exact mint. Provider
            verification is not a security audit.
          </DialogDescription>
        </DialogHeader>
        <div className="swap-token-search">
          <Search aria-hidden="true" />
          <Input
            aria-label="Search tokens"
            placeholder="Search tokens or paste mint address"
            value={search}
            maxLength={64}
            onChange={(e) => {
              setSearch(e.target.value);
              setDiscovered([]);
            }}
          />
        </div>
        <div className="swap-token-quick">
          {tokens.slice(0, 3).map((t) => (
            <button
              type="button"
              className="min-w-0 flex-1"
              disabled={verifying}
              key={t.mint}
              onClick={() => void choose(t)}
            >
              <TokenIcon token={t} />
              <span className="min-w-0 truncate" title={t.symbol}>
                {t.symbol}
              </span>
            </button>
          ))}
        </div>
        <div className="swap-token-list-heading">
          <span>{search ? "Search results" : "Explore tokens"}</span>
          <span>{loading ? "Searching…" : `${rows.length} tokens`}</span>
        </div>
        <div
          className="swap-token-list"
          aria-label="Available tokens"
          aria-busy={loading || verifying}
        >
          {rows.map((t) => (
            <div
              key={t.mint}
              className="relative flex min-w-0 flex-wrap items-center"
            >
              <button
                type="button"
                className="swap-token-row focus-ring min-w-0 flex-none"
                style={{ width: "calc(100% - 52px)" }}
                disabled={verifying}
                onClick={() => void choose(t)}
              >
                <TokenIcon token={t} />
                <span>
                  <strong className="min-w-0">
                    <span className="min-w-0 truncate" title={t.symbol}>
                      {t.symbol}
                    </span>
                    {t.verified && (
                      <ShieldCheck aria-label="Verified by Jupiter" />
                    )}
                  </strong>
                  <small>{t.name}</small>
                  <code title={t.mint}>
                    {t.mint.slice(0, 6)}…{t.mint.slice(-6)}
                  </code>
                  {exactMintQuery === t.mint && (
                    <span className="text-xs leading-4 text-muted-foreground">
                      Exact mint match · identity only
                    </span>
                  )}
                </span>
                {t.mint === token?.mint && <Check aria-label="Selected" />}
              </button>
              <details className="min-w-0 basis-full">
                <summary
                  aria-label={`Inspect mint ${t.mint}`}
                  className="focus-ring absolute right-1 top-4 grid min-h-11 w-11 cursor-pointer list-none place-items-center rounded-md border border-border text-xs text-muted-foreground"
                >
                  Mint
                </summary>
                <div className="mx-3 mb-3 min-w-0">
                  <p>Exact mint · identity only</p>
                  <code className="block w-full select-all whitespace-normal break-all font-mono text-xs">
                    {t.mint}
                  </code>
                  <p>
                    Names and symbols are untrusted metadata. An address is not
                    an endorsement.
                  </p>
                </div>
              </details>
            </div>
          ))}
          {loading && (
            <p role="status">
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Loading token directory…
            </p>
          )}
          {!rows.length && !loading && (
            <p>
              No matching listed token. Paste an exact Solana mint to verify it.
            </p>
          )}
        </div>
        {!wallet && (
          <p className="swap-token-help">
            Sign in and connect your linked wallet to search the live token
            directory.
          </p>
        )}
        {wallet &&
          /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(search.trim()) &&
          !rows.some((t) => t.mint === search.trim()) && (
            <Button
              variant="outline"
              disabled={verifying}
              onClick={() =>
                void choose({
                  mint: search.trim(),
                  symbol: search.trim().slice(0, 6),
                  name: "Custom token",
                  decimals: 0,
                  tokenProgram: "",
                })
              }
            >
              {verifying ? "Verifying mint…" : "Verify exact mint"}
            </Button>
          )}
        {error && (
          <p role="alert" className="commerce-error">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
