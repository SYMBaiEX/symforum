import {
  forwardRef,
  useEffect,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import {
  forumRefs,
  type ForumSearchRecord,
} from "../../../components/forum/forum-refs";
export { ForumLink } from "../../../components/forum/forum-link";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
window.addEventListener("popstate", notify);
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const queries: Record<string, unknown>[] = [],
  subscriptions: unknown[] = [],
  navigations: string[] = [],
  forbidden: string[] = [];
const pending: {
  resolve(value: ForumSearchRecord): void;
  reject(error: Error): void;
}[] = [];
const stamp = Date.parse("2026-11-01T00:00:00Z");
function result(
  args: Record<string, unknown>,
  mode: string,
): ForumSearchRecord {
  const thread = {
    _id: "inert-thread",
    slug: "source-thread",
    categorySlug: "crypto",
    title: "Solana and SOLANA tools",
    excerpt: "Original SOLANA source excerpt: a+b, 東京 and Élan.",
    author: "fixture_author",
    createdAt: stamp,
    lastPostAt: stamp,
    replyCount: 1,
    viewCount: 2,
  };
  const post = {
    _id: "inert-post",
    threadSlug: "source-thread",
    categorySlug: "crypto",
    threadTitle: "Solana reply discussion",
    body: "DO_NOT_DISPLAY_BODY_WHEN_EXCERPT_EXISTS",
    excerpt: "Reply excerpt about Solana.",
    author: "fixture_reply",
    createdAt: stamp,
    postNumber: 3,
    postPage: 1,
  };
  const threads =
    mode === "missing"
      ? [{ ...thread, excerpt: undefined }]
      : mode === "unsafe"
        ? [
            {
              ...thread,
              title: '<img src=x onerror="window.HACKED=1"> Solana',
              excerpt:
                "<script>window.HACKED=1</script> Solana https://unsafe.example.test/",
            },
          ]
        : mode === "long"
          ? [
              {
                ...thread,
                title: `Solana${"VeryLongTitle".repeat(60)}`,
                excerpt: `Solana${"VeryLongOriginalExcerpt".repeat(50)}`,
              },
            ]
          : [thread];
  const posts =
    mode === "missing"
      ? []
      : [
          {
            ...post,
            threadTitle: mode === "untitled" ? undefined : post.threadTitle,
            excerpt:
              mode === "body"
                ? undefined
                : mode === "untitled"
                  ? "Forum original source excerpt."
                  : post.excerpt,
            body: mode === "body" ? "Original reply body Solana." : post.body,
          },
        ];
  const pagination = (count: number) => ({
    page: 1,
    pageSize: 12,
    totalItems: count,
    totalPages: 1,
    startItem: count ? 1 : 0,
    endItem: count,
    hasPreviousPage: false,
    hasNextPage: false,
  });
  return {
    threads,
    posts,
    pagination: pagination(threads.length + posts.length),
    threadPagination: pagination(threads.length),
    postPagination: pagination(posts.length),
    limited: false,
    threadResultsLimited: false,
    postResultsLimited: false,
    filters: {
      resultType: "all",
      author: typeof args.author === "string" ? args.author : null,
      target: "all",
      sortKey: "relevance",
    },
  };
}
const client = {
  query(ref: unknown, args: Record<string, unknown>) {
    if (ref !== forumRefs.search) {
      forbidden.push("query");
      throw Error("Unexpected read");
    }
    queries.push(args);
    return new Promise<ForumSearchRecord>((resolve, reject) =>
      pending.push({ resolve, reject }),
    );
  },
};
const router = {
  push(href: string) {
    if (!href.startsWith("/forum/search")) throw Error("Unexpected route");
    history.pushState(null, "", href);
    notify();
  },
};
export const fixture = {
  queries,
  subscriptions,
  navigations,
  forbidden,
  finish(index: number, mode = "normal") {
    pending[index].resolve(result(queries[index], mode));
  },
  fail(index: number) {
    pending[index].reject(Error("Inert error"));
  },
};
declare global {
  interface Window {
    searchExcerpts: typeof fixture;
    HACKED?: number;
  }
}
window.searchExcerpts = fixture;
export const useConvex = () => client,
  useRouter = () => router,
  usePathname = () => location.pathname;
export function useSearchParams() {
  return new URLSearchParams(
    useSyncExternalStore(subscribe, () => location.search),
  );
}
export function useQuery(ref: unknown, args: unknown) {
  if (ref !== forumRefs.listCategoryOptions)
    throw Error("Unexpected subscription");
  const key = JSON.stringify(args);
  useEffect(() => {
    subscriptions.push(JSON.parse(key));
  }, [key]);
  return [];
}
export const useMutation = () => {
    throw Error("No mutation allowed");
  },
  useAction = useMutation;
const Link = forwardRef<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }
>(function InertLink({ prefetch, onClick, ...props }, ref) {
  return (
    <a
      {...props}
      ref={ref}
      data-fixture-prefetch={String(prefetch)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) navigations.push(String(props.href));
        event.preventDefault();
      }}
    />
  );
});
export default Link;
export const ForumLoading = ({ label }: { label: string }) => (
  <p role="status">{label}</p>
);
export const ForumStatusBox = ({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) => (
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
export const ForumThreadPrefixBadge = () => null;
export const ForumPaginationBar = ({ label }: { label: string }) => (
  <nav aria-label={label}>Loaded results</nav>
);
