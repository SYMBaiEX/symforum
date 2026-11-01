// Invented owner-bound read deliveries only. No real transport or wallet exists.
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { useQuery as baseQuery } from "./terminal-convex";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
import { SYMF_TOKEN } from "../../../lib/symf-token";

export const ownerA = "invented-owner-a",
  ownerB = "invented-owner-b";
export const wallet = "11111111111111111111111111111111";
const listeners = new Set<() => void>();
let state = {
  owner: ownerA as string | null,
  auth: "signed-in",
  active: "receipts" as "wallet" | "receipts",
  mounted: true,
};
type Receipt = {
  quoteId: string;
  status: "held" | "submitted" | "confirmed" | "prepared";
  signature: string | null;
  inputMint: string;
  outputMint: string;
  createdAt: number;
};
export const held: Receipt = {
  quoteId: "invented-held-a",
  status: "held",
  signature: "1".repeat(88),
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: SYMF_TOKEN.mint,
  createdAt: 1793520000000,
};
type Delivery = { mode: "loaded" | "loading" | "failed"; rows: Receipt[] };
let next: Delivery = new URLSearchParams(location.search).has("initial-failure")
  ? { mode: "failed", rows: [] }
  : { mode: "loaded", rows: [held] };
const subscriptions: {
  owner: string | null;
  active: boolean;
  deliver(value: Delivery): void;
}[] = [];
const queries: { name: string; args: unknown; owner: string | null }[] = [];
const forbidden: string[] = [];
export const fixture = {
  subscriptions,
  queries,
  forbidden,
  change(patch: Partial<typeof state>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  },
  next(value: Delivery) {
    next = value;
  },
  deliver(index: number, value: Delivery) {
    if (!subscriptions[index]) throw new Error("Unknown invented read token");
    subscriptions[index].deliver(value);
  },
  latest() {
    return subscriptions.length - 1;
  },
};
export function useFixtureState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
}
export function useConvexAuth() {
  const current = useFixtureState();
  return {
    isAuthenticated: current.auth !== "guest",
    isLoading: current.auth === "loading",
  };
}
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  const name = getFunctionName(ref);
  const other = baseQuery(
    ref,
    name === "forumSwaps:listMine" ? "skip" : (args as never),
  );
  const current = useFixtureState();
  const initial = useRef({ name, args, owner: current.owner });
  const [value, setValue] = useState(next);
  useLayoutEffect(() => {
    if (initial.current.name !== "forumSwaps:listMine") return;
    const subscription = {
      owner: initial.current.owner,
      active: true,
      deliver: setValue,
    };
    subscriptions.push(subscription);
    queries.push(initial.current);
    return () => {
      subscription.active = false;
    };
  }, []);
  if (name !== "forumSwaps:listMine") return other;
  if (value.mode === "failed")
    throw new Error("Invented private history read failure");
  return value.mode === "loading" ? undefined : value.rows;
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    forbidden.push(name);
    throw new Error("All wallet, provider and financial actions are forbidden");
  }, [name]);
}
export function useMutation(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    forbidden.push(name);
    throw new Error("All mutations are forbidden");
  }, [name]);
}
export const client = {
  wallet: { getState: () => ({ connected: null }) },
} as unknown as CommerceWalletClient;
export function useCommerceIdentity() {
  const current = useFixtureState(),
    auth = useConvexAuth();
  return {
    ...auth,
    linked: false,
    connected: null,
    session:
      current.auth === "loading"
        ? undefined
        : { authUserId: current.owner, wallets: [] },
  };
}
export function useCommerceWallet() {
  return client;
}
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function CommerceWalletButton() {
  return (
    <button
      type="button"
      onClick={() => {
        forbidden.push("wallet-connect");
        throw new Error("Wallet connection forbidden");
      }}
    >
      Inert wallet connection
    </button>
  );
}
export function usePathname() {
  return "/trade";
}
