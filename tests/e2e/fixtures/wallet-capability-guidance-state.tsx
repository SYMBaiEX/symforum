// Invented read-only state. Never connects to Convex or a provider.
import { useCallback } from "react";
import {
  getFunctionName,
  type FunctionReference,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import { useQuery as terminalQuery } from "./terminal-convex";
export { useConvexAuth } from "./terminal-convex";

export const parameters = new URLSearchParams(location.search);
export const calls: string[] = [];
Object.assign(window, { __capabilityCalls: calls });
const session = {
  authUserId: "fixture-user",
  wallets: parameters.has("unlinked")
    ? []
    : ["11111111111111111111111111111111"],
};
export function useQuery<Ref extends FunctionReference<"query">>(
  ref: Ref,
  args: FunctionArgs<Ref> | "skip",
): FunctionReturnType<Ref> | undefined {
  // Always call the same hook, including skipped queries and fixture overrides.
  const name = getFunctionName(ref);
  const value = terminalQuery(
    ref,
    name === "forumCommerce:getWalletSession" ? "skip" : args,
  );
  if (args === "skip") return undefined;
  if (name === "forumCommerce:getWalletSession")
    return (
      parameters.has("sessionloading") ? undefined : session
    ) as FunctionReturnType<Ref>;
  if (name === "forumCommerce:getConfig" && value)
    return { ...value, signatureFirstEnabled: !parameters.has("sendlane") };
  return value;
}
export function useMutation<Ref extends FunctionReference<"mutation">>(
  ref: Ref,
) {
  const name = getFunctionName(ref);
  return useCallback(
    async (_args: FunctionArgs<Ref>): Promise<FunctionReturnType<Ref>> => {
      calls.push(`mutation:${name}`);
      // Existing held controller's admission is observable but has no backend.
      if (name === "forumSwapRecovery:ensure")
        return null as FunctionReturnType<Ref>;
      throw new Error(`Denied fixture mutation: ${name}`);
    },
    [name],
  );
}
export function useAction<Ref extends FunctionReference<"action">>(ref: Ref) {
  const name = getFunctionName(ref);
  return useCallback(
    async (_args: FunctionArgs<Ref>): Promise<FunctionReturnType<Ref>> => {
      calls.push(`action:${name}`);
      throw new Error(`Denied fixture action: ${name}`);
    },
    [name],
  );
}
