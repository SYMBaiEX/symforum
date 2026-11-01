import { useSyncExternalStore, type AnchorHTMLAttributes } from "react";
import {
  forumFeedRefs,
  type ForumFeedPage,
} from "../../../components/forum/forum-feed-refs";
import { forumExperienceRefs } from "../../../components/forum/forum-experience-refs";
export { ForumLink } from "../../../components/forum/forum-link";
const flags = new URLSearchParams(location.search);
const scenario = flags.get("scenario");
let authenticated = scenario !== "guest";
let loading = scenario === "auth-loading";
let version = 0;
const listeners = new Set<() => void>();
function update() {
  version++;
  listeners.forEach((listener) => listener());
}
function useSnapshot() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => version,
  );
}
export const reads: {
  args: Record<string, unknown>;
  resolve: (page: ForumFeedPage) => void;
  reject: (error: Error) => void;
}[] = [];
export const writes: { kind: string; args: unknown }[] = [];
export const forbidden: string[] = [];
export function settle(index: number, done: boolean, rows = false) {
  reads[index].resolve({
    page: rows
      ? [
          {
            _id: "invented-discussion",
            slug: "invented-discussion",
            categorySlug: "ai",
            categoryName: "AI",
            title: "A matching discussion",
            excerpt: "Invented public fixture",
            source: "community",
            authorIdentity: {
              username: "invented",
              name: "Invented Author",
              isAgent: false,
            },
            createdAt: 1,
            replyCount: 0,
          },
        ]
      : [],
    isDone: done,
    continueCursor: done ? "" : "opaque-fixture-next",
  });
}
Object.assign(window, {
  __feedRecovery: {
    reads,
    writes,
    forbidden,
    settle,
    reject(index: number) {
      reads[index].reject(Error("Invented read unavailable"));
    },
    ready() {
      loading = false;
      update();
    },
    guest() {
      authenticated = false;
      update();
    },
  },
});
export function useConvexAuth() {
  useSnapshot();
  return { isAuthenticated: authenticated, isLoading: loading };
}
export function useQuery(ref: unknown, args: unknown) {
  useSnapshot();
  if (args === "skip") return undefined;
  if (ref === forumFeedRefs.authorizationFingerprint)
    return { fingerprint: authenticated ? "fixture-owner" : "guest" };
  if (ref === forumExperienceRefs.get)
    return { defaultFeed: "discover", authorFilter: "all" };
  forbidden.push("unexpected reactive read");
  throw Error("Unexpected reactive read");
}
const client = {
  query(ref: unknown, args: Record<string, unknown>) {
    if (ref !== forumFeedRefs.listFeedThreads) {
      forbidden.push("unexpected direct read");
      throw Error("Unexpected direct read");
    }
    return new Promise<ForumFeedPage>((resolve, reject) =>
      reads.push({ args, resolve, reject }),
    );
  },
};
export const useConvex = () => client;
export function useMutation(ref: unknown) {
  if (ref === forumExperienceRefs.event)
    return async (args: unknown) => {
      writes.push({ kind: "event", args });
    };
  if (ref === forumExperienceRefs.update)
    return async (args: unknown) => {
      writes.push({ kind: "preferences", args });
    };
  return async () => {
    forbidden.push("unexpected mutation");
    throw Error("No mutations admitted");
  };
}
const router = {
  push(href: string) {
    history.pushState(null, "", href);
    update();
  },
};
export const useRouter = () => router;
export function usePathname() {
  return location.pathname;
}
export function useSearchParams() {
  useSnapshot();
  return new URLSearchParams(location.search);
}
export default function Link({
  prefetch: _prefetch,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) {
  return <a {...props} />;
}
export function ForumAvatar() {
  return null;
}
export function ForumThreadPrefixBadge() {
  return null;
}
export function ForumThreadStateBadges() {
  return null;
}
export function ForumFeedStarter() {
  return null;
}
export function ForumMediaGallery() {
  return null;
}
export function reportAppError() {
  return undefined;
}
