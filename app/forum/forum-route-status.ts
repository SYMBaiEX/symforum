import { convexRefs } from "@/lib/convex-refs";
import { getAuthenticatedServerConvexClient } from "@/lib/server-convex-auth";

export async function resolveForumRouteStatus(args: {
  categorySlug: string;
  threadSlug?: string;
}) {
  const convex = await getAuthenticatedServerConvexClient();
  if (!convex) {
    return null;
  }

  return await convex.query(convexRefs.forum.routeStatus, args);
}
