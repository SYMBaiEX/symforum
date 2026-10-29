// Only the Convex boundary is isolated. Better Auth's real client, focus
// manager, session atom and refetch logic execute in the browser tests.
import { identityClient } from "../../../packages/auth/src/identity-client";
const ensure = async () => ({});
export function useMutation() {
  return ensure;
}
export function useConvexAuth() {
  const session = identityClient.useSession();
  return {
    isLoading: session.isPending,
    isAuthenticated: !!session.data?.session,
  };
}
