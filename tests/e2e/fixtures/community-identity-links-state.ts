import {
  createElement,
  useEffect,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
export const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const mintB = "EPjFWdd5aufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const listeners = new Set<() => void>();
let revision = 0;
let firstMint = mintA;
let firstUsername = "Alice_Builder";
const subscriptions: string[] = [],
  operations: string[] = [],
  copies: string[] = [];
let copyMode: "ok" | "denied" | "deferred" = "ok";
const pending: { resolve(): void; reject(): void }[] = [];
const publish = () => {
  revision++;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: async (text: string) => {
      copies.push(text);
      if (copyMode === "denied") throw new Error("Invented clipboard denial");
      if (copyMode === "deferred")
        await new Promise<void>((resolve, reject) =>
          pending.push({
            resolve,
            reject: () => reject(new Error("Invented deferred denial")),
          }),
        );
    },
  },
});
export const fixture = {
  subscriptions,
  operations,
  copies,
  mode(value: typeof copyMode) {
    copyMode = value;
  },
  settle(index: number, ok = true) {
    if (ok) pending[index].resolve();
    else pending[index].reject();
  },
  replaceFirstMint(value: string) {
    firstMint = value;
    publish();
  },
  replaceFirstHandle(value: string) {
    firstUsername = value;
    publish();
  },
};
declare global {
  interface Window {
    communityIdentity: typeof fixture;
  }
}
window.communityIdentity = fixture;

export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );
  const name = getFunctionName(ref),
    key = JSON.stringify([name, args]);
  const active = args !== "skip";
  useEffect(() => {
    if (active) subscriptions.push(key);
  }, [key, active]);
  if (args === "skip") return undefined;
  if (name === "forumCommunity:listProjects")
    return [firstMint, mintB].map((mint, index) => ({
      projectId: `invented-project-${index}`,
      mint,
      name: index ? "Project two" : "Project one",
      symbol: "DUP",
      claims: [
        {
          userId: `invented-public-user-${index}`,
          username: index ? "case/sensitive?name" : firstUsername,
          role: "Public contributor",
          description: "Invented public affiliation, not verified ownership",
          website: null,
          updatedAt: 1,
        },
      ],
    }));
  if (name === "forumCommunity:listBounties")
    return [firstMint, mintB, null].map((mint, index) => ({
      workId: `invented-work-${index}`,
      sponsorId: `invented-sponsor-${index}`,
      sponsor: "PublicSponsor",
      mint,
      kind: "bounty",
      title:
        index === 2 ? "Work without mint" : index ? "Work two" : "Work one",
      brief: "Invented public work brief with no payment authority",
      amountLamports: "10000000",
      status: "open",
      selectedSubmissionId: null,
      updatedAt: 1,
    }));
  throw new Error(`Unexpected public identity query: ${name}`);
}
export function useConvexAuth() {
  return { isAuthenticated: false, isLoading: false };
}
export function useMutation() {
  return async () => {
    operations.push("mutation");
    throw new Error("Identity controls may not mutate");
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
  return {
    isAuthenticated: false,
    isLoading: false,
    linked: false,
    connected: null,
    session: null,
  };
}
export function CommerceWalletButton() {
  return createElement(
    "button",
    { type: "button" },
    "Fixture wallet unavailable",
  );
}
const originalPush = history.pushState.bind(history);
history.pushState = (...args) => {
  originalPush(...args);
  publish();
};
window.addEventListener("popstate", publish);
export function useSearchParams() {
  useSyncExternalStore(
    subscribe,
    () => location.href,
    () => location.href,
  );
  return new URLSearchParams(location.search);
}
export function usePathname() {
  useSyncExternalStore(
    subscribe,
    () => location.pathname,
    () => location.pathname,
  );
  return location.pathname;
}
export default function NextLink({
  prefetch: _prefetch,
  ...props
}: ComponentProps<"a"> & { prefetch?: boolean }) {
  return createElement("a", props);
}
