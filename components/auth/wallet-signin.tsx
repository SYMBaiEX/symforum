"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ClientProvider, useClient } from "@solana/react";
import {
  useConnect,
  useSignIn,
  useSelectAccount,
  useWallets,
  useIsWalletReady,
} from "@solana/kit-plugin-wallet/react";
import type { UiWallet, UiWalletAccount } from "@wallet-standard/ui";
import { ChevronRight, LoaderCircle, ShieldCheck, Wallet } from "lucide-react";
import {
  identityRequest,
  refreshIdentitySession,
} from "@symbaiex/auth/identity-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  requestSiwsProof,
  walletFailureMessage,
  type WalletChallenge,
} from "@/lib/wallet-signin";
import {
  requestIdentityMessageProof,
  type IdentityWalletClient,
} from "@/lib/identity-wallet-client";
import {
  SolanaWalletBoundary,
  useSessionWalletClient,
} from "./solana-wallet-provider";
import {
  createWalletDiagnostic,
  type WalletDiagnosticAttempt,
} from "@/lib/wallet-diagnostics";

type PreparedRequest =
  | {
      method: "message";
      wallet: UiWallet;
      account: UiWalletAccount;
      challenge: WalletChallenge;
    }
  | {
      method: "signIn";
      wallet: UiWallet;
      challenge: WalletChallenge;
    };
type Phase =
  "idle" | "connecting" | "preparing" | "signing" | "verification" | "session";

type WalletSignInProps = {
  label?: string;
  purpose: "login" | "link";
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onComplete: () => void;
};

export function WalletSignIn(props: WalletSignInProps) {
  return (
    <SolanaWalletBoundary>
      <SharedWalletSignIn {...props} />
    </SolanaWalletBoundary>
  );
}
function SharedWalletSignIn(props: WalletSignInProps) {
  const client = useSessionWalletClient();
  // Construct after mount, so SSR and discarded Strict Mode renders never
  // register browser wallet listeners or share state between requests.
  if (!client)
    return (
      <Button type="button" variant="outline" disabled>
        <Wallet data-icon="inline-start" />
        {props.label ??
          (props.purpose === "link" ? "Link wallet" : "Solana wallet")}
      </Button>
    );
  return (
    <ClientProvider client={client}>
      <WalletPicker {...props} />
    </ClientProvider>
  );
}

