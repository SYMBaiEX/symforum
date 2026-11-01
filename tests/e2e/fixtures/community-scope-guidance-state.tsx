import {
  useEffect,
  useSyncExternalStore,
  type ReactNode,
  type AnchorHTMLAttributes,
} from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
const flags = new URLSearchParams(location.search),
  guest = flags.has("guest"),
  native = flags.has("native");
const reads: unknown[] = [],
  actions: unknown[] = [],
  lifecycle = { mounts: 0, unmounts: 0 };
Object.assign(window, {
  scopeReads: reads,
  scopeActions: actions,
  scopeLifecycle: lifecycle,
});
const subscribe = (fn: () => void) => {
  window.addEventListener("popstate", fn);
  return () => window.removeEventListener("popstate", fn);
};
const snapshot = () => location.href,
  push = history.pushState.bind(history);
history.pushState = (...args) => {
  push(...args);
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
  return { isAuthenticated: !guest, isLoading: false };
}
const empty: never[] = [];
const mine = { userId: "fixture-member", recipient: null, supporter: null };
const payments = [
  {
    intentId: "fixture-held",
    wallet: "11111111111111111111111111111111",
    recipient: "11111111111111111111111111111111",
    amountLamports: "10000000",
    purpose: "tip",
    reference: "11111111111111111111111111111111",
    memo: "local",
    createdAt: 1,
    expiresAt: 2,
    status: "held",
    signature: null,
    issue: null,
    finalizedAt: null,
    workId: null,
  },
];
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  const name = getFunctionName(ref),
    signature = JSON.stringify(args);
  useEffect(() => {
    const requested: unknown = JSON.parse(signature);
    if (requested !== "skip") reads.push({ name, args: requested });
  }, [name, signature]);
  if (args === "skip") return undefined;
  if (native) throw Error("Native handoff cannot query");
  if (name === "forumCommunity:listProjectPage")
    return { page: empty, isDone: true, continueCursor: "" };
  if (
    [
      "forumCommunity:listProjects",
      "forumCommunity:listBounties",
      "forumCommunity:listTipRecipients",
    ].includes(name)
  )
    return empty;
  if (name === "forumCommunity:getMine") return mine;
  if (name === "forumCommunity:listPayments") return payments;
  throw Error(`Unexpected scope query ${name}`);
}
export function useMutation(ref: FunctionReference<"mutation">) {
  return async (args: unknown) => {
    actions.push({ name: getFunctionName(ref), args });
    throw Error("No financial or write operations allowed");
  };
}
export const useAction = useMutation;
const client = {} as CommerceWalletClient;
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (native) throw Error("Native handoff cannot mount wallet");
    lifecycle.mounts++;
    return () => {
      lifecycle.unmounts++;
    };
  }, []);
  return children;
}
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  return {
    ...useConvexAuth(),
    isLoading: false,
    linked: false,
    connected: null,
    session: null,
  };
}
export function CommerceWalletButton() {
  return <button type="button">Local wallet control</button>;
}
export default function Link({
  prefetch: _prefetch,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) {
  return <a {...props} />;
}
export function useConvex() {
  return {
    query: async () => {
      throw new Error("Unexpected directory page read");
    },
  };
}
