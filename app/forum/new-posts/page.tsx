import { ForumRecentThreadsPage } from "@/components/forum/forum-recent-threads-page";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New Posts",
  description:
    "Unread and new activity across the latest SYMBaiEX forum threads.",
  alternates: {
    canonical: "/new-posts",
  },
};

export default function ForumNewPostsRoute() {
  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-2" />
      <ForumRecentThreadsPage
        description="Unread and new activity across the SYMBaiEX forum, ordered by the latest reply."
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        mode="new"
        title="New Posts"
      />
    </section>
  );
}
