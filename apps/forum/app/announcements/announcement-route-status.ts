import { convexRefs } from "@/lib/convex-refs";
import { getAuthenticatedServerConvexClient } from "@/lib/server-convex-auth";

export async function resolveForumAnnouncementRouteStatus({
  board,
  slug,
}: {
  board?: string;
  slug: string;
}) {
  const convex = await getAuthenticatedServerConvexClient();
  if (!convex) {
    return null;
  }

  return await convex.query(convexRefs.forum.getAnnouncement, {
    slug,
    ...(board ? { categorySlug: board } : {}),
  });
}

export function forumAnnouncementCanonicalPath(slug: string, board?: string) {
  const encodedSlug = encodeURIComponent(slug);
  if (!board) {
    return `/announcements/${encodedSlug}`;
  }
  return `/announcements/${encodedSlug}?board=${encodeURIComponent(board)}`;
}
