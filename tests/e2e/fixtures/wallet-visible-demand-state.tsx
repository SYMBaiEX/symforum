// All reads are inert promises or invented public UI records. No signer exists.
import { useCallback } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import * as walletState from "./wallet-read-isolation-state";
import * as terminalState from "./terminal-convex";
const metadataReads: { mint: string }[] = [];
export const fixture = { ...walletState.fixture, metadataReads };
export {
  useConvexAuth,
  useCommerceIdentity,
  useCommerceWallet,
  CommerceWalletProvider,
  CommerceWalletButton,
  usePathname,
  useMutation,
} from "./wallet-read-isolation-state";
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  return terminalState.useQuery(ref, args as never);
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  const walletRead = walletState.useAction(ref);
  return useCallback(
    (args: { wallet: string; selectedMint?: string; mint?: string }) => {
      if (name === "forumTerminal:getWalletReadState") return walletRead(args);
      if (name === "forumTerminalRefresh:refresh")
        return Promise.resolve({
          state: "loading",
          checkedAt: null,
          nextRefreshAt: Date.now() + 600_000,
        });
      if (
        name === "forumCommerce:resolveMint" &&
        typeof args.mint === "string"
      ) {
        metadataReads.push({ mint: args.mint });
        return Promise.resolve({
          mint: args.mint,
          symbol: "FIXTURE",
          name: "Invented token",
          decimals: 6,
          tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        });
      }
      walletState.fixture.forbidden.push(name);
      throw Error(`Forbidden action ${name}`);
    },
    [name, walletRead],
  );
}
export * from "./wallet-read-isolation-state";
