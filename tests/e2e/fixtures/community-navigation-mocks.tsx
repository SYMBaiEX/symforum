import { useSyncExternalStore, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";

const queries: string[] = [];
const guest = new URLSearchParams(location.search).has("guest");
Object.assign(window, { communityNavigationQueries: queries });
const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};
const snapshot = () => location.href;
const originalPush = history.pushState.bind(history);
history.pushState = (...args) => {
  originalPush(...args);
  window.dispatchEvent(new PopStateEvent("popstate"));
};
export function useSearchParams() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return new URLSearchParams(location.search);
}
export function usePathname() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return location.pathname;
}
export function useConvexAuth() {
  return {
    isAuthenticated: !guest,
    isLoading: false,
  };
}
export function useQuery(reference: FunctionReference<"query">, args: unknown) {
  if (args === "skip") return undefined;
  const name = getFunctionName(reference);
  queries.push(name);
  if (name === "forumCommunity:listProjectPage")
    return { page: [], isDone: true, continueCursor: "" };
  if (
    [
      "forumCommunity:listProjects",
      "forumCommunity:listBounties",
      "forumCommunity:listTipRecipients",
      "forumCommunity:listPayments",
    ].includes(name)
  )
    return [];
  if (name === "forumCommunity:getMine")
    return { userId: "fixture-owner", recipient: null, supporter: null };
  throw new Error(`Unexpected navigation query: ${name}`);
}
export function useMutation() {
  return async () => {
    throw new Error("Navigation must never mutate or prepare payments");
  };
}
export const useAction = useMutation;
const client = {} as CommerceWalletClient;
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  const auth = useConvexAuth();
  return { ...auth, linked: false, connected: null, session: null };
}
export function CommerceWalletButton() {
  return <button type="button">Fixture wallet</button>;
}
export function useConvex() {
  return {
    query: async () => {
      throw new Error("Unexpected directory page read");
    },
  };
}
