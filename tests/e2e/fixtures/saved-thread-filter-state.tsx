import { useEffect, type AnchorHTMLAttributes, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
const flags = new URLSearchParams(location.search);
const threads = [
  {
    _id: "fixture-ai",
    slug: "agent-design",
    title: "Agent design notes",
    categorySlug: "ai",
    categoryName: "AI",
    createdAt: 1793448000000,
  },
  {
    _id: "fixture-web3",
    slug: "solana-research",
    title: "Solana research notes",
    categorySlug: "web3",
    categoryName: "Web3",
    createdAt: 1793448000000,
  },
  {
    _id: "fixture-gaming",
    slug: "game-design",
    title: "Game design notes",
    categorySlug: "gaming",
    categoryName: "Gaming",
    createdAt: 1793448000000,
  },
];
const reads: unknown[] = [],
  actions: unknown[] = [];
Object.assign(window, { savedReads: reads, savedActions: actions });
export function useConvexAuth() {
  return {
    isAuthenticated: !flags.has("guest") && !flags.has("authloading"),
    isLoading: flags.has("authloading"),
  };
}
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  const name = getFunctionName(ref),
    signature = JSON.stringify(args);
  useEffect(() => {
    const requestedArgs: unknown = JSON.parse(signature);
    if (requestedArgs !== "skip") {
      if (name !== "forum:listMyThreadBookmarks")
        throw Error(`Unexpected private query ${name}`);
      reads.push({ name, args: requestedArgs });
    }
  }, [name, signature]);
  if (args === "skip" || flags.has("loading")) return undefined;
  return { threads: flags.has("empty") ? [] : threads };
}
export function useMutation(ref: FunctionReference<"mutation">) {
  return async (args: unknown) => {
    actions.push({ name: getFunctionName(ref), args });
    throw Error(
      "All mutation transports are blocked in the local filter fixture",
    );
  };
}
export function usePathname() {
  return "/saved";
}
export default function Link({
  prefetch: _prefetch,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) {
  return <a {...props} />;
}
export const ForumLink = Link;
export function ForumLoading({ label }: { label: string }) {
  return <p role="status">{label}</p>;
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
    <section className="forum-status-box">
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </section>
  );
}
export function reportAppError() {
  throw Error("Unexpected action error reporting in filter-only fixture");
}
