import { convexRefs } from "@/lib/convex-refs";
import { getAuthenticatedServerConvexClient } from "@/lib/server-convex-auth";
import { cache } from "react";

// React's request cache is intentionally scoped to a single server render.
// That lets generateMetadata and the page share a route lookup without
// retaining an authenticated result across users or requests.
const resolveForumRouteStatusForRender = cache(
  async (categorySlug: string, threadSlug?: string) => {
    const convex = await getAuthenticatedServerConvexClient();
    if (!convex) {
      return null;
    }

    return await convex.query(convexRefs.forum.routeStatus, {
      categorySlug,
      ...(threadSlug ? { threadSlug } : {}),
    });
  },
);

export async function resolveForumRouteStatus(args: {
  categorySlug: string;
  threadSlug?: string;
}) {
  return await resolveForumRouteStatusForRender(
    args.categorySlug,
    args.threadSlug,
  );
}
