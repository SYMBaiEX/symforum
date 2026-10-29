// Isolated UI harness. Fake wallets/proofs; every network request is intercepted.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { getWallets } from "@wallet-standard/app";
import { IdentityProviders } from "../../../components/auth/identity-providers";

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
  return getWallets().register({
    version: "1.0.0",
    name: "Phantom",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOCIgaGVpZ2h0PSIyOCIvPg==",
    chains: ["solana:mainnet"],
    accounts: [],
    features: {
      "solana:signIn": {
        version: "1.0.0",
        signIn: async (input: unknown) => {
          record({
            action: "signIn",
            userActivated: navigator.userActivation.isActive,
            input,
          });
          if (window.location.search.includes("cancel")) throw { code: 4001 };
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
    },
  });
}
window.addEventListener("wallet-fixture:register", register);
if (!window.location.search.includes("empty")) register();
function Fixture() {
  const [done, setDone] = useState(false);
  return (
    <>
      <IdentityProviders onComplete={() => setDone(true)} />
      <output id="wallet-events" aria-label="Wallet events">
        []
      </output>
      {done && <p>Signed in successfully</p>}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
