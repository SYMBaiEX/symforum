import { useSyncExternalStore, type AnchorHTMLAttributes } from "react";
import {
  forumFeedRefs,
  type ForumFeedPage,
} from "../../../components/forum/forum-feed-refs";
import { forumExperienceRefs } from "../../../components/forum/forum-experience-refs";
export { ForumLink } from "../../../components/forum/forum-link";
const flags = new URLSearchParams(location.search),
  scenario = flags.get("scenario") ?? "following";
const guest = scenario === "guest",
  loading = scenario === "loading";
const calls: unknown[] = [],
  events: unknown[] = [];
Object.assign(window, { onboardingCalls: calls, onboardingEvents: events });
const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};
const snapshot = () => location.href;
export function usePathname() {
  return location.pathname;
}
export function useSearchParams() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return new URLSearchParams(location.search);
}
export function useConvexAuth() {
  return { isAuthenticated: !guest, isLoading: false };
}
export function useQuery(ref: unknown, args: unknown) {
  if (args === "skip") return undefined;
  if (ref === forumFeedRefs.authorizationFingerprint)
    return { fingerprint: guest ? "guest" : "fixture-owner" };
  if (ref === forumExperienceRefs.get)
    return { defaultFeed: "discover", authorFilter: "all" };
  throw Error("Unexpected reactive feed read");
}
const client = {
  query(ref: unknown, args: unknown) {
    if (ref !== forumFeedRefs.listFeedThreads)
      throw Error("Unexpected direct query");
    calls.push(args);
    if (loading) return new Promise<ForumFeedPage>(() => {});
    if (
      scenario === "error" ||
      (scenario === "refresh-error" && calls.length > 1)
    )
      return Promise.reject(Error("Invented feed read failure"));
    return Promise.resolve({
      page: [],
      isDone: scenario !== "scan",
      continueCursor: scenario === "scan" ? "fixture-next" : "",
    } satisfies ForumFeedPage);
  },
};
export const useConvex = () => client;
const record = async (args: unknown) => {
  events.push(args);
};
const denied = async () => {
  events.push({ event: "unexpected mutation" });
  throw Error("No preference/follow/write operations admitted");
};
export function useMutation(ref: unknown) {
  return ref === forumExperienceRefs.event ? record : denied;
}
const router = {
  push(href: string) {
    history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  },
};
export const useRouter = () => router;
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
