// Inert quote promises only. No RPC, signer, prepare, submit or payment client.
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
import type { TradeToken } from "../../../components/swap/token-swap";
export * from "../../../lib/commerce-wallet-client";
export const sol = "So11111111111111111111111111111111111111112",
  usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  other = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1V";
export const wallet = "11111111111111111111111111111111";
const program = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const tokens: TradeToken[] = [
  {
    mint: sol,
    symbol: "SOL",
    name: "Invented SOL",
    decimals: 9,
    tokenProgram: program,
  },
  {
    mint: usdc,
    symbol: "USDC",
    name: "Invented USDC",
    decimals: 6,
    tokenProgram: program,
  },
  {
    mint: other,
    symbol: "OTHER",
    name: "Invented other token",
    decimals: 6,
    tokenProgram: program,
  },
];
const mode = new URLSearchParams(location.search).get("mode");
const held = [
  {
    quoteId: "inert-held",
    wallet,
    status: "held",
    signature: null,
    inputMint: sol,
    outputMint: usdc,
    createdAt: Date.parse("2026-10-31T13:00:00Z"),
    recovery: { state: "review" },
  },
];
const calls: { name: string; args: Record<string, unknown> }[] = [],
  blocked: string[] = [],
  queries: string[] = [];
const pending = new Map<
  number,
  { resolve(value: unknown): void; reject(error: Error): void }
>();
let accountIdentity = "inert-pair-reader";
const listeners = new Set<() => void>();
export const state = {
  calls,
  blocked,
  queries,
  setIdentity(value: string) {
    accountIdentity = value;
    listeners.forEach((listener) => listener());
  },
  settle(
    index: number,
    success: boolean,
    marker = 7,
    feeBps = 50,
    rawFee = "5000000",
    rawOutput?: string,
  ) {
    const callback = pending.get(index);
    if (!callback) throw new Error("Unknown inert quote");
    pending.delete(index);
    if (!success) {
      callback.reject(new Error("PRIVATE_STALE_QUOTE_ERROR"));
      return;
    }
    const args = calls[index].args,
      output = tokens.find((token) => token.mint === args.outputMint)!;
    callback.resolve({
      platformFeeBps: feeBps,
      failures: [],
      quotes: [
        {
          quoteId: `inert-quote-${index}`,
          execution: "jupiter-managed",
          provider: "jupiter",
          inputMint:
            mode === "mismatched-pair" && index > 0 ? usdc : args.inputMint,
          outputMint: args.outputMint,
          amountRaw:
            mode === "mismatched-amount" && index > 0 ? "1" : args.amountRaw,
          swapAmountRaw: args.amountRaw,
          platformFeeRaw: rawFee,
          outputAmountRaw: rawOutput ?? String(marker * 10 ** output.decimals),
          minimumOutputAmountRaw: String((marker - 1) * 10 ** output.decimals),
          priceImpactBps: 1,
          platformFeeBps: feeBps,
          routeLabels: [`Inert route ${marker}`],
          expiresAt: Date.now() + 25000,
          fees: {
            feeMint: args.outputMint,
            totalFeeBps: feeBps,
            integratorFeeBps: feeBps * 0.8,
            jupiterFeeBps: feeBps * 0.2,
          },
        },
      ],
    });
  },
};
Object.assign(window, { __swapQuoteConsent: state });
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  if (args === "skip") return undefined;
  const name = getFunctionName(ref);
  if (!queries.includes(name)) queries.push(name);
  if (name === "forumCommerce:getConfig")
    return {
      swapsEnabled: true,
      signatureFirstEnabled: true,
      managedEnabled: true,
      platformFeeBps: 50,
    };
  if (name === "forumCommerce:searchTokens") return tokens;
  if (name === "forumSwaps:listMine") return mode === "held" ? held : [];
  throw new Error(`Forbidden fixture query ${name}`);
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(
    (args: Record<string, unknown>) => {
      if (name !== "forumSwaps:quote") {
        blocked.push(name);
        throw new Error(`Forbidden fixture action ${name}`);
      }
      const index = calls.push({ name, args }) - 1;
      return new Promise((resolve, reject) =>
        pending.set(index, { resolve, reject }),
      );
    },
    [name],
  );
}
export function useMutation(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    blocked.push(name);
    throw new Error(`Forbidden fixture mutation ${name}`);
  }, [name]);
}
const client = {
  wallet: {
    getState: () => ({
      connected: mode === "guest" ? null : { account: { address: wallet } },
    }),
  },
} as unknown as CommerceWalletClient;
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  const authUserId = useSyncExternalStore(
    useCallback((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }, []),
    () => accountIdentity,
  );
  return {
    isAuthenticated: mode !== "guest",
    isLoading: false,
    linked: mode !== "guest" && mode !== "unlinked",
    connected: mode === "guest" ? null : { account: { address: wallet } },
    session: { authUserId },
  };
}
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function CommerceWalletButton() {
  return (
    <button
      type="button"
      onClick={() => {
        blocked.push("wallet-connect");
        throw new Error("Wallet connection forbidden");
      }}
    >
      Fixture wallet · no signer
    </button>
  );
}
export function supportsCommerceTransaction(
  _client: CommerceWalletClient,
  version: 0 | 1,
) {
  return version === 0;
}
export async function requestReviewedTransaction() {
  blocked.push("wallet-request");
  throw new Error("Wallet requests forbidden");
}
export async function signReviewedSwap() {
  blocked.push("sign");
  throw new Error("Signing forbidden");
}
export async function verifyPreparedTransaction() {
  blocked.push("verify-preparation");
  throw new Error("Preparation forbidden");
}
export function usePathname() {
  return "/trade";
}
