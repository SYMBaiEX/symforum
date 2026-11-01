import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { forumRefs } from "../../../components/forum/forum-refs";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
window.addEventListener("popstate", notify);
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const queries: Record<string, unknown>[] = [];
const forbidden: string[] = [];
const pending: {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}[] = [];
const subscriptions: unknown[] = [];
const router = {
  push(href: string) {
    if (!href.startsWith("/forum/search?") && href !== "/forum/search")
      throw new Error("Unexpected route");
    history.pushState(null, "", href);
    notify();
  },
};
const client = {
  query(ref: unknown, args: Record<string, unknown>) {
    if (ref !== forumRefs.search) {
      forbidden.push("query");
      throw new Error("Unexpected read");
    }
    queries.push(args);
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  },
};
export const fixture = {
  queries,
  forbidden,
  subscriptions,
  finish(index: number, limited = false) {
    pending[index].resolve({
      threads: [],
      posts: [],
      limited,
      filters: queries[index],
    });
  },
  fail(index: number) {
    pending[index].reject(new Error("Inert failure"));
  },
};
declare global {
  interface Window {
    searchRecovery: typeof fixture;
  }
}
window.searchRecovery = fixture;
export const useConvex = () => client;
export function useQuery(ref: unknown, args: unknown) {
  if (ref !== forumRefs.listCategoryOptions)
    throw new Error("Unexpected subscription");
  const key = JSON.stringify(args);
  useEffect(() => {
    subscriptions.push(JSON.parse(key));
  }, [key]);
  return [];
}
export const useRouter = () => router;
export function useSearchParams() {
  return new URLSearchParams(
    useSyncExternalStore(subscribe, () => location.search),
  );
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
    <div className="forum-status-box py-4">
      <p className="forum-status-title text-sm font-semibold text-foreground">
        {title}
      </p>
      <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
        {body}
      </p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
export const ForumLoading = ({ label }: { label: string }) => (
  <p role="status">{label}</p>
);
export function ForumPaginationBar() {
  throw new Error("Unexpected populated result");
}
export const ForumThreadPrefixBadge = () => null;
export const ForumLink = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => <a href={href}>{children}</a>;
