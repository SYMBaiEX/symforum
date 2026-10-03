import { ForumPageHeader } from "@/components/forum/forum-layout-primitives";
import { ForumOnlinePage } from "@/components/forum/forum-online-page";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Who's Online",
  description: "Currently active registered members on the SYMBaiEX forum.",
  alternates: {
    canonical: "/online",
  },
};

export default function ForumOnlineRoute() {
  return (
    <section className="page-frame page-frame-dense forum-workspace space-y-4">
      <ForumUtilityNav className="mb-2" />
      <ForumPageHeader
        title="Active members"
        description="See who is here and what they are reading."
      />
      <ForumOnlinePage enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
