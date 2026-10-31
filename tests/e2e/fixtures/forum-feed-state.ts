import { useSyncExternalStore } from "react";
import {
  forumFeedRefs,
  type ForumFeedPage,
} from "../../../components/forum/forum-feed-refs";
import { forumExperienceRefs } from "../../../components/forum/forum-experience-refs";

let state = {
  isLoading: false,
  isAuthenticated: true,
  fingerprint: "owner-a",
  experienceReady: true,
  mounted: true,
};
const listeners = new Set<() => void>();
export const calls: {
  cursor: string | null;
  resolve: (page: ForumFeedPage) => void;
  reject: (error: Error) => void;
}[] = [];
export function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export function useStateSnapshot() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
const client = {
  query(ref: unknown, args: { paginationOpts: { cursor: string | null } }) {
    if (ref !== forumFeedRefs.listFeedThreads)
      throw new Error("Unexpected query");
    return new Promise<ForumFeedPage>((resolve, reject) =>
      calls.push({ cursor: args.paginationOpts.cursor, resolve, reject }),
    );
  },
};
export const useConvex = () => client;
export function useConvexAuth() {
  const value = useStateSnapshot();
  return { isLoading: value.isLoading, isAuthenticated: value.isAuthenticated };
}
export function useQuery(ref: unknown, args: unknown) {
  const value = useStateSnapshot();
  if (args === "skip") return undefined;
  if (ref === forumFeedRefs.authorizationFingerprint)
    return { fingerprint: value.fingerprint };
  if (ref === forumExperienceRefs.get)
    return value.experienceReady
      ? { defaultFeed: "discover", authorFilter: "all" }
      : undefined;
  throw new Error("Unexpected reactive query");
}
const mutation = async () => undefined;
export function useMutation(ref: unknown) {
  if (ref !== forumExperienceRefs.event && ref !== forumExperienceRefs.update)
    return async () => {
      throw new Error("Unexpected mutation");
    };
  return mutation;
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
  useStateSnapshot();
  return new URLSearchParams(location.search);
}
