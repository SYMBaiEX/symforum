// Real UI, provider, SDK discovery and account-feature inspection; fake wallets only.
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { getWallets } from "@wallet-standard/app";
import { useWallets } from "@solana/kit-plugin-wallet/react";
import { WalletSignIn } from "../../../components/auth/wallet-signin";
import { CommerceWalletButton } from "../../../components/swap/commerce-wallet";
import { TokenSwap } from "../../../components/swap/token-swap";
import {
  SolanaWalletProvider,
  useSessionWalletClient,
} from "../../../components/auth/solana-wallet-provider";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { SYMF_TOKEN } from "../../../lib/symf-token";
import { calls, parameters } from "./wallet-capability-guidance-state";

type FixtureWallet = Parameters<ReturnType<typeof getWallets>["register"]>[0];
const kinds = {
  message: ["solana:signMessage"],
  siws: ["solana:signIn"],
  sign: ["solana:signTransaction"],
  send: ["solana:signAndSendTransaction"],
  transaction: ["solana:signTransaction", "solana:signAndSendTransaction"],
  hidden: [],
  noconnect: ["solana:signMessage"],
} as const;
const registrations: (() => void)[] = [];
for (const [kind, features] of Object.entries(kinds)) {
  if (parameters.has("only") && parameters.get("only") !== kind) continue;
  const account = {
    address: "11111111111111111111111111111111",
    publicKey: new Uint8Array(32),
    chains: ["solana:mainnet"],
    features: parameters.has("accountmissing")
      ? ["solana:signMessage"]
      : [...features],
  };
  const deny = async () => {
    calls.push(`DENIED:${kind}:sign`);
    throw new Error("Fixture signing denied");
  };
  const exposed =
    parameters.has("connected") && parameters.get("select") === kind;
  const wallet = {
    version: "1.0.0",
    name: `Fixture ${kind}`,
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
    chains: ["solana:mainnet"],
    accounts: exposed ? [account] : [],
    features: {
      "standard:events": { version: "1.0.0", on: () => () => {} },
      ...(kind === "noconnect"
        ? {}
        : {
            "standard:connect": {
              version: "1.0.0",
              connect: async () => {
                calls.push(
                  `connect:${kind}:${navigator.userActivation.isActive}`,
                );
                // No exposed account: selection must not trigger a challenge/sign.
                if (parameters.has("deferconnect"))
                  await new Promise<void>((resolve) => {
                    window.addEventListener(
                      "capability-fixture:release",
                      () => resolve(),
                      { once: true },
                    );
                  });
                return { accounts: [] };
              },
            },
          }),
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          calls.push("disconnect");
        },
      },
      ...Object.fromEntries(
        features.map((feature) => [
          feature,
          {
            version: "1.0.0",
            supportedTransactionVersions: parameters.has("versionmismatch")
              ? ["legacy"]
              : [0, 1],
            signMessage: deny,
            signIn: deny,
            signTransaction: deny,
            signAndSendTransaction: deny,
          },
        ]),
      ),
    },
  } as FixtureWallet;
  registrations.push(getWallets().register(wallet));
}

function InitialSelection() {
  const client = useSessionWalletClient();
  return client ? <SelectExposed client={client} /> : null;
}
function SelectExposed({
  client,
}: {
  client: NonNullable<ReturnType<typeof useSessionWalletClient>>;
}) {
  const wallets = useWallets(client);
  const selected = useRef(false);
  useEffect(() => {
    if (!parameters.has("connected") || selected.current) return;
    const account = wallets.find(
      (wallet) => wallet.name === `Fixture ${parameters.get("select")}`,
    )?.accounts[0];
    if (account) {
      selected.current = true;
      client.wallet.selectAccount(account);
    }
  }, [client, wallets]);
  return null;
}
const root = createRoot(document.getElementById("root")!);
window.addEventListener(
  "capability-fixture:unmount",
  () => {
    root.unmount();
    registrations.forEach((unregister) => unregister());
  },
  { once: true },
);
root.render(
  <SurfaceScope.Provider value="forum">
    <SolanaWalletProvider>
      <InitialSelection />
      <main
        data-surface="forum"
        className="forum-app-shell forum-surface bg-background text-foreground p-4"
      >
        {parameters.has("signin") ? (
          <WalletSignIn
            purpose="login"
            disabled={parameters.has("disabled")}
            onBusyChange={() => {}}
            onComplete={() => {
              throw new Error("Identity completion denied");
            }}
          />
        ) : parameters.has("swap") ? (
          <TokenSwap
            outputToken={{
              mint: SYMF_TOKEN.mint,
              symbol: "SYMF",
              name: "Invented fixture token",
              decimals: 6,
              tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            }}
          />
        ) : (
          <CommerceWalletButton
            requiredFeature={
              parameters.has("sendlane")
                ? "solana:signAndSendTransaction"
                : "solana:signTransaction"
            }
          />
        )}
      </main>
    </SolanaWalletProvider>
  </SurfaceScope.Provider>,
);
