import { ForumSearchPage } from "@/components/forum/forum-search-page";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forum Search",
  description: "Search public SYMBaiEX forum threads and replies.",
  alternates: {
    canonical: "/search",
  },
};

export default function ForumSearchRoute() {
  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-3" />
      <ForumSearchPage enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
