// Inert quote promises only. No RPC, signer, prepare, submit or payment client.
import { useCallback, type ReactNode } from "react";
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
export const state = {
  calls,
  blocked,
  queries,
  settle(index: number, success: boolean, marker = 7) {
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
      platformFeeBps: 50,
      failures: [],
      quotes: [
        {
          quoteId: `inert-quote-${index}`,
          execution: "jupiter-managed",
          provider: "jupiter",
          inputMint: args.inputMint,
          outputMint: args.outputMint,
          amountRaw: args.amountRaw,
          swapAmountRaw: args.amountRaw,
          platformFeeRaw: "5000000",
          outputAmountRaw: String(marker * 10 ** output.decimals),
          minimumOutputAmountRaw: String((marker - 1) * 10 ** output.decimals),
          priceImpactBps: 1,
          platformFeeBps: 50,
          routeLabels: [`Inert route ${marker}`],
          expiresAt: Date.now() + 25000,
          fees: {
            feeMint: args.outputMint,
            totalFeeBps: 50,
            integratorFeeBps: 40,
            jupiterFeeBps: 10,
          },
        },
      ],
    });
  },
};
Object.assign(window, { __swapPairIsolation: state });
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
  return {
    isAuthenticated: mode !== "guest",
    isLoading: false,
    linked: mode !== "guest" && mode !== "unlinked",
    connected: mode === "guest" ? null : { account: { address: wallet } },
    session: { authUserId: "inert-pair-reader" },
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
