import {
  forwardRef,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
} from "react";
import { getFunctionName } from "convex/server";
import fixture from "../../fixtures/installation.symbaiex.json";

let scenario =
  new URLSearchParams(location.search).get("scenario") ?? "populated";
const listeners = new Set<() => void>();
const evidence = {
  reads: [] as { name: string; args: unknown }[],
  forbidden: [] as string[],
  setScenario(value: string) {
    scenario = value;
    for (const listener of listeners) listener();
  },
};
declare global {
  interface Window {
    symfDiscussionEvidence: typeof evidence;
  }
}
window.symfDiscussionEvidence = evidence;
const base = {
  categorySlug: "crypto-pumpfun",
  status: "active",
  excerpt: "A public discussion of community tools and SYMF.",
  replyCount: 2,
  lastPostAt: 1793550000000,
};
function row(index: number) {
  return {
    ...base,
    threadId: `thread-${index}`,
    slug: `symf-discussion-${index}`,
    title: `SYMF discussion ${index}`,
  };
}
export function useQuery(reference: unknown, args: unknown) {
  const name = getFunctionName(
    reference as Parameters<typeof getFunctionName>[0],
  );
  if (name !== "forum:search") {
    evidence.forbidden.push(name);
    throw Error("Unexpected query");
  }
  evidence.reads.push({ name, args });
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => scenario,
  );
  if (current === "error") throw Error("PRIVATE PROVIDER BODY MUST NOT RENDER");
  if (current === "loading") return undefined;
  let threads =
    current === "empty"
      ? []
      : [row(1), { ...row(2), status: "locked", replyCount: 0 }];
  if (current === "duplicates")
    threads = [
      {
        ...row(0),
        slug: fixture.token.announcementPath.split("/").at(-1)!,
        title: "Duplicate announcement",
      },
      ...Array.from({ length: 10 }, (_, i) => row(i + 1)),
      {
        ...row(99),
        status: "pending",
        title: "Private pending draft must not render",
      },
    ];
  if (current === "unsafe")
    threads = [
      {
        ...row(3),
        categorySlug: "//evil.example",
        slug: "https://evil.example/private",
        title: "Long".repeat(80),
        excerpt: "LongUnbrokenText".repeat(70),
      },
    ];
  return {
    threads,
    limited: current === "duplicates",
    threadPagination: { hasNextPage: current === "duplicates" },
  };
}
function denied() {
  evidence.forbidden.push("action or mutation");
  throw Error("No operation allowed");
}
export const useMutation = denied,
  useAction = denied;
export function usePathname() {
  return location.pathname;
}
const Link = forwardRef<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }
>(function InertLink({ prefetch, ...props }, ref) {
  if (prefetch !== false) evidence.forbidden.push("prefetch");
  return <a ref={ref} {...props} />;
});
export default Link;
