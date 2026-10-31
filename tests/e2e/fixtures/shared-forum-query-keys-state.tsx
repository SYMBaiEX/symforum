// Inert read arguments only. No HTTP, provider, wallet or financial callbacks.
import { useEffect, useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { ForumFeedPage } from "../../../components/forum/forum-feed-refs";

const listeners = new Set<() => void>();
let state = {
  authenticated: false,
  loading: false,
  actor: "guest",
  mounted: true,
  instance: 0,
  surface: "feed" as "feed" | "recent",
  mode: "today" as "today" | "new",
  deferred: false,
};
type Call = { name: string; args: unknown; actor: string };
const reads: Call[] = [],
  mutations: Call[] = [],
  forbidden: string[] = [];
const pending: {
  call: Call;
  resolve(page: ForumFeedPage): void;
  reject(error: Error): void;
}[] = [];
export function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
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
function feedPage(actor: string): ForumFeedPage {
  return {
    page: [
      {
        _id: `${actor}-thread`,
        slug: "sample",
        categorySlug: "general",
        categoryName: "General",
        title: `${actor} sampled discussion`,
        excerpt: "Inert sampled content",
        source: "community",
        authorIdentity: {
          username: "sample",
          name: "Sample member",
          isAgent: false,
        },
        createdAt: 1,
        replyCount: 0,
      },
    ],
    isDone: false,
    continueCursor: "sample-next",
  };
}
const client = {
  query(ref: FunctionReference<"query">, args: unknown) {
    const name = getFunctionName(ref);
    if (name !== "forum:listFeedThreads") {
      forbidden.push(name);
      throw new Error("Unexpected imperative read");
    }
    const call = { name, args, actor: state.actor };
    reads.push(call);
    if (!state.deferred) return Promise.resolve(feedPage(call.actor));
    return new Promise<ForumFeedPage>((resolve, reject) =>
      pending.push({ call, resolve, reject }),
    );
  },
};
export const useConvex = () => client;
export function useConvexAuth() {
  const value = useFixtureState();
  return { isAuthenticated: value.authenticated, isLoading: value.loading };
}
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  const value = useFixtureState(),
    name = getFunctionName(ref),
    key = JSON.stringify(args);
  useEffect(() => {
    if (key !== '"skip"')
      reads.push({ name, args: JSON.parse(key), actor: value.actor });
  }, [name, key, value.actor]);
  if (args === "skip") return undefined;
  if (name === "forum:feedAuthorizationFingerprint")
    return { fingerprint: value.actor };
  if (name === "forum:getMyForumExperience") {
    if (!value.authenticated) {
      forbidden.push(name);
      throw new Error("Private preference read while signed out");
    }
    return {
      defaultFeed: "discover",
      authorFilter: "all",
      mutedWords: ["muted"],
      mutedUntil: Date.UTC(2026, 9, 31, 20, 0, 30, 321),
    };
  }
  if (name === "forum:overview") return { categories: [] };
  if (name === "forum:listRecentThreads") {
    const input = args as {
      mode: "new" | "today";
      now: number;
      page: number;
      pageSize: number;
    };
    return {
      mode: input.mode,
      label: input.mode === "today" ? "Today's Posts" : "New Posts",
      since:
        input.mode === "today"
          ? Math.floor(input.now / 86_400_000) * 86_400_000
          : undefined,
      visibleThreadCount: 0,
      unreadThreadCount: value.authenticated ? 0 : undefined,
      limited: false,
      threads: [],
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        totalItems: 0,
        totalPages: 1,
        hasPreviousPage: false,
        hasNextPage: false,
      },
    };
  }
  forbidden.push(name);
  throw new Error(`Unexpected reactive read ${name}`);
}
export function useMutation(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref);
  return async (args: unknown) => {
    if (
      name !== "forum:recordForumExperienceEvent" &&
      name !== "forum:updateMyForumExperience"
    ) {
      forbidden.push(name);
      throw new Error("Mutation denied");
    }
    if (!state.authenticated) {
      forbidden.push(name);
      throw new Error("Guest mutation denied");
    }
    mutations.push({ name, args, actor: state.actor });
    return null;
  };
}
const router = {
  push(href: string) {
    history.pushState({}, "", href);
    update({});
  },
};
export const useRouter = () => router;
export const usePathname = () => location.pathname;
export function useSearchParams() {
  useFixtureState();
  return new URLSearchParams(location.search);
}
export const fixture = {
  update,
  reads,
  mutations,
  forbidden,
  resolve(index: number) {
    pending[index].resolve(feedPage(pending[index].call.actor));
  },
  reject(index: number) {
    pending[index].reject(new Error("Inert read unavailable"));
  },
};
export function reportAppError() {
  /* No telemetry transport in this fixture. */
}
export function ForumAgentContextStrip() {
  return null;
}
Object.assign(window, { __sharedForumKeys: fixture });
