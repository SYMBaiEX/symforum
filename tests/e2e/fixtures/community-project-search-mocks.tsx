import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
const parameters = new URLSearchParams(location.search);
const subscriptions: string[] = [],
  operations: string[] = [];
Object.assign(window, {
  projectSearchSubscriptions: subscriptions,
  projectSearchOperations: operations,
});
let revision = 0;
let loading = parameters.has("loading");
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
function changed() {
  revision++;
  listeners.forEach((listener) => listener());
}
const mints = [
  "11111111111111111111111111111111",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "So11111111111111111111111111111111111111112",
];
let projects = Array.from({ length: 24 }, (_, index) => ({
  projectId: `project-${index}`,
  mint:
    mints[index] ??
    `${"1".repeat(31)}${"23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[index]}`,
  name:
    index === 0
      ? "Alpha Research"
      : index === 1
        ? "Nova Collective"
        : index === 2
          ? "日本語 🐉 contributor studio with a very long public name that should wrap cleanly"
          : "Other loaded project " + index,
  symbol: index === 0 ? "ALPHA" : index === 1 ? "NOVA" : "PROJECT" + index,
  claims: [
    {
      userId: `author-${index}`,
      username: index === 1 ? "nova_builder" : "member_" + index,
      role: index === 0 ? "Protocol researcher" : "Community contributor",
      description:
        "Invented public project affiliation for local interface testing.",
      website: null,
      updatedAt: 1,
    },
  ],
}));
window.addEventListener("project-search:loaded", () => {
  loading = false;
  changed();
});
window.addEventListener("project-search:update", () => {
  projects = projects.map((project, index) =>
    index === 0 ? { ...project, name: "Remotely updated public hub" } : project,
  );
  changed();
});
export function useQuery(reference: FunctionReference<"query">, args: unknown) {
  useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );
  const name = getFunctionName(reference),
    key = JSON.stringify([name, args]);
  const active = args !== "skip";
  useEffect(() => {
    if (active) subscriptions.push(key);
  }, [key, active]);
  if (args === "skip") return undefined;
  if (name === "forumCommunity:listProjects") {
    if (loading) return undefined;
    if (parameters.has("empty")) return [];
    const mint = (args as { mint?: string }).mint;
    return mint
      ? projects.filter((project) => project.mint === mint)
      : projects;
  }
  if (name === "forumCommunity:getMine")
    return { userId: "author-0", recipient: null, supporter: null };
  throw new Error(`Unexpected project search query: ${name}`);
}
export function useConvexAuth() {
  return { isAuthenticated: false, isLoading: false };
}
export function useMutation() {
  return async () => {
    operations.push("mutation");
    throw new Error("Local search cannot perform writes");
  };
}
export function useAction() {
  return async () => {
    operations.push("action");
    throw new Error("Local search cannot contact providers");
  };
}
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
const client = {} as CommerceWalletClient;
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
  return <button type="button">Fixture wallet</button>;
}
export function useSearchParams() {
  return new URLSearchParams(location.search);
}
export function usePathname() {
  return location.pathname;
}
