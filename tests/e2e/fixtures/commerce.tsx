// Fake wallet: signatures below are inert fixtures and never leave this harness.
import { createRoot } from "react-dom/client";
import { getWallets } from "@wallet-standard/app";
import { address, getAddressEncoder, getBase64Encoder } from "@solana/kit";
import { StandaloneSwap } from "../../../components/swap/token-swap";
import { ForumCommerceFrame } from "../../../components/swap/forum-commerce";
import { ForumSymf } from "../../../components/forum/forum-symf";
declare global {
  interface Window {
    __commerceFixtureWallet?: string;
  }
}
const wallet =
  window.__commerceFixtureWallet ??
  "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
const account = {
  address: wallet,
  publicKey: Uint8Array.from(getAddressEncoder().encode(address(wallet))),
  chains: ["solana:mainnet"] as const,
  features: [
    "solana:signAndSendTransaction",
    "solana:signTransaction",
  ] as const,
};
let connected: readonly (typeof account)[] = location.search.includes(
  "authorized",
)
  ? [account]
  : [];
const listeners = new Set<
  (value: { accounts: readonly (typeof account)[] }) => void
>();
let calls = 0;
Object.defineProperty(window, "ethereum", {
  get() {
    throw new Error("Commerce must never read Ethereum");
  },
});
getWallets().register({
  version: "1.0.0",
  name: "Test Solana Wallet",
  icon: "data:image/svg+xml;base64,PHN2Zy8+",
  chains: ["solana:mainnet"],
  get accounts() {
    return connected;
  },
  features: {
    "solana:signTransaction": {
      version: "1.0.0",
      supportedTransactionVersions: [0],
      signTransaction: async (input: {
        account: typeof account;
        transaction: Uint8Array;
      }) => {
        calls++;
        document.getElementById("wallet-calls")!.textContent = String(calls);
        if (input.account !== account) throw Error("Wrong raw wallet account");
        if (location.search.includes("signfail"))
          throw Object.assign(Error("private signing failure"), {
            code: -32603,
          });
        const response = await fetch("/__commerce/wallet:sign", {
          method: "POST",
          body: JSON.stringify({ bytes: Array.from(input.transaction) }),
        });
        const result = await response.json();
        if (location.search.includes("hideaftersign"))
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "hidden",
          });
        return [
          {
            signedTransaction: Uint8Array.from(
              getBase64Encoder().encode(result.wire),
            ),
          },
        ];
      },
    },
    "standard:events": {
      version: "1.0.0",
      on: (
        _e: string,
        cb: typeof listeners extends Set<infer T> ? T : never,
      ) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    "standard:connect": {
      version: "1.0.0",
      connect: async () => {
        connected = [account];
        listeners.forEach((fn) => fn({ accounts: connected }));
        return { accounts: connected };
      },
    },
    "solana:signAndSendTransaction": {
      version: "1.0.0",
      supportedTransactionVersions: [0],
      signAndSendTransaction: async (input: {
        account: typeof account;
        transaction: Uint8Array;
        options: {
          skipPreflight: boolean;
          maxRetries: number;
          preflightCommitment: string;
          minContextSlot: number;
        };
      }) => {
        calls++;
        document.getElementById("wallet-calls")!.textContent = String(calls);
        if (
          input.account !== account ||
          input.options.skipPreflight ||
          input.options.maxRetries !== 0 ||
          input.options.preflightCommitment !== "confirmed" ||
          input.options.minContextSlot !== 1
        )
          throw new Error("Wrong raw account or unsafe wallet options");
        if (location.search.includes("walletfail"))
          throw new Error("Mock ambiguous outcome");
        if (location.search.includes("walletinternal"))
          throw Object.assign(new Error("private wallet provider body"), {
            code: -32603,
          });
        return [{ signature: new Uint8Array(64).fill(1) }];
      },
    },
  },
});
createRoot(document.getElementById("root")!).render(
  <div className="forum-app-shell">
    <div className="forum-surface">
      {location.search.includes("symf") ? (
        <ForumSymf />
      ) : location.search.includes("promotion") ? (
        <ForumCommerceFrame threadId="thread-fixture">
          <article>
            <h1>A public token post</h1>
            <p>Forum content remains readable beside checkout.</p>
          </article>
        </ForumCommerceFrame>
      ) : (
        <StandaloneSwap enabled />
      )}
    </div>
  </div>,
);
