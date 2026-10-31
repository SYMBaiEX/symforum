import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
} from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { forumExperienceRefs } from "../../../components/forum/forum-experience-refs";
import { forumRefs } from "../../../components/forum/forum-refs";
export { ForumLink } from "../../../components/forum/forum-link";
export function ForumStatusBox({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <section>
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}
type Board = { _id: string; name: string; slug: string };
const params = new URLSearchParams(location.search);
const allBoards: Board[] = [
  { _id: "board-ai", name: "AI frameworks", slug: "ai-frameworks" },
  { _id: "board-models", name: "Local models board", slug: "ai-models" },
  { _id: "board-games", name: "Gaming guides", slug: "gaming-guides" },
  { _id: "board-general", name: "General discussions", slug: "general" },
];
let state = {
  boards: undefined as Board[] | undefined,
  authenticated: !params.has("guest") && !params.has("authloading"),
  loading: params.has("authloading"),
  following: [allBoards[0]],
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function useSnapshot() {
  return useSyncExternalStore(subscribe, () => state);
}
function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
const queries: { name: string; args: unknown }[] = [],
  operations: { name: string; args: unknown }[] = [],
  forbidden: string[] = [],
  toasts: string[] = [];
const pending: { resolve(): void; reject(): void }[] = [];
export const fixture = {
  allBoards,
  queries,
  operations,
  forbidden,
  toasts,
  update,
  settle(index: number, ok = true) {
    if (ok) pending[index].resolve();
    else pending[index].reject();
  },
};
declare global {
  interface Window {
    catchUpCollections: typeof fixture;
  }
}
window.catchUpCollections = fixture;
export function useConvexAuth() {
  const value = useSnapshot();
  return { isAuthenticated: value.authenticated, isLoading: value.loading };
}
export function useQuery(ref: unknown, args: unknown) {
  const value = useSnapshot(),
    name = getFunctionName(ref as FunctionReference<"query">),
    key = JSON.stringify(args);
  useEffect(() => {
    if (key !== '"skip"') queries.push({ name, args: JSON.parse(key) });
  }, [name, key]);
  if (args === "skip") return undefined;
  if (ref === forumRefs.listCategoryOptions) return value.boards;
  if (!value.authenticated) throw new Error("Private query while signed out");
  if (ref === forumExperienceRefs.catchUp)
    return {
      threads: [],
      saved: [],
      pending: { threads: [], posts: [] },
      summary: { unread: 0, saved: 0, pending: 0 },
      bounded: true,
    };
  if (ref === forumExperienceRefs.get)
    return {
      defaultFeed: "discover",
      authorFilter: "all",
      mutedWords: [],
      onboardingCompleted: false,
      followingBoards: value.following,
      followingMembers: [],
    };
  if (ref === forumRefs.getMyForumNavState) return { canModerate: false };
  throw new Error(`Unexpected query ${name}`);
}
export function useMutation(ref: unknown) {
  const name = getFunctionName(ref as FunctionReference<"mutation">);
  return useCallback(
    async (args: unknown) => {
      operations.push({ name, args });
      if (
        !params.has("admission") ||
        (ref !== forumExperienceRefs.followBoard &&
          ref !== forumExperienceRefs.update)
      ) {
        forbidden.push(name);
        throw new Error(
          "Only explicitly admitted inert follow/update callbacks allowed",
        );
      }
      if (ref === forumExperienceRefs.followBoard)
        await new Promise<void>((resolve, reject) =>
          pending.push({
            resolve,
            reject: () => reject(new Error("Invented follow failure")),
          }),
        );
      return null;
    },
    [name, ref],
  );
}
export const toast = {
  success(message: string) {
    toasts.push(message);
  },
  error(message: string) {
    toasts.push(message);
  },
};
export function usePathname() {
  return location.pathname;
}
export default function Link({
  prefetch: _prefetch,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) {
  return <a {...props} />;
}
