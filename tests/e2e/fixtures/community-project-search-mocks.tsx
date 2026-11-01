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
let initialError = parameters.has("initialerror");
let owner: string | null = parameters.has("owner") ? "author-0" : null;
let changedCursor = false;
let pageMode = parameters.has("deferred") ? "deferred" : "ok";
const pageRequests: unknown[] = [];
const pendingPages: {
  resolve(value: unknown): void;
  reject(error: Error): void;
  value: unknown;
}[] = [];
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
const laterProjects = Array.from({ length: 25 }, (_, index) => ({
  ...projects[0],
  projectId: `project-${index + 24}`,
  mint: `invented-mint-${index + 24}`,
  name: "Older loaded project " + (index + 24),
  symbol: "OLDER" + (index + 24),
  claims: [{ ...projects[0].claims[0], userId: `author-${index + 24}` }],
}));
const fixture = {
  pageRequests,
  mode(value: string) {
    pageMode = value;
  },
  settle(index: number, ok = true) {
    if (ok) pendingPages[index].resolve(pendingPages[index].value);
    else pendingPages[index].reject(new Error("Invented deferred page error"));
  },
  owner(value: string | null) {
    owner = value;
    changed();
  },
  scope(mint?: string) {
    const url = new URL(location.href);
    if (mint) url.searchParams.set("mint", mint);
    else url.searchParams.delete("mint");
    history.replaceState(null, "", url);
    changed();
  },
  initialReady() {
    initialError = false;
    changed();
  },
  moveCursor() {
    changedCursor = !changedCursor;
    changed();
  },
  replaceFirstId() {
    projects = projects.map((project, index) =>
      index === 0 ? { ...project, projectId: "replacement-project" } : project,
    );
    changed();
  },
};
Object.assign(window, { projectDirectoryFixture: fixture });
declare global {
  interface Window {
    projectDirectoryFixture: typeof fixture;
  }
}
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
  if (name === "forumCommunity:listProjectPage") {
    if (initialError) throw new Error("Invented initial page error");
    if (loading) return undefined;
    const mint = (args as { mint?: string }).mint;
    const page = parameters.has("empty")
      ? []
      : mint
        ? projects.filter((project) => project.mint === mint)
        : projects.slice(
            0,
            (args as { paginationOpts: { numItems: number } }).paginationOpts
              .numItems,
          );
    return {
      page,
      isDone: !!mint || parameters.has("empty"),
      continueCursor: changedCursor ? "changed:12" : "page:12",
      pageStatus: parameters.has("initialsplit") ? "SplitRequired" : null,
      splitCursor: parameters.has("initialsplit") ? "split" : null,
    };
  }
  if (name === "forumCommunity:listProjects") {
    if (loading) return undefined;
    if (parameters.has("empty")) return [];
    const mint = (args as { mint?: string }).mint;
    return mint
      ? projects.filter((project) => project.mint === mint)
      : projects;
  }
  if (name === "forumCommunity:getMine")
    return { userId: owner, recipient: null, supporter: null };
  throw new Error(`Unexpected project search query: ${name}`);
}
export function useConvexAuth() {
  useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );
  return { isAuthenticated: !!owner, isLoading: false };
}
export function useConvex() {
  return {
    query: async (
      reference: FunctionReference<"query">,
      args: {
        mint?: string;
        paginationOpts: {
          cursor: string | null;
          numItems: number;
          maximumRowsRead: number;
          maximumBytesRead: number;
        };
      },
    ) => {
      if (
        getFunctionName(reference) !== "forumCommunity:listProjectPage" ||
        args.mint ||
        args.paginationOpts.numItems > 24 ||
        args.paginationOpts.maximumRowsRead !== 24 ||
        args.paginationOpts.maximumBytesRead !== 262144
      )
        throw new Error("Unexpected directory query or unbounded options");
      pageRequests.push(args);
      if (pageMode === "error") throw new Error("Invented page error");
      const cursor = args.paginationOpts.cursor;
      if (cursor !== null && !/^(page|changed):\d+$/.test(cursor))
        throw new Error("Unexpected cursor");
      const offset = cursor === null ? 1 : Number(cursor.split(":")[1]);
      const all = [...projects, ...laterProjects];
      const start = offset - 1;
      const end = Math.min(all.length, start + args.paginationOpts.numItems);
      const value =
        pageMode === "split"
          ? {
              page: laterProjects.slice(0, 2),
              isDone: false,
              continueCursor: "unsafe",
              pageStatus: "SplitRequired",
              splitCursor: "split",
            }
          : pageMode === "repeat"
            ? { page: [], isDone: false, continueCursor: cursor }
            : pageMode === "empty-page"
              ? { page: [], isDone: false, continueCursor: "page:47" }
              : {
                  page: all.slice(start, end),
                  isDone: end === all.length,
                  continueCursor: `page:${end}`,
                };
      return pageMode === "deferred"
        ? await new Promise((resolve, reject) =>
            pendingPages.push({ resolve, reject, value }),
          )
        : value;
    },
  };
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
  useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );
  return new URLSearchParams(location.search);
}
export function usePathname() {
  return location.pathname;
}
