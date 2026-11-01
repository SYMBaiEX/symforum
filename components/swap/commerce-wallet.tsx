"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import {
  useConnect,
  useConnectedWallet,
  useWallets,
  useWalletStatus,
} from "@solana/kit-plugin-wallet/react";
import { Wallet, ChevronRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WalletSignIn } from "@/components/auth/wallet-signin";
import {
  SolanaWalletBoundary,
  useSessionWalletClient,
} from "@/components/auth/solana-wallet-provider";
import type { CommerceWalletClient } from "@/lib/commerce-wallet-client";

export type CommerceWalletFeature =
  "solana:signTransaction" | "solana:signAndSendTransaction";

export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return <SolanaWalletBoundary>{children}</SolanaWalletBoundary>;
}
export function useCommerceWallet() {
  return useSessionWalletClient() ?? null;
}

export function useCommerceIdentity(
  client: CommerceWalletClient,
  requiredFeature: CommerceWalletFeature = "solana:signAndSendTransaction",
) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const session = useQuery(
    api.forumCommerce.getWalletSession,
    isAuthenticated ? {} : "skip",
  );
  const connected = useConnectedWallet(client);
  const wallets = useWallets(client);
  const status = useWalletStatus(client);
  const restoredFor = useRef<string | null>(null);
  // Restore only a uniquely exposed, already authorized AND server-linked account.
  // Never connect/sign silently or trust a persisted browser address as proof.
  useEffect(() => {
    if (!session) return;
    if (connected) {
      restoredFor.current = session.authUserId;
      return;
    }
    if (restoredFor.current === session.authUserId || status !== "disconnected")
      return;
    const matches = wallets
      .flatMap((w) => w.accounts)
      .filter(
        (a) =>
          session.wallets.includes(a.address) &&
          a.chains.includes("solana:mainnet") &&
          a.features.includes(requiredFeature),
      );
    if (matches.length === 1) {
      restoredFor.current = session.authUserId;
      try {
        client.wallet.selectAccount(matches[0]);
      } catch {
        /* Explicit selection remains available. */
      }
    }
  }, [session, connected, wallets, client, status, requiredFeature]);
  const linked =
    !!connected && !!session?.wallets.includes(connected.account.address);
  return { isAuthenticated, isLoading, session, linked, connected };
}
export function CommerceWalletButton({
  disabled = false,
  requiredFeature = "solana:signAndSendTransaction",
}: {
  disabled?: boolean;
  requiredFeature?: CommerceWalletFeature;
}) {
  const client = useCommerceWallet();
  return client ? (
    <ConnectedButton
      client={client}
      disabled={disabled}
      requiredFeature={requiredFeature}
    />
  ) : (
    <Button
      disabled
      variant="outline"
      className="[&&]:!min-h-11 [&&]:!min-w-11"
    >
      <Wallet aria-hidden="true" />
      Loading wallet…
    </Button>
  );
}
function ConnectedButton({
  client,
  disabled,
  requiredFeature,
}: {
  client: CommerceWalletClient;
  disabled: boolean;
  requiredFeature: CommerceWalletFeature;
}) {
  const { isAuthenticated, isLoading, session, connected, linked } =
    useCommerceIdentity(client, requiredFeature);
  const detectedWallets = useWallets(client);
  const wallets = detectedWallets.filter((w) =>
    w.features.includes(requiredFeature),
  );
  const connect = useConnect(client);
  const [open, setOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  if (
    !isAuthenticated ||
    (session && (!session.wallets.length || (connected && !linked)))
  )
    return (
      <WalletSignIn
        purpose={isAuthenticated ? "link" : "login"}
        label={isAuthenticated ? "Link wallet to trade" : "Sign in with wallet"}
        disabled={disabled || isLoading || authBusy}
        onBusyChange={setAuthBusy}
        onComplete={() => {
          /* Session subscriptions refresh after the verified proof. */
        }}
      />
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!connect.isRunning) setOpen(v);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="[&&]:!min-h-11 [&&]:!min-w-11"
          disabled={disabled || !session}
        >
          <Wallet aria-hidden="true" />
          {linked && connected
            ? `${connected.account.address.slice(0, 4)}…${connected.account.address.slice(-4)}`
            : "Connect wallet"}
        </Button>
      </DialogTrigger>
      <DialogContent
        data-surface="forum"
        className="wallet-picker [&&>button:last-child]:!min-h-11 [&&>button:last-child]:!min-w-11"
        overlayClassName="wallet-picker-overlay"
      >
        <DialogHeader className="wallet-picker-header">
          <DialogTitle>Your linked wallet</DialogTitle>
          <DialogDescription>
            Use a wallet verified on your signed-in profile. Connecting does not
            approve a payment.
          </DialogDescription>
        </DialogHeader>
        <div className="wallet-picker-body">
          <div className="wallet-picker-options">
            {wallets.map((wallet) => (
              <Button
                className="wallet-picker-option"
                variant="ghost"
                key={wallet.name}
                disabled={connect.isRunning}
                onClick={() => {
                  void connect
                    .dispatchAsync(wallet)
                    .then(() => setOpen(false))
                    .catch(() => {});
                }}
              >
                <span className="wallet-picker-identity">
                  <Wallet aria-hidden="true" />
                  <span className="wallet-picker-name">{wallet.name}</span>
                </span>
                <ChevronRight aria-hidden="true" />
              </Button>
            ))}
          </div>
          {!wallets.length && (
            <p className="wallet-picker-empty">
              No exposed wallet advertises the capability required here. Open
              this page in a Wallet Standard compatible Solana browser. The
              wallet must expose {requiredFeature}; compatibility cannot be
              inferred from sign-in alone. This does not tell us whether another
              wallet is installed or locked.
            </p>
          )}
          {detectedWallets.length > wallets.length && (
            <p className="wallet-picker-empty">
              {detectedWallets.length - wallets.length} detected{" "}
              {detectedWallets.length - wallets.length === 1
                ? "wallet does"
                : "wallets do"}{" "}
              not expose{" "}
              {requiredFeature === "solana:signTransaction"
                ? "transaction signing (solana:signTransaction)"
                : "transaction signing and sending (solana:signAndSendTransaction)"}
              . Signing in alone does not enable payments.{" "}
              {wallets.length
                ? "Select a compatible linked wallet above."
                : "Make a compatible linked wallet available, then select it."}{" "}
              Connecting does not approve a payment.
            </p>
          )}
          {connected &&
            !connected.account.features.includes(requiredFeature) && (
              <p className="wallet-picker-empty">
                The connected account does not expose {requiredFeature}. Choose
                another compatible linked wallet above. Wallet-level support
                does not guarantee support for every account or transaction
                format.
              </p>
            )}
          {Boolean(connect.error) && (
            <p role="alert">
              The wallet could not connect. Check its open requests.
            </p>
          )}
          {connected && (
            <>
              <code className="commerce-mint">{connected.account.address}</code>
              <Button
                variant="ghost"
                className="[&&]:!min-h-11 [&&]:!min-w-11"
                disabled={connect.isRunning}
                onClick={() => {
                  void client.wallet.disconnect().then(() => setOpen(false));
                }}
              >
                Disconnect wallet
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
