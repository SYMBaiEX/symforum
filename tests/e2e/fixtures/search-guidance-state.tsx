import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { forumRefs } from "../../../components/forum/forum-refs";

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((listener) => listener());
}
window.addEventListener("popstate", notify);
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const queries: { name: string; args: unknown }[] = [];
const subscriptions: { name: string; args: unknown }[] = [];
const navigations: string[] = [];
const forbidden: string[] = [];
const router = {
  push(href: string) {
    if (!/^\/forum\/search(?:\?|$)/.test(href)) {
      forbidden.push(href);
      throw new Error("Unexpected navigation");
    }
    navigations.push(href);
    history.pushState(null, "", href);
    notify();
  },
};
const convex = {
  async query(ref: unknown, args: Record<string, unknown>) {
    const name = getFunctionName(ref as FunctionReference<"query">);
    if (ref !== forumRefs.search) {
      forbidden.push(name);
      throw new Error("Unexpected query");
    }
    queries.push({ name, args });
    if (new URLSearchParams(location.search).has("failure"))
      throw new Error("Inert search failure");
    return { threads: [], posts: [], filters: args, limited: false };
  },
};
export const fixture = { queries, subscriptions, navigations, forbidden };
declare global {
  interface Window {
    searchGuidance: typeof fixture;
  }
}
window.searchGuidance = fixture;
export function useConvex() {
  return convex;
}
export function useQuery(ref: unknown, args: unknown) {
  const name = getFunctionName(ref as FunctionReference<"query">);
  const key = JSON.stringify(args);
  useEffect(() => {
    subscriptions.push({ name, args: JSON.parse(key) });
  }, [name, key]);
  if (ref !== forumRefs.listCategoryOptions) {
    forbidden.push(name);
    throw new Error("Unexpected subscription");
  }
  return [];
}
export function useRouter() {
  return router;
}
export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => location.search);
  return new URLSearchParams(search);
}
export function ForumStatusBox({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <section>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </section>
  );
}
export function ForumLoading({ label }: { label: string }) {
  return <p role="status">{label}</p>;
}
export function ForumPaginationBar() {
  throw new Error("Unexpected populated result");
}
export function ForumThreadPrefixBadge() {
  return null;
}
export function ForumLink({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) {
  return <a href={href}>{children}</a>;
}
