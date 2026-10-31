import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import {
  useQuery as baseQuery,
  useConvexAuth as baseAuth,
} from "./terminal-convex";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
import { SYMF_TOKEN } from "../../../lib/symf-token";

export const walletA = "EULE1PmLm452j4sfNTn4HrzEWa957Zdf3tZCtmjoaTtF";
export const walletB = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
export const selectedMint = SYMF_TOKEN.mint;
const sol = "So11111111111111111111111111111111111111112";
let wallet = walletA,
  revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function useWalletSnapshot() {
  useSyncExternalStore(subscribe, () => revision);
  return wallet;
}
function publish() {
  revision++;
  listeners.forEach((listener) => listener());
}
const signatureA = "1".repeat(88),
  signatureB = "2".repeat(88);
const history = [
  {
    quoteId: "fixture-held",
    status: "held",
    signature: signatureA,
    inputMint: sol,
    outputMint: selectedMint,
    createdAt: 1793400000000,
  },
  {
    quoteId: "fixture-submitted",
    status: "submitted",
    signature: signatureB,
    inputMint: sol,
    outputMint: selectedMint,
    createdAt: 1793400000000,
  },
  {
    quoteId: "fixture-prepared",
    status: "prepared",
    signature: null,
    inputMint: sol,
    outputMint: selectedMint,
    createdAt: 1793390000000,
  },
  {
    quoteId: "fixture-failed",
    status: "failed",
    signature: null,
    inputMint: selectedMint,
    outputMint: sol,
    createdAt: 1793380000000,
  },
];
const reads: { name: string; args: unknown }[] = [];
const operations: string[] = [];
const copies: string[] = [];
let copyMode: "success" | "failure" | "deferred" = "success";
const pending: { resolve(): void; reject(): void }[] = [];
export const fixture = {
  reads,
  operations,
  copies,
  signatureA,
  signatureB,
  wallet() {
    return wallet;
  },
  switchWallet(next: string) {
    wallet = next;
    publish();
  },
  copyMode(mode: typeof copyMode) {
    copyMode = mode;
  },
  settleCopy(index: number, fail = false) {
    if (fail) pending[index].reject();
    else pending[index].resolve();
  },
  logout() {
    window.dispatchEvent(new Event("terminal-fixture:signout"));
  },
};
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText(value: string) {
      copies.push(value);
      if (copyMode === "failure")
        return Promise.reject(new Error("Invented clipboard denial"));
      if (copyMode === "deferred")
        return new Promise<void>((resolve, reject) =>
          pending.push({
            resolve,
            reject: () => reject(new Error("Invented delayed denial")),
          }),
        );
      return Promise.resolve();
    },
  },
});
declare global {
  interface Window {
    walletIdentityFixture: typeof fixture & { unmount(): void };
  }
}

export function useConvexAuth() {
  return baseAuth();
}
export function useQuery<Ref extends FunctionReference<"query">>(
  ref: Ref,
  args: FunctionArgs<Ref> | "skip",
): FunctionReturnType<Ref> | undefined {
  const result = baseQuery(ref, args);
  const name = getFunctionName(ref),
    key = JSON.stringify(args);
  useEffect(() => {
    if (key !== '"skip"') reads.push({ name, args: JSON.parse(key) });
  }, [name, key]);
  return name === "forumSwaps:listMine" && args !== "skip"
    ? (history as FunctionReturnType<Ref>)
    : result;
}
export function useAction<Ref extends FunctionReference<"action">>(ref: Ref) {
  const name = getFunctionName(ref);
  return useCallback(
    async (args: FunctionArgs<Ref>) => {
      if (
        name === "forumCommerce:resolveMint" &&
        (args as { mint: string }).mint === selectedMint
      ) {
        reads.push({ name, args });
        return {
          mint: selectedMint,
          symbol: "SYMF",
          name: "Invented fixture token",
          decimals: 6,
          tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        } as FunctionReturnType<Ref>;
      }
      if (name !== "forumTerminal:getWalletReadState") {
        operations.push(name);
        throw new Error("All provider, wallet and financial actions forbidden");
      }
      reads.push({ name, args });
      return {
        wallet: (args as { wallet: string }).wallet,
        checkedAt: 1793400000000,
        expiresAt: 1793400060000,
        slot: 1,
        balances: [{ mint: sol, rawAmount: "1000000000", decimals: 9 }],
        maxSolRaw: null,
        feeReserveLamports: null,
      } as FunctionReturnType<Ref>;
    },
    [name],
  );
}
export function useMutation<Ref extends FunctionReference<"mutation">>(
  ref: Ref,
) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    operations.push(name);
    throw new Error("All fixture mutations forbidden");
  }, [name]);
}
const client = {
  wallet: { getState: () => ({ connected: { account: { address: wallet } } }) },
} as unknown as CommerceWalletClient;
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function useCommerceWallet() {
  useWalletSnapshot();
  return client;
}
export function useCommerceIdentity() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const current = useWalletSnapshot(),
    linked = isAuthenticated && !isLoading;
  return {
    linked,
    connected: linked
      ? {
          account: { address: current },
          supportedTransactionVersions: new Set([0]),
        }
      : null,
    isAuthenticated,
    isLoading,
    session: { wallets: [], authUserId: "isolated-wallet-reader" },
  };
}
export function CommerceWalletButton() {
  return (
    <button
      type="button"
      onClick={() => {
        operations.push("wallet-connect");
        throw new Error("Wallet connection forbidden");
      }}
    >
      Fixture wallet connection unavailable
    </button>
  );
}
export function useFixtureWallet() {
  return useWalletSnapshot();
}
