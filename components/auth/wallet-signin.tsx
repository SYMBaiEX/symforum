"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { getWallets } from "@wallet-standard/app";
import { LoaderCircle, Wallet } from "lucide-react";
import {
  identityClient,
  identityRequest,
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
  isInternalWalletError,
  walletFailureMessage,
  type MessageSignWallet,
  type MessageWalletAccount,
  type SignInWallet,
  type WalletChallenge,
} from "@/lib/wallet-signin";

type RegisteredWallet = ReturnType<
  ReturnType<typeof getWallets>["get"]
>[number];
function supportsSignIn(
  wallet: RegisteredWallet,
): wallet is RegisteredWallet & SignInWallet {
  return (
    wallet.chains.some((chain) => chain.startsWith("solana:")) &&
    typeof (
      wallet.features["solana:signIn"] as
        SignInWallet["features"]["solana:signIn"] | undefined
    )?.signIn === "function"
  );
}

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
  const [wallets, setWallets] = useState<(RegisteredWallet & SignInWallet)[]>(
    [],
  );
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [messageOption, setMessageOption] = useState<
    (RegisteredWallet & MessageSignWallet) | null
  >(null);
  const [messageAccounts, setMessageAccounts] = useState<
    readonly MessageWalletAccount[]
  >([]);
  const [messageRequest, setMessageRequest] = useState<{
    account: MessageWalletAccount;
    challenge: WalletChallenge;
  } | null>(null);
  const challenge = useRef<WalletChallenge | null>(null);
  const requestId = useRef(0);
  const signing = useRef(false);

  useEffect(() => {
    const generation = requestId;
    const registry = getWallets();
    const update = () => setWallets(registry.get().filter(supportsSignIn));
    update();
    const offRegister = registry.on("register", update);
    const offUnregister = registry.on("unregister", update);
    return () => {
      offRegister();
      offUnregister();
      generation.current++;
    };
  }, []);

  async function prepare() {
    const id = ++requestId.current;
    challenge.current = null;
    setReady(false);
    setError("");
    setMessageOption(null);
    setMessageAccounts([]);
    setMessageRequest(null);
    setPreparing(true);
    try {
      const result = await identityRequest<WalletChallenge>(
        "/identity/challenge",
        {
          provider: "solana",
          purpose,
        },
      );
      if (id !== requestId.current) return;
      if (!result.input) throw new Error("Wallet verification is unavailable.");
      challenge.current = result;
      setReady(true);
    } catch {
      if (id === requestId.current)
        setError(
          "Could not prepare secure sign-in. Try preparing a new request.",
        );
    } finally {
      if (id === requestId.current) setPreparing(false);
    }
  }

  function changeOpen(value: boolean) {
    // Do not start a second signature flow while the wallet is still open.
    if (signing.current) return;
    setOpen(value);
    if (value) void prepare();
    else {
      requestId.current++;
      challenge.current = null;
      setReady(false);
      setPreparing(false);
      setError("");
      setMessageOption(null);
      setMessageAccounts([]);
      setMessageRequest(null);
    }
  }

  async function choose(wallet: RegisteredWallet & SignInWallet) {
    const current = challenge.current;
    if (!current || signing.current) return;
    signing.current = true;
    challenge.current = null;
    setReady(false);
    setSelected(wallet.name);
    setError("");
    onBusyChange(true);
    let phase: "wallet" | "verification" | "session" = "wallet";
    try {
      const proof = await requestWalletProof(wallet, current, window.location);
      phase = "verification";
      await identityRequest("/sign-in/solana", proof);
      phase = "session";
      const session = await identityClient.getSession();
      if (session.error || !session.data?.user?.id)
        throw new Error("Session was not confirmed.");
      setOpen(false);
      onComplete();
    } catch (reason) {
      setError(
        phase === "wallet"
          ? walletFailureMessage(reason, wallet.name)
          : phase === "verification"
            ? "The server could not verify this sign-in. No accounts were merged. Prepare a new request."
            : "Wallet approval succeeded, but the session could not be confirmed. Refresh the page before retrying.",
      );
      if (
        phase === "wallet" &&
        isInternalWalletError(reason) &&
        supportsMessageSigning(wallet)
      )
        setMessageOption(wallet);
    } finally {
      signing.current = false;
      setSelected("");
      onBusyChange(false);
    }
  }

  async function prepareMessage(account: MessageWalletAccount) {
    // This runs after connection, not as part of the signature click. Never
    // reuse the failed SIWS challenge, even if no server proof was accepted.
    const fresh = await identityRequest<WalletChallenge>(
      "/identity/challenge",
      { provider: "solana", purpose },
    );
    if (!fresh.input) throw new Error("No wallet challenge was returned.");
    setMessageAccounts([]);
    setMessageRequest({ account, challenge: fresh });
  }

  async function connectForMessage(account?: MessageWalletAccount) {
    const wallet = messageOption;
    if (!wallet || signing.current) return;
    signing.current = true;
    onBusyChange(true);
    setSelected(wallet.name);
    setError("");
    try {
      const accounts = account ? [account] : await connectMessageWallet(wallet);
      if (accounts.length === 1) await prepareMessage(accounts[0]);
      else setMessageAccounts(accounts);
    } catch (reason) {
      setError(walletFailureMessage(reason, wallet.name, "connect"));
      setMessageAccounts([]);
      setMessageRequest(null);
    } finally {
      signing.current = false;
      setSelected("");
      onBusyChange(false);
    }
  }

  async function signConnectedMessage() {
    const wallet = messageOption;
    const request = messageRequest;
    if (!wallet || !request || signing.current) return;
    signing.current = true;
    setMessageRequest(null); // one explicit signature attempt per prepared request
    setSelected(wallet.name);
    setError("");
    onBusyChange(true);
    let phase: "wallet" | "verification" | "session" = "wallet";
    try {
      const proof = await requestMessageProof(
        wallet,
        request.account,
        request.challenge,
        window.location,
      );
      phase = "verification";
      await identityRequest("/sign-in/solana", proof);
      phase = "session";
      const session = await identityClient.getSession();
      if (session.error || !session.data?.user?.id)
        throw new Error("Session was not confirmed.");
      setOpen(false);
      onComplete();
    } catch (reason) {
      setError(
        phase === "wallet"
          ? walletFailureMessage(reason, wallet.name, "signMessage")
          : phase === "verification"
            ? "The server could not verify this sign-in. No accounts were merged. Prepare a new request."
            : "Wallet approval succeeded, but the session could not be confirmed. Refresh the page before retrying.",
      );
      setMessageOption(null);
    } finally {
      signing.current = false;
      setSelected("");
      onBusyChange(false);
    }
  }

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
            Choose your Solana wallet, then approve the sign-in message. No
            transaction, fees or spending access.
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex flex-col gap-3"
          aria-busy={preparing || Boolean(selected)}
        >
          {wallets.map((wallet, index) => (
            <Button
              key={`${wallet.name}-${index}`}
              type="button"
              variant="outline"
              size="lg"
              className="h-14 justify-between gap-3 px-4"
              disabled={!ready || Boolean(selected)}
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
              {selected === wallet.name ? (
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
            {preparing
              ? "Preparing secure sign-in…"
              : selected
                ? `Approve the request in ${selected}.`
                : messageRequest
                  ? "Wallet connected. Sign the message below to finish."
                  : messageAccounts.length
                    ? "Choose the Solana account you want to sign in with."
                    : ready
                      ? "Ready to connect. Your wallet stays in control."
                      : "Prepare a fresh request to try again."}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {messageOption &&
            !selected &&
            !messageRequest &&
            !messageAccounts.length && (
              <Button type="button" onClick={() => void connectForMessage()}>
                Connect {messageOption.name} for message sign-in
              </Button>
            )}
          {!selected &&
            messageAccounts.map((account) => (
              <Button
                key={account.address}
                type="button"
                variant="outline"
                onClick={() => void connectForMessage(account)}
              >
                Use {account.address.slice(0, 6)}…{account.address.slice(-4)}
              </Button>
            ))}
          {messageRequest && !selected && (
            <>
              <p className="text-sm text-muted-foreground">
                Account: {messageRequest.account.address.slice(0, 6)}…
                {messageRequest.account.address.slice(-4)}. Sign-in message
                only.
              </p>
              <Button type="button" onClick={() => void signConnectedMessage()}>
                Sign in with {messageOption?.name}
              </Button>
            </>
          )}
          {!ready && !preparing && !selected && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void prepare()}
            >
              Prepare new request
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
