import { useCallback, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
import type { TradeToken } from "../../../components/swap/token-swap";
export * from "../../../lib/commerce-wallet-client";

const flags = new URLSearchParams(location.search);
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const tokens: TradeToken[] = [
  {
    mint: SOL,
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    tokenProgram: "fixture",
  },
  {
    mint: USDC,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    tokenProgram: "fixture",
  },
];
const operations: { name: string; args: Record<string, unknown> }[] = [];
Object.assign(window, { swapGuidanceOperations: operations });
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  if (args === "skip") return undefined;
  const name = getFunctionName(ref);
  if (name === "forumCommerce:getConfig")
    return {
      swapsEnabled: true,
      signatureFirstEnabled: true,
      managedEnabled: true,
      platformFeeBps: 50,
    };
  if (name === "forumCommerce:searchTokens")
    return flags.has("missing") ? [] : tokens;
  if (name === "forumSwaps:listMine") return [];
  throw new Error(`Unexpected guidance query: ${name}`);
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(
    async (args: Record<string, unknown>) => {
      operations.push({ name, args });
      if (name !== "forumSwaps:quote")
        throw new Error(`Forbidden guidance operation: ${name}`);
      return {
        platformFeeBps: 50,
        failures: [],
        quotes: [
          {
            quoteId: "inert-guidance-quote",
            execution: "jupiter-managed",
            provider: "jupiter",
            inputMint: args.inputMint,
            outputMint: args.outputMint,
            amountRaw: args.amountRaw,
            swapAmountRaw: "995000000",
            platformFeeRaw: "5000000",
            outputAmountRaw: "1000000",
            minimumOutputAmountRaw: "995000",
            priceImpactBps: 1,
            platformFeeBps: 50,
            routeLabels: ["Invented fixture pool"],
            expiresAt: Date.now() + 25000,
            fees: {
              feeMint: flags.has("unknown-fee")
                ? "11111111111111111111111111111111"
                : USDC,
              totalFeeBps: 50,
              integratorFeeBps: 40,
              jupiterFeeBps: 10,
            },
          },
        ],
      };
    },
    [name],
  );
}
export function useMutation(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    operations.push({ name, args: {} });
    throw new Error(`Forbidden guidance mutation: ${name}`);
  }, [name]);
}
// No signer, wallet request method, transport or provider is implemented.
const client = {
  wallet: {
    getState: () => ({
      connected: { account: { address: "11111111111111111111111111111111" } },
    }),
  },
} as unknown as CommerceWalletClient;
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  return {
    isAuthenticated: true,
    isLoading: false,
    linked: true,
    connected: { account: { address: "11111111111111111111111111111111" } },
    session: { authUserId: "invented-guidance-owner" },
  };
}
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function CommerceWalletButton() {
  return <button type="button">Fixture wallet · no signer</button>;
}
export function supportsCommerceTransaction(
  _client: CommerceWalletClient,
  version: 0 | 1,
) {
  return version === 0;
}
export function TokenPicker({
  token,
  label,
  disabled,
  onSelect,
}: {
  token?: TradeToken;
  label: string;
  disabled: boolean;
  onSelect(token: TradeToken): void;
}) {
  return (
    <select
      aria-label={label}
      value={token?.mint ?? ""}
      disabled={disabled}
      onChange={(event) => {
        const next = tokens.find((item) => item.mint === event.target.value);
        if (next) onSelect(next);
      }}
    >
      <option value="">Choose token</option>
      {tokens.map((item) => (
        <option key={item.mint} value={item.mint}>
          {item.symbol}
        </option>
      ))}
    </select>
  );
}