function WalletPicker({
  label,
  purpose,
  disabled,
  onBusyChange,
  onComplete,
}: WalletSignInProps) {
  const client = useClient<IdentityWalletClient>();
  const wallets = useWallets(client).filter(
    (wallet) =>
      wallet.features.includes("solana:signMessage") ||
      wallet.features.includes("solana:signIn"),
  );
  const ready = useIsWalletReady(client);
  const connect = useConnect(client);
  const signIn = useSignIn(client);
  const selectAccount = useSelectAccount(client);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [selected, setSelected] = useState<UiWallet | null>(null);
  const [accounts, setAccounts] = useState<readonly UiWalletAccount[]>([]);
  const [prepared, setPrepared] = useState<PreparedRequest | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const active = useRef(true);
  const diagnostic = useRef<WalletDiagnosticAttempt | null>(null);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  function changeOpen(value: boolean) {
    if (inFlight.current) return;
    setOpen(value);
    setSelected(null);
    setAccounts([]);
    setPrepared(null);
    setError("");
  }

  async function prepare(wallet: UiWallet, account?: UiWalletAccount) {
    if (account) selectAccount(account);
    setPhase("preparing");
    diagnostic.current?.record("challenge_requested");
    const challenge = await identityRequest<WalletChallenge>(
      "/identity/challenge",
      { provider: "solana", purpose },
    );
    if (!active.current) return;
    if (!challenge.input)
      throw new Error("Wallet verification is unavailable.");
    diagnostic.current?.record("challenge_ready");
    if (wallet.features.includes("solana:signMessage") && account)
      setPrepared({ method: "message", wallet, account, challenge });
    else if (wallet.features.includes("solana:signIn"))
      setPrepared({ method: "signIn", wallet, challenge });
    else throw new Error("A message-signing account is required.");
    setAccounts([]);
  }

  async function choose(wallet: UiWallet, account?: UiWalletAccount) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSelected(wallet);
    setPrepared(null);
    setAccounts([]);
    setError("");
    onBusyChange(true);
    const report =
      account && diagnostic.current
        ? diagnostic.current
        : createWalletDiagnostic(wallet.name);
    diagnostic.current = report;
    report.record("selected", {
      accountCount: wallet.accounts.length,
      canSignMessage: wallet.features.includes("solana:signMessage"),
      canSignIn: wallet.features.includes("solana:signIn"),
      sdkStatus: client.wallet.getState().status,
    });
    let connecting = false;
    try {
      // Connect directly from the selection click, before any network await.
      // The next, separate click signs the fresh server challenge. Phantom's
      // combined signIn RPC is not forced on wallets with message signing.
      if (wallet.features.includes("solana:signMessage")) {
        connecting = !account;
        setPhase("connecting");
        const exposed = wallet.accounts.filter(
          (a) =>
            a.chains.includes("solana:mainnet") &&
            a.features.includes("solana:signMessage"),
        );
        const authorized = account
          ? [account]
          : exposed.length
            ? exposed
            : await (() => {
                report.record("connect_requested");
                return connect.dispatchAsync(wallet);
              })();
        if (!active.current) return;
        report.record(
          account || exposed.length
            ? "existing_account_selected"
            : "connect_succeeded",
          {
            accountCount: authorized.length,
            sdkStatus: client.wallet.getState().status,
          },
        );
        const choices = authorized.filter(
          (a) =>
            a.chains.includes("solana:mainnet") &&
            a.features.includes("solana:signMessage"),
        );
        if (!choices.length)
          throw new Error("No message-signing Solana account was connected.");
        connecting = false;
        if (choices.length === 1) await prepare(wallet, choices[0]);
        else setAccounts(choices);
      } else await prepare(wallet);
    } catch (reason) {
      report.failure(connecting ? "connect" : "prepare", reason);
      if (active.current)
        setError(
          connecting
            ? walletFailureMessage(reason, wallet.name, "connect")
            : "Could not prepare secure sign-in. Select your wallet to start a new request.",
        );
    } finally {
      inFlight.current = false;
      if (active.current) {
        setPhase("idle");
        onBusyChange(false);
      }
    }
  }

  async function sign() {
    if (!prepared || inFlight.current) return;
    const request = prepared;
    inFlight.current = true;
    setPrepared(null); // Consume this attempt before opening the wallet.
    setError("");
    onBusyChange(true);
    let current: Phase = "signing";
    setPhase(current);
    const report = diagnostic.current;
    try {
      const proof =
        request.method === "message"
          ? await requestIdentityMessageProof(
              client,
              request.account,
              request.challenge,
              window.location,
              Date.now(),
              () => report?.record("signature_requested"),
            )
          : await requestSiwsProof(
              (input) => {
                report?.record("signature_requested");
                return signIn.dispatchAsync(request.wallet, input);
              },
              request.challenge,
              window.location,
            );
      if (!active.current) return;
      report?.record("signature_succeeded");
      current = "verification";
      setPhase(current);
      report?.record("proof_requested");
      await identityRequest("/sign-in/solana", proof);
      if (!active.current) return;
      report?.record("proof_verified");
      current = "session";
      setPhase(current);
      await refreshIdentitySession();
      if (!active.current) return;
      report?.record("session_confirmed");
      setOpen(false);
      onComplete();
    } catch (reason) {
      report?.failure(
        current === "signing"
          ? "sign"
          : current === "verification"
            ? "verify"
            : "session",
        reason,
      );
      if (active.current)
        setError(
          current === "signing"
            ? walletFailureMessage(
                reason,
                request.wallet.name,
                request.method === "message" ? "signMessage" : "signIn",
              )
            : current === "verification"
              ? "The server could not verify this sign-in. No accounts were merged. Select your wallet to start a new request."
              : "Wallet approval succeeded, but the session could not be confirmed. Refresh the page before retrying.",
        );
    } finally {
      inFlight.current = false;
      if (active.current) {
        setPhase("idle");
        onBusyChange(false);
      }
    }
  }

  const busy = phase !== "idle";
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled || !ready}>
          <Wallet data-icon="inline-start" />
          {label ?? (purpose === "link" ? "Link wallet" : "Solana wallet")}
        </Button>
      </DialogTrigger>
      <DialogContent
        data-surface="forum"
        className="wallet-picker"
        overlayClassName="wallet-picker-overlay"
      >
        <DialogHeader className="wallet-picker-header">
          <span className="wallet-picker-mark" aria-hidden="true">
            <Wallet />
          </span>
          <DialogTitle>
            {purpose === "link" ? "Link a wallet" : "Connect a wallet"}
          </DialogTitle>
          <DialogDescription>
            Choose your Solana wallet to continue to SYMBaiEX.
          </DialogDescription>
        </DialogHeader>
        <div className="wallet-picker-body" aria-busy={busy}>
          <div className="wallet-picker-options">
            {wallets.map((wallet, index) => (
              <Button
                key={`${wallet.name}-${index}`}
                type="button"
                variant="ghost"
                className="wallet-picker-option"
                data-selected={selected?.name === wallet.name}
                disabled={busy}
                onClick={() => void choose(wallet)}
              >
                <span className="wallet-picker-identity">
                  <span className="wallet-picker-icon">
                    {wallet.icon.startsWith("data:image/") ? (
                      <Image
                        src={wallet.icon}
                        alt=""
                        width={28}
                        height={28}
                        unoptimized
                        className="size-7"
                      />
                    ) : (
                      <Wallet aria-hidden="true" data-icon="inline-start" />
                    )}
                  </span>
                  <span className="wallet-picker-name">{wallet.name}</span>
                </span>{" "}
                {busy && selected?.name === wallet.name ? (
                  <LoaderCircle
                    aria-hidden="true"
                    data-icon="inline-end"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <span className="wallet-picker-availability">
                    Installed
                    <ChevronRight aria-hidden="true" />
                  </span>
                )}
              </Button>
            ))}
            {!wallets.length && (
              <p className="wallet-picker-empty">
                No compatible wallet found. Install a Solana wallet such as
                Phantom, or open this site in your wallet’s browser.
              </p>
            )}
          </div>
          <p role="status" className="wallet-picker-status">
            {phase === "connecting"
              ? `Connect your account in ${selected?.name}.`
              : phase === "preparing"
                ? "Preparing secure sign-in…"
                : phase === "signing"
                  ? `Approve the sign-in message in ${selected?.name}.`
                  : phase === "verification"
                    ? "Verifying your signed message…"
                    : phase === "session"
                      ? "Confirming your sign-in…"
                      : prepared
                        ? "Ready. Sign the message below to finish."
                        : accounts.length
                          ? "Choose the Solana account you want to sign in with."
                          : "Select a wallet to connect. Your wallet stays in control."}
          </p>
          {error && (
            <p role="alert" className="wallet-picker-error">
              {error}
            </p>
          )}
          {!busy &&
            accounts.map((account) => (
              <Button
                key={account.address}
                type="button"
                variant="outline"
                className="wallet-picker-account"
                onClick={() => {
                  if (selected) void choose(selected, account);
                }}
              >
                Use {account.address.slice(0, 6)}…{account.address.slice(-4)}
              </Button>
            ))}
          {prepared && !busy && (
            <>
              {prepared.method === "message" && (
                <p className="wallet-picker-account-hint">
                  Account: {prepared.account.address.slice(0, 6)}…
                  {prepared.account.address.slice(-4)}. Sign-in message only.
                </p>
              )}
              <Button
                className="wallet-picker-submit"
                type="button"
                onClick={() => void sign()}
              >
                Sign in with {prepared.wallet.name}
              </Button>
            </>
          )}
        </div>
        <div className="wallet-picker-assurance">
          <ShieldCheck aria-hidden="true" />
          <p>Message signature only. No transaction or spending approval.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
