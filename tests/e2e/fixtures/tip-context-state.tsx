import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
const params = new URLSearchParams(location.search);
export const walletA = "2".repeat(44),
  walletB = "3".repeat(44),
  payer = "1".repeat(32);
export const initialRecipients = [
  { userId: "recipient-A", username: "Same", wallet: walletA },
  { userId: "recipient-B", username: "Same", wallet: walletB },
  {
    userId: "recipient-C",
    username: "夜猫/long?" + "x".repeat(160),
    wallet: "4".repeat(44),
  },
];
let state = {
  authenticated: !params.has("guest"),
  linked:
    !params.has("guest") && !params.has("unlinked") && !params.has("loading"),
  isLoading: params.has("loading"),
  recipients: initialRecipients as typeof initialRecipients | undefined,
  optedIn: !params.has("optout"),
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export function useFixtureState() {
  return useSyncExternalStore(subscribe, () => state);
}
const reads: { name: string; args: unknown }[] = [],
  operations: { name: string; args: unknown }[] = [],
  forbidden: string[] = [];
let rejectPrepare: (() => void) | undefined;
export const fixture = {
  update,
  reads,
  operations,
  forbidden,
  walletA,
  walletB,
  initialRecipients,
  rejectPrepare() {
    rejectPrepare?.();
  },
};
declare global {
  interface Window {
    tipContextFixture: typeof fixture;
  }
}
window.tipContextFixture = fixture;
export function useConvexAuth() {
  const value = useFixtureState();
  return { isAuthenticated: value.authenticated, isLoading: value.isLoading };
}
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  const value = useFixtureState(),
    name = getFunctionName(ref),
    key = JSON.stringify(args);
  useEffect(() => {
    if (key !== '"skip"') reads.push({ name, args: JSON.parse(key) });
  }, [name, key]);
  if (args === "skip") return undefined;
  if (name === "forumCommunity:listProjectPage")
    return { page: [], isDone: true, continueCursor: "" };
  if (name === "forumCommunity:listTipRecipients") return value.recipients;
  if (name === "forumCommunity:getThreadRecipient")
    return value.optedIn
      ? { userId: "recipient-A", username: "Same", wallet: walletA }
      : null;
  if (name === "forumCommunity:getMine") {
    if (!value.authenticated)
      throw new Error("Private settings query after logout");
    return { recipient: null, supporter: null };
  }
  if (name === "forumCommunity:listPayments") {
    if (!value.authenticated)
      throw new Error("Private receipts query after logout");
    return [];
  }
  if (
    [
      "forumCommunity:listProjects",
      "forumCommunity:listBounties",
      "forumCommunity:listProjectClaims",
      "forumCommunity:listSubmissions",
    ].includes(name)
  )
    return [];
  throw new Error(`Unexpected fixture query: ${name}`);
}
export function useMutation(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref);
  return useCallback(
    (args: unknown) => {
      operations.push({ name, args });
      if (
        name !== "forumCommunity:preparePayment" ||
        !params.has("admission")
      ) {
        forbidden.push(name);
        throw new Error("Financial mutations forbidden");
      }
      return new Promise((_resolve, reject) => {
        rejectPrepare = () =>
          reject({ data: "Invented preparation failure before any intent" });
      });
    },
    [name],
  );
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    forbidden.push(name);
    throw new Error("Provider/payment actions forbidden");
  }, [name]);
}
const client = {
  wallet: { getState: () => ({ connected: { account: { address: payer } } }) },
} as unknown as CommerceWalletClient;
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  const value = useFixtureState();
  return {
    isAuthenticated: value.authenticated,
    isLoading: value.isLoading,
    linked: value.linked,
    connected: value.authenticated ? { account: { address: payer } } : null,
  };
}
export function CommerceWalletButton() {
  return (
    <button
      type="button"
      onClick={() => {
        forbidden.push("wallet-connect");
        throw new Error("Wallet connections forbidden");
      }}
    >
      Wallet settings (inert fixture)
    </button>
  );
}
export function useSearchParams() {
  return new URLSearchParams(location.search);
}
export function usePathname() {
  return location.pathname;
}
export function useConvex() {
  return {
    query: async () => {
      throw new Error("Unexpected directory page read");
    },
  };
}
