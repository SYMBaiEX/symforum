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
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-2" />
      <ForumOnlinePage enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
