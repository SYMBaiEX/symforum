// Fake wallet: signatures below are inert fixtures and never leave this harness.
import { createRoot } from "react-dom/client";
import { getWallets } from "@wallet-standard/app";
import { address, getAddressEncoder } from "@solana/kit";
import { StandaloneSwap } from "../../../components/swap/token-swap";
import { ForumCommerceFrame } from "../../../components/swap/forum-commerce";
const wallet = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
const account = {
  address: wallet,
  publicKey: Uint8Array.from(getAddressEncoder().encode(address(wallet))),
  chains: ["solana:mainnet"] as const,
  features: ["solana:signAndSendTransaction"] as const,
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
        options: { skipPreflight: boolean; maxRetries: number };
      }) => {
        calls++;
        document.getElementById("wallet-calls")!.textContent = String(calls);
        if (
          input.account !== account ||
          input.options.skipPreflight ||
          input.options.maxRetries !== 0
        )
          throw new Error("Wrong raw account or unsafe wallet options");
        if (location.search.includes("walletfail"))
          throw new Error("Mock ambiguous outcome");
        return [{ signature: new Uint8Array(64).fill(1) }];
      },
    },
  },
});
createRoot(document.getElementById("root")!).render(
  <div className="forum-app-shell">
    <div className="forum-surface">
      {location.search.includes("promotion") ? (
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
