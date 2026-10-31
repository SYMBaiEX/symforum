// URL routing and public records are local inventions. No provider/client exists.
import { useMemo, useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => location.href;
const scenario = new URLSearchParams(location.search).get("scenario");
export const state = {
  reads: [] as { name: string; args: Record<string, unknown> }[],
  routes: [] as { mode: string; href: string; options: unknown }[],
  forbidden: [] as string[],
};
Object.assign(window, { __memberControls: state });
function navigate(mode: "push" | "replace", href: string, options: unknown) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || url.pathname !== "/forum/members") {
    state.forbidden.push(href);
    throw new Error("Forbidden fixture route");
  }
  state.routes.push({ mode, href, options });
  if (mode === "push") history.pushState(null, "", href);
  else history.replaceState(null, "", href);
  listeners.forEach((listener) => listener());
}
const router = {
  push: (href: string, options: unknown) => navigate("push", href, options),
  replace: (href: string, options: unknown) =>
    navigate("replace", href, options),
};
export function useRouter() {
  return router;
}
export function usePathname() {
  return new URL(useSyncExternalStore(subscribe, snapshot)).pathname;
}
export function useSearchParams() {
  const href = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => new URL(href).searchParams, [href]);
}
const members = Array.from({ length: 105 }, (_, index) => ({
  _id: `fixture-member-${index}`,
  username: index === 0 ? "Alice_Builder" : `fixture_${index}`,
  displayName: index === 0 ? "Alice Builder" : `Fixture Member ${index}`,
  avatarUrl: undefined,
  rank: "Member",
  customTitle: null,
  location: null,
  isOnline: false,
  onlineLocation: null,
  postCount: 105 - index,
  threadCount: 1,
  reputationScore: 2,
  joinedAt: 1609459200000 + index,
}));
export function useQuery(
  ref: FunctionReference<"query">,
  args: { page: number; pageSize: number; query?: string; sortKey: string },
) {
  const name = getFunctionName(ref);
  if (name !== "forum:listMembers") {
    state.forbidden.push(name);
    throw new Error(`Forbidden fixture query ${name}`);
  }
  if (
    !state.reads.some(
      (read) => JSON.stringify(read.args) === JSON.stringify(args),
    )
  )
    state.reads.push({ name, args });
  if (scenario === "loading") return undefined;
  const rows =
    scenario === "empty"
      ? []
      : members.filter(
          (member) =>
            !args.query ||
            `${member.username} ${member.displayName}`
              .toLowerCase()
              .includes(args.query.toLowerCase()),
        );
  const totalPages = Math.max(1, Math.ceil(rows.length / args.pageSize));
  const page = Math.min(args.page, totalPages),
    start = (page - 1) * args.pageSize;
  return {
    members: rows.slice(start, start + args.pageSize),
    pagination: {
      page,
      pageSize: args.pageSize,
      totalPages,
      totalItems: rows.length,
      startItem: rows.length ? start + 1 : 0,
      endItem: Math.min(start + args.pageSize, rows.length),
      limited: false,
    },
    limited: false,
    filters: { query: args.query ?? "", sortKey: args.sortKey },
  };
}
export function useConvexAuth() {
  state.forbidden.push("auth");
  throw new Error("Forbidden fixture auth");
}
export function useConvex() {
  state.forbidden.push("client");
  throw new Error("Forbidden fixture client");
}
export function useMutation() {
  state.forbidden.push("mutation");
  throw new Error("Forbidden fixture mutation");
}
export function useAction() {
  state.forbidden.push("action");
  throw new Error("Forbidden fixture action");
}
export function redirect() {
  state.forbidden.push("redirect");
  throw new Error("Forbidden fixture redirect");
}
