import { useCallback, useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { useMutation as useBaseMutation } from "./community-submissions-mocks";
export {
  useQuery,
  useConvex,
  useConvexAuth,
  useCommerceWallet,
  useCommerceIdentity,
  CommerceWalletProvider,
  CommerceWalletButton,
} from "./community-submissions-mocks";
const listeners = new Set<() => void>();
let mint = "So11111111111111111111111111111111111111112";
const operations: { name: string; args: Record<string, unknown> }[] = [],
  forbidden: string[] = [];
let createCompletion: { resolve(): void; reject(): void } | undefined;
export const fixture = {
  operations,
  forbidden,
  settleCreate(ok: boolean) {
    if (ok) createCompletion?.resolve();
    else createCompletion?.reject();
  },
  mint(next: string) {
    mint = next;
    listeners.forEach((listener) => listener());
  },
};
declare global {
  interface Window {
    workBriefFixture: typeof fixture;
  }
}
window.workBriefFixture = fixture;
export function useFixtureMint() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => mint,
  );
}
export function useMutation(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref),
    base = useBaseMutation(ref);
  return useCallback(
    async (args: Record<string, unknown>) => {
      operations.push({ name, args });
      if (name === "forumCommunity:claimBounty") return base(args);
      if (name === "forumCommunity:createBounty") {
        await new Promise<void>((resolve, reject) => {
          createCompletion = {
            resolve,
            reject: () =>
              reject({ data: "Invented creation failure; brief retained" }),
          };
        });
        return "invented-new-work";
      }
      forbidden.push(name);
      throw new Error("Only explicit inert create/save callbacks are allowed");
    },
    [name, base],
  );
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    forbidden.push(name);
    throw new Error("Provider, financial and wallet actions forbidden");
  }, [name]);
}
export function useSearchParams() {
  return new URLSearchParams(location.search);
}
export function usePathname() {
  return location.pathname;
}
