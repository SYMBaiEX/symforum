import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";

let state = {
  owner: "owner-a",
  authenticated: true,
  loading: false,
  mounted: true,
};
const listeners = new Set<() => void>();
export function useFixture() {
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
const reports: {
  args: unknown;
  resolve(value: unknown): void;
  reject(error: Error): void;
}[] = [];
const reads: string[] = [],
  inert: string[] = [],
  forbidden: string[] = [],
  errors: string[] = [];
const detail = {
  category: { slug: "crypto", title: "Web3", readOnlyArchive: false },
  thread: {
    _id: "thread-a",
    slug: "example",
    title: "Invented discussion",
    body: "Opening text",
    author: "fixture_author",
    authorUsername: "fixture_author",
    createdAt: 1_800_000_000_000,
    lastPostAt: 1_800_000_000_000,
    viewerCanReply: false,
    viewerCanEdit: false,
    viewerCanDelete: false,
    locked: false,
  },
  replies: {
    page: [
      {
        _id: "post-b",
        body: "Reply text",
        author: "fixture_reply",
        authorUsername: "fixture_reply",
        postNumber: 2,
        createdAt: 1_800_000_000_001,
      },
    ],
    isDone: true,
    pagination: {
      page: 1,
      totalPages: 1,
      totalItems: 2,
      startItem: 1,
      endItem: 2,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  },
  poll: null,
  rules: null,
  announcements: [],
};
export const fixture = {
  reads,
  inert,
  forbidden,
  errors,
  reports: () => reports.map((item) => item.args),
  update(patch: Partial<typeof state>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  },
  settle(index: number, outcome: "success" | "failure" | "auth") {
    if (outcome === "success") reports[index].resolve("inert-report-id");
    else
      reports[index].reject(
        Error(
          outcome === "auth"
            ? "Sign in required"
            : "Inert report request failed",
        ),
      );
  },
};
declare global {
  interface Window {
    reportLifecycle: typeof fixture;
  }
}
window.reportLifecycle = fixture;
export function useConvexAuth() {
  const current = useFixture();
  return { isAuthenticated: current.authenticated, isLoading: current.loading };
}
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  const current = useFixture();
  const name = getFunctionName(ref);
  if (args === "skip") return undefined;
  if (!reads.includes(name)) reads.push(name);
  if (name === "forum:getThread") return detail;
  if (name === "users:maybeViewer")
    return { _id: current.owner, username: current.owner, isAgent: false };
  if (name === "forum:listThreadPrefixes") return [];
  forbidden.push(name);
  throw Error("Unexpected read");
}
export function useMutation(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref);
  return useCallback(
    (args: unknown) => {
      if (name === "forum:createReport")
        return new Promise((resolve, reject) =>
          reports.push({ args, resolve, reject }),
        );
      if (
        name === "forum:recordThreadView" ||
        name === "forum:markThreadRead"
      ) {
        inert.push(name);
        return Promise.resolve(null);
      }
      forbidden.push(name);
      throw Error("Unexpected mutation");
    },
    [name],
  );
}
export const useAction = () => () => {
  throw Error("No financial/provider action allowed");
};
export const usePathname = () => "/forum/crypto/example",
  useSearchParams = () => new URLSearchParams(),
  useRouter = () => ({
    push() {
      throw Error("No navigation allowed");
    },
  });
export const reportAppError = () => {
  errors.push("captured");
};
export const ForumCommerceFrame = ({ children }: { children: ReactNode }) => (
  <>{children}</>
);
export const CommunityHolderBadge = () => null;
export const ForumCompose = () => null,
  ForumAttachmentDraftPanel = () => null;
export const ForumPostFrame = ({
  id,
  children,
  actions,
}: {
  id: string;
  children: ReactNode;
  actions: ReactNode;
}) => (
  <article id={id} className="forum-panel p-3">
    {children}
    {actions}
  </article>
);
export const ForumBody = ({ body }: { body: string }) => <p>{body}</p>;
export const ForumLoading = ({ label }: { label: string }) => (
  <p role="status">{label}</p>
);
export const ForumStatusBox = ({
  title,
  body,
}: {
  title: string;
  body: string;
}) => (
  <section>
    <h2>{title}</h2>
    <p>{body}</p>
  </section>
);
export const ForumLink = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => (
  <a href={href} onClick={(event) => event.preventDefault()}>
    {children}
  </a>
);
export const ForumJumpLink = ForumLink;
export const ForumBreadcrumbs = () => <span>Fixture board</span>;
export const ForumAnnouncementPanel = () => null,
  ForumAttachmentList = () => null,
  ForumPaginationBar = () => null,
  ForumThreadRatingSummary = () => null,
  ForumThreadPrefixBadge = () => null,
  ForumThreadStateBadges = () => null;
export const handleForumDisclosureKeyDown = () => {};
export default function unusedDynamic() {
  return () => null;
}
