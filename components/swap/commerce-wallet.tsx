"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  useConnect,
  useConnectedWallet,
  useWallets,
  useWalletStatus,
} from "@solana/kit-plugin-wallet/react";
import { Wallet, ChevronRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createCommerceWalletClient,
  type CommerceWalletClient,
} from "@/lib/commerce-wallet-client";

const CommerceContext = createContext<CommerceWalletClient | null>(null);
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<CommerceWalletClient | null>(null);
  useEffect(() => {
    const owned = createCommerceWalletClient();
    setClient(owned);
    return () => owned[Symbol.dispose]();
  }, []);
  return (
    <CommerceContext.Provider value={client}>
      {children}
    </CommerceContext.Provider>
  );
}
export function useCommerceWallet() {
  return useContext(CommerceContext);
}

export function CommerceWalletButton({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const client = useCommerceWallet();
  return client ? (
    <ConnectedButton client={client} disabled={disabled} />
  ) : (
    <Button disabled variant="outline">
      <Wallet aria-hidden="true" />
      Connect wallet
    </Button>
  );
}
function ConnectedButton({
  client,
  disabled,
}: {
  client: CommerceWalletClient;
  disabled: boolean;
}) {
  const connected = useConnectedWallet(client),
    wallets = useWallets(client),
    status = useWalletStatus(client);
  const connect = useConnect(client);
  const [open, setOpen] = useState(false);
  const busy = connect.isRunning || status === "connecting";
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <Wallet aria-hidden="true" />
          {connected
            ? `${connected.account.address.slice(0, 4)}…${connected.account.address.slice(-4)}`
            : "Connect wallet"}
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
            {connected ? "Payment wallet" : "Connect a Solana wallet"}
          </DialogTitle>
          <DialogDescription>
            Connect a wallet linked in Account Connections. Connecting does not
            authorize a payment.
          </DialogDescription>
        </DialogHeader>
        <div className="wallet-picker-body">
          <div className="wallet-picker-options">
            {wallets.map((wallet) => (
              <Button
                className="wallet-picker-option"
                variant="ghost"
                key={wallet.name}
                disabled={busy}
                onClick={() => {
                  connect
                    .dispatchAsync(wallet)
                    .then(() => setOpen(false))
                    .catch(() => {});
                }}
              >
                <span className="wallet-picker-identity">
                  <span className="wallet-picker-icon">
                    <Wallet aria-hidden="true" />
                  </span>
                  <span className="wallet-picker-name">{wallet.name}</span>
                </span>
                {busy ? (
                  <LoaderCircle
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight aria-hidden="true" />
                )}
              </Button>
            ))}
          </div>
          {!wallets.length && (
            <p className="wallet-picker-empty">
              Open this page in a Solana wallet browser, or install a Wallet
              Standard compatible wallet.
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
                onClick={() => {
                  void client.wallet.disconnect().then(() => setOpen(false));
                }}
                disabled={busy}
              >
                Disconnect payment wallet
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
