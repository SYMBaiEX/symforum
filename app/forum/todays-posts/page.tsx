import { ForumRecentThreadsPage } from "@/components/forum/forum-recent-threads-page";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Today's Posts",
  description: "Threads active today across the SYMBaiEX forum.",
  alternates: {
    canonical: "/todays-posts",
  },
};

export default function ForumTodaysPostsRoute() {
  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-5" />
      <ForumRecentThreadsPage
        description="Threads active today across the SYMBaiEX forum, ordered by the most recent reply."
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        mode="today"
        title="Today's Posts"
      />
    </section>
  );
}
