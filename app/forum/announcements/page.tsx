import { ForumAnnouncementsPage } from "@/components/forum/forum-announcements-page";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { StructuredData } from "@/components/structured-data";
import { forumCollectionStructuredData } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forum Announcements",
  description: "Announcements and board notices for the SYMBaiEX forum.",
  alternates: {
    canonical: "/announcements",
  },
};

export default function ForumAnnouncementsRoute() {
  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={forumCollectionStructuredData(
          "Forum Announcements",
          "Announcements and board notices for the SYMBaiEX forum.",
          "/announcements",
        )}
      />
      <ForumUtilityNav className="mb-2" />
      <header className="border-y border-row-border py-2">
        <p className="page-kicker">Forum bulletin</p>
        <h1 className="mt-1 text-xl font-semibold md:text-2xl">
          Announcements
        </h1>
      </header>
      <ForumAnnouncementsPage
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
      />
    </section>
  );
}
