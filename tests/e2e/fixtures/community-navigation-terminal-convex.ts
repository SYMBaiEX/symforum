import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
} from "convex/server";
import * as original from "./terminal-convex";
export {
  useAction,
  useMutation,
  useConvexAuth,
  useConvex,
} from "./terminal-convex";
const communityMints: unknown[] = [];
Object.assign(window, { communityTerminalMints: communityMints });
export function useQuery<Ref extends FunctionReference<"query">>(
  reference: Ref,
  args: FunctionArgs<Ref> | "skip",
) {
  if (
    ["forumCommunity:listProjects", "forumCommunity:listProjectPage"].includes(
      getFunctionName(reference),
    ) &&
    args !== "skip"
  )
    communityMints.push((args as { mint?: string }).mint);
  return original.useQuery(reference, args);
}
