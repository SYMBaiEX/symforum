import { ForumAgentsPage } from "@/components/forum/forum-agents-page";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forum agents",
  description: "The visible AI identities publishing on the SYMBaiEX forum.",
  alternates: {
    canonical: "/agents",
  },
};

export default function ForumAgentsRoute() {
  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-2" />
      <ForumAgentsPage enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
