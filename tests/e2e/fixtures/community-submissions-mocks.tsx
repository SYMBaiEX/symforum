import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";

let revision = 0;
let actor = "contributor";
let loading = false;
let workId = "work-one";
let pendingSave: { resolve: () => void; reject: () => void } | undefined;
let publishSaved: (() => void) | undefined;
const parameters = new URLSearchParams(location.search);
const listeners = new Set<() => void>();
const calls: { name: string; args: Record<string, unknown> }[] = [];
const queries: string[] = [];
const submissions = new Map<
  string,
  { url: string; summary: string; submittedAt: number }
>([
  [
    "work-one:contributor",
    {
      url: "https://example.com/original",
      summary: "Original privately submitted research summary.",
      submittedAt: 1_700_000_000_000,
    },
  ],
  [
    "work-one:other",
    {
      url: "https://example.com/other",
      summary: "A separate account's private saved deliverable.",
      submittedAt: 1_700_000_000_100,
    },
  ],
]);
function change() {
  revision++;
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
function useRevision() {
  useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );
}
window.addEventListener("submissions:identity", (event) => {
  const value = (event as CustomEvent<{ actor: string; loading?: boolean }>)
    .detail;
  actor = value.actor;
  loading = value.loading ?? false;
  change();
});
window.addEventListener("submissions:work", () => {
  workId = workId === "work-one" ? "work-two" : "work-one";
  change();
});
window.addEventListener("submissions:update", () => {
  submissions.set(`${workId}:${actor}`, {
    url: "https://example.com/remote",
    summary: "A newer remote saved deliverable; never replace a dirty draft.",
    submittedAt: 1_700_000_100_000,
  });
  change();
});
window.addEventListener("submissions:finish", (event) => {
  if ((event as CustomEvent<boolean>).detail) pendingSave?.resolve();
  else pendingSave?.reject();
});
Object.assign(window, { submissionCalls: calls, submissionQueries: queries });
window.addEventListener("submissions:publish", () => publishSaved?.());
export function useConvexAuth() {
  useRevision();
  return { isAuthenticated: actor !== "guest", isLoading: loading };
}
export function useQuery(reference: FunctionReference<"query">, args: unknown) {
  useRevision();
  if (args === "skip") return undefined;
  const name = getFunctionName(reference);
  queries.push(name);
  if (name === "forumCommunity:listProjects") return [];
  if (name === "forumCommunity:getMine")
    return loading
      ? undefined
      : { userId: actor, recipient: null, supporter: null };
  if (name === "forumCommunity:listBounties")
    return (args as { status: string }).status === "open"
      ? [
          {
            workId,
            sponsorId: "sponsor",
            sponsor: "sponsor",
            kind: "research",
            title: `Research brief ${workId}`,
            brief:
              "Produce a useful public resource with clearly defined acceptance criteria.",
            amountLamports: "10000000",
            status: "open",
            mint: null,
            selectedSubmissionId: null,
            updatedAt: 1,
          },
        ]
      : [];
  if (name === "forumCommunity:listSubmissions") {
    if (loading || parameters.has("rowsloading")) return undefined;
    const row = submissions.get(`${workId}:${actor}`);
    return row
      ? [
          {
            ...row,
            authorId: actor,
            username: actor,
            submissionId: `${workId}-${actor}`,
          },
        ]
      : [];
  }
  throw new Error(`Unexpected query: ${name}`);
}
export function useMutation(reference: FunctionReference<"mutation">) {
  const name = getFunctionName(reference);
  return useCallback(
    async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name !== "forumCommunity:claimBounty")
        throw new Error("Financial and unrelated mutations are forbidden");
      const owner = actor;
      const publish = () => {
        submissions.set(`${args.workId}:${owner}`, {
          url: String(args.url),
          summary: String(args.summary),
          submittedAt: 1_700_000_200_000,
        });
        change();
      };
      if (parameters.has("querybefore")) publish();
      if (
        parameters.has("pending") ||
        parameters.has("querybefore") ||
        parameters.has("queryafter")
      )
        await new Promise<void>((resolve, reject) => {
          pendingSave = {
            resolve,
            reject: () =>
              reject({
                data: "Fixture save unavailable. Your draft is retained.",
              }),
          };
        });
      if (parameters.has("error"))
        throw { data: "Fixture save unavailable. Your draft is retained." };
      if (parameters.has("queryafter")) publishSaved = publish;
      else if (!parameters.has("querybefore")) publish();
      return `${args.workId}-${owner}`;
    },
    [name],
  );
}
export function useAction() {
  return async () => {
    throw new Error("Provider and payment actions are forbidden");
  };
}
const client = {} as CommerceWalletClient;
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  const auth = useConvexAuth();
  return {
    ...auth,
    linked: auth.isAuthenticated && !loading,
    connected: null,
    session: null,
  };
}
export function CommerceWalletButton() {
  return <button type="button">Fixture wallet</button>;
}
