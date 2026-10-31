// Isolated UI harness. Fake wallets/proofs; every network request is intercepted.
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { getWallets } from "@wallet-standard/app";
import { getAddressDecoder } from "@solana/kit";
import { IdentityProviders } from "../../../components/auth/identity-providers";
import type { MessageWalletAccount } from "../../../lib/wallet-signin";
import { identityClient } from "../../../packages/auth/src/identity-client";
import { IdentityBootstrap } from "../../../packages/auth/src/identity-bootstrap";
import {
  getWalletDiagnostics,
  subscribeWalletDiagnostics,
} from "../../../lib/wallet-diagnostics";
type FixtureAccount = ReturnType<
  ReturnType<typeof getWallets>["get"]
>[number]["accounts"][number];

Object.defineProperty(window, "ethereum", {
  get() {
    throw new Error("Solana sign-in must not access Ethereum");
  },
});
const events: unknown[] = [];
function record(value: unknown) {
  events.push(value);
  document.getElementById("wallet-events")!.textContent =
    JSON.stringify(events);
}
function register() {
  const params = new URLSearchParams(window.location.search);
  const account: FixtureAccount = {
    address: "11111111111111111111111111111111",
    publicKey: params.has("badkey")
      ? new Uint8Array(32).fill(1)
      : new Uint8Array(32),
    chains: params.has("devnet") ? ["solana:devnet"] : ["solana:mainnet"],
    features: ["solana:signMessage"],
  };
  let connected: readonly FixtureAccount[] = params.has("preconnected")
    ? [account]
    : [];
  const listeners = new Set<
    (event: { accounts: readonly FixtureAccount[] }) => void
  >();
  const secondAccount: FixtureAccount = {
    ...account,
    publicKey: new Uint8Array(32).fill(1),
    address: getAddressDecoder().decode(new Uint8Array(32).fill(1)),
  };
  return getWallets().register({
    version: "1.0.0",
    name: "Phantom",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOCIgaGVpZ2h0PSIyOCIvPg==",
    chains: params.has("devnet") ? ["solana:devnet"] : ["solana:mainnet"],
    get accounts() {
      return connected;
    },
    features: {
      "standard:events": {
        version: "1.0.0",
        on: (
          _event: string,
          listener: (event: { accounts: readonly FixtureAccount[] }) => void,
        ) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          record({
            action: "connect",
            userActivated: navigator.userActivation.isActive,
          });
          if (params.has("connectinternal"))
            throw Object.assign(new Error("Unexpected error"), {
              code: -32603,
            });
          if (params.has("connectcancel")) throw { code: 4001 };
          if (params.has("deferconnect"))
            await new Promise<void>((resolve) => {
              window.addEventListener(
                "wallet-fixture:connect",
                () => resolve(),
                { once: true },
              );
            });
          connected = params.has("multi")
            ? [account, secondAccount]
            : [account];
          for (const listener of listeners) listener({ accounts: connected });
          return { accounts: connected };
        },
      },
      ...(!params.has("siwsonly")
        ? {
            "solana:signMessage": {
              version: "1.0.0",
              signMessage: async ({
                message,
                account: selectedAccount,
              }: {
                message: Uint8Array;
                account: MessageWalletAccount;
              }) => {
                record({
                  action: "signMessage",
                  userActivated: navigator.userActivation.isActive,
                  account: selectedAccount.address,
                });
                if (params.has("messagecancel")) throw { code: 4001 };
                if (!connected.includes(selectedAccount as FixtureAccount))
                  throw new Error(
                    "SDK must pass the wallet's raw account reference",
                  );
                if (params.has("accountchange")) {
                  connected = [secondAccount];
                  for (const listener of listeners)
                    listener({ accounts: connected });
                }
                if (params.has("changedmessage"))
                  return [
                    {
                      signedMessage: new Uint8Array([1]),
                      signature: new Uint8Array(64),
                    },
                  ];
                return [
                  { signedMessage: message, signature: new Uint8Array(64) },
                ];
              },
            },
          }
        : {}),
      ...(!params.has("messageonly")
        ? {
            "solana:signIn": {
              version: "1.0.0",
              signIn: async (input: unknown) => {
                record({
                  action: "signIn",
                  userActivated: navigator.userActivation.isActive,
                  input,
                });
                if (params.has("internal"))
                  throw Object.assign(new Error("Unexpected error"), {
                    code: -32603,
                  });
                if (params.has("cancel")) throw { code: 4001 };
                connected = [account];
                for (const listener of listeners)
                  listener({ accounts: connected });
                return [
                  {
                    account: {
                      address: "11111111111111111111111111111111",
                      publicKey: new Uint8Array(32),
                    },
                    signedMessage: new Uint8Array([1, 2, 3]),
                    signature: new Uint8Array(64),
                  },
                ];
              },
            },
          }
        : {}),
    },
  });
}
window.addEventListener("wallet-fixture:register", register);
if (!window.location.search.includes("empty")) register();
function Fixture() {
  const [done, setDone] = useState(false);
  const diagnostics = useSyncExternalStore(
    subscribeWalletDiagnostics,
    getWalletDiagnostics,
  );
  const session = identityClient.useSession();
  return (
    <>
      <IdentityBootstrap>
        <IdentityProviders
          purpose={
            new URLSearchParams(window.location.search).has("link")
              ? "link"
              : "login"
          }
          onComplete={() => setDone(true)}
        />
      </IdentityBootstrap>
      <output aria-label="Session state">
        {session.isPending
          ? "pending"
          : session.data?.user.id
            ? "authenticated"
            : "guest"}
      </output>
      <output id="wallet-events" aria-label="Wallet events">
        []
      </output>
      <output aria-label="Wallet diagnostics">
        {JSON.stringify(diagnostics)}
      </output>
      {done && <p>Signed in successfully</p>}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
