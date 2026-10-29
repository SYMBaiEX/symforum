"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { getWallets } from "@wallet-standard/app";
import { LoaderCircle, Wallet } from "lucide-react";
import {
  identityRequest,
  refreshIdentitySession,
} from "@symbaiex/auth/identity-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  requestWalletProof,
  connectMessageWallet,
  requestMessageProof,
  supportsMessageSigning,
  walletFailureMessage,
  type MessageSignWallet,
  type MessageWalletAccount,
  type SignInWallet,
  type WalletChallenge,
} from "@/lib/wallet-signin";

type RegisteredWallet = ReturnType<
  ReturnType<typeof getWallets>["get"]
>[number];
type CompatibleWallet = RegisteredWallet & (MessageSignWallet | SignInWallet);
function supportsSignIn(
  wallet: RegisteredWallet,
): wallet is RegisteredWallet & SignInWallet {
  return (
    typeof (
      wallet.features["solana:signIn"] as
        SignInWallet["features"]["solana:signIn"] | undefined
    )?.signIn === "function"
  );
}
function compatible(wallet: RegisteredWallet): wallet is CompatibleWallet {
  return (
    wallet.chains.some((chain) => chain.startsWith("solana:")) &&
    (supportsMessageSigning(wallet) || supportsSignIn(wallet))
  );
}
type PreparedRequest =
  | {
      method: "message";
      wallet: RegisteredWallet & MessageSignWallet;
      account: MessageWalletAccount;
      challenge: WalletChallenge;
    }
  | {
      method: "signIn";
      wallet: RegisteredWallet & SignInWallet;
      challenge: WalletChallenge;
    };
type Phase =
  "idle" | "connecting" | "preparing" | "signing" | "verification" | "session";

export function WalletSignIn({
  purpose,
  disabled,
  onBusyChange,
  onComplete,
}: {
  purpose: "login" | "link";
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<CompatibleWallet[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [selected, setSelected] = useState<CompatibleWallet | null>(null);
  const [accounts, setAccounts] = useState<readonly MessageWalletAccount[]>([]);
  const [prepared, setPrepared] = useState<PreparedRequest | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    const registry = getWallets();
    const update = () => setWallets(registry.get().filter(compatible));
    update();
    const offRegister = registry.on("register", update);
    const offUnregister = registry.on("unregister", update);
    return () => {
      offRegister();
      offUnregister();
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

  async function prepare(
    wallet: CompatibleWallet,
    account?: MessageWalletAccount,
  ) {
    setPhase("preparing");
    const challenge = await identityRequest<WalletChallenge>(
      "/identity/challenge",
      { provider: "solana", purpose },
    );
    if (!challenge.input)
      throw new Error("Wallet verification is unavailable.");
    if (supportsMessageSigning(wallet) && account)
      setPrepared({ method: "message", wallet, account, challenge });
    else if (supportsSignIn(wallet))
      setPrepared({ method: "signIn", wallet, challenge });
    else throw new Error("A message-signing account is required.");
    setAccounts([]);
  }

  async function choose(
    wallet: CompatibleWallet,
    account?: MessageWalletAccount,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSelected(wallet);
    setPrepared(null);
    setAccounts([]);
    setError("");
    onBusyChange(true);
    let connecting = false;
    try {
      // Connect directly from the selection click, before any network await.
      // The next, separate click signs the fresh server challenge. Phantom's
      // combined signIn RPC is not forced on wallets with message signing.
      if (supportsMessageSigning(wallet)) {
        connecting = !account;
        setPhase("connecting");
        const choices = account
          ? [account]
          : await connectMessageWallet(wallet);
        connecting = false;
        if (choices.length === 1) await prepare(wallet, choices[0]);
        else setAccounts(choices);
      } else await prepare(wallet);
    } catch (reason) {
      setError(
        connecting
          ? walletFailureMessage(reason, wallet.name, "connect")
          : "Could not prepare secure sign-in. Select your wallet to start a new request.",
      );
    } finally {
      inFlight.current = false;
      setPhase("idle");
      onBusyChange(false);
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
    try {
      const proof =
        request.method === "message"
          ? await requestMessageProof(
              request.wallet,
              request.account,
              request.challenge,
              window.location,
            )
          : await requestWalletProof(
              request.wallet,
              request.challenge,
              window.location,
            );
      current = "verification";
      setPhase(current);
      await identityRequest("/sign-in/solana", proof);
      current = "session";
      setPhase(current);
      await refreshIdentitySession();
      setOpen(false);
      onComplete();
    } catch (reason) {
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
      setPhase("idle");
      onBusyChange(false);
    }
  }

  const busy = phase !== "idle";
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          <Wallet data-icon="inline-start" />
          {purpose === "link" ? "Link wallet" : "Solana wallet"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-sm overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {purpose === "link" ? "Link a wallet" : "Connect a wallet"}
          </DialogTitle>
          <DialogDescription>
            Choose your Solana wallet, then sign a message to finish. No
            transaction, fees or spending access.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3" aria-busy={busy}>
          {wallets.map((wallet, index) => (
            <Button
              key={`${wallet.name}-${index}`}
              type="button"
              variant="outline"
              size="lg"
              className="h-14 justify-between gap-3 px-4"
              disabled={busy}
              onClick={() => void choose(wallet)}
            >
              <span className="flex min-w-0 items-center gap-3">
                {wallet.icon.startsWith("data:image/") ? (
                  <Image
                    src={wallet.icon}
                    alt=""
                    width={28}
                    height={28}
                    unoptimized
                    className="size-7 rounded-md"
                  />
                ) : (
                  <Wallet aria-hidden="true" data-icon="inline-start" />
                )}
                <span className="truncate">{wallet.name}</span>
              </span>
              {busy && selected === wallet ? (
                <LoaderCircle
                  aria-hidden="true"
                  data-icon="inline-end"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Badge variant="secondary">Installed</Badge>
              )}
            </Button>
          ))}
          {!wallets.length && (
            <p className="text-sm text-muted-foreground">
              No compatible wallet found. Install a Solana wallet such as
              Phantom, or open this site in your wallet’s browser.
            </p>
          )}
          <p role="status" className="text-sm text-muted-foreground">
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
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!busy &&
            accounts.map((account) => (
              <Button
                key={account.address}
                type="button"
                variant="outline"
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
                <p className="text-sm text-muted-foreground">
                  Account: {prepared.account.address.slice(0, 6)}…
                  {prepared.account.address.slice(-4)}. Sign-in message only.
                </p>
              )}
              <Button type="button" onClick={() => void sign()}>
                Sign in with {prepared.wallet.name}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
