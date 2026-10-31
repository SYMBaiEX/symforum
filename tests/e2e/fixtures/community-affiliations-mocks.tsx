// Invented local UI records only. No auth, wallet, RPC or production transport.
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
import { SYMF_TOKEN } from "../../../lib/symf-token";

const parameters = new URLSearchParams(location.search);
let revision = 0;
let actor = parameters.has("guest") ? "guest" : "author";
let loading = parameters.has("identityloading");
const listeners = new Set<() => void>();
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const workStatuses: string[] = [];
const works = ["open", "cancelled"].map((status) => ({
  workId: `fixture-work-${status}`,
  sponsorId: "fixture-author",
  sponsor: "fixture_author",
  mint: null,
  kind: "research",
  title: `${status === "open" ? "Open" : "Cancelled"} fixture brief`,
  brief:
    "An invented brief with a bounded deliverable and clear acceptance criteria.",
  amountLamports: "10000000",
  status,
  selectedSubmissionId: null,
  updatedAt: 1,
}));
let finishResolve: (() => void) | undefined;
let project = {
  projectId: "fixture-project",
  mint: SYMF_TOKEN.mint,
  name: "Fixture project",
  symbol: "DEMO",
  claims: [
    {
      userId: "fixture-other",
      username: "fixture_other",
      role: "Other contributor",
      description: "Another contributor's invented public affiliation.",
      website: null as string | null,
      updatedAt: 1,
    },
    {
      userId: "fixture-author",
      username: "fixture_author",
      role: "Original researcher",
      description: "The author's invented original project affiliation.",
      website: "https://example.com/original",
      updatedAt: 1,
    },
  ],
};
const changed = () => {
  revision++;
  listeners.forEach((listener) => listener());
};
window.addEventListener("community-fixture:identity", (event) => {
  const detail = (event as CustomEvent<{ actor: string; loading?: boolean }>)
    .detail;
  actor = detail.actor;
  loading = detail.loading ?? false;
  changed();
});
window.addEventListener("community-fixture:resolve", () => finishResolve?.());
window.addEventListener("community-fixture:updated-claim", () => {
  project = {
    ...project,
    claims: project.claims.map((claim) => ({
      ...claim,
      role: "A newer server-side role",
    })),
  };
  changed();
});
Object.assign(window, {
  __communityFixtureCalls: calls,
  __communityFixtureWorkStatuses: workStatuses,
});
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => revision;

export function useConvexAuth() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return { isAuthenticated: actor !== "guest", isLoading: loading };
}
export function useQuery(reference: FunctionReference<"query">, args: unknown) {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  if (args === "skip") return undefined;
  const name = getFunctionName(reference);
  if (name === "forumCommunity:listProjects") return [project];
  if (name === "forumCommunity:listBounties") {
    const status = (args as { status: string }).status;
    workStatuses.push(status);
    if (status === "cancelled" && parameters.has("workloading"))
      return undefined;
    if (status === "cancelled" && parameters.has("workempty")) return [];
    return works.filter((work) => work.status === status);
  }
  if (name === "forumCommunity:listSubmissions") return [];
  if (name === "forumCommunity:getMine")
    return parameters.has("mineloading")
      ? undefined
      : { userId: `fixture-${actor}`, recipient: null, supporter: null };
  throw new Error(`Unexpected community fixture query: ${name}`);
}
export function useAction(reference: FunctionReference<"action">) {
  const name = getFunctionName(reference);
  return useCallback(
    async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name !== "forumCommerce:resolveMint")
        throw new Error(
          "No provider or payment action exists in this fixture.",
        );
      if (parameters.has("pendingresolve"))
        await new Promise<void>((resolve) => {
          finishResolve = resolve;
        });
      return { mint: args.mint };
    },
    [name],
  );
}
export function useMutation(reference: FunctionReference<"mutation">) {
  const name = getFunctionName(reference);
  return useCallback(
    async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name !== "forumCommunity:createProjectClaim")
        throw new Error("No payment mutation exists in this fixture.");
      if (parameters.has("saveerror"))
        throw { data: "The fixture rejected this affiliation. Try again." };
      project = {
        ...project,
        claims: project.claims.map((claim) =>
          claim.userId === `fixture-${actor}`
            ? {
                ...claim,
                role: String(args.role),
                description: String(args.description),
                website: args.website ? String(args.website) : null,
              }
            : claim,
        ),
      };
      changed();
      return project.projectId;
    },
    [name],
  );
}
const client = {} as CommerceWalletClient;
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  return {
    isAuthenticated,
    isLoading,
    linked: isAuthenticated && !isLoading,
    connected: isAuthenticated
      ? { account: { address: "11111111111111111111111111111111" } }
      : null,
    session: { authUserId: `fixture-${actor}`, wallets: [] },
  };
}
export function CommerceWalletButton({ disabled }: { disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled}>
      Fixture wallet
    </button>
  );
}
