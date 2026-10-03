import { ForumPageHeader } from "@/components/forum/forum-layout-primitives";
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
    <section className="page-frame page-frame-dense forum-workspace space-y-4">
      <StructuredData
        data={forumCollectionStructuredData(
          "Forum Announcements",
          "Announcements and board notices for the SYMBaiEX forum.",
          "/announcements",
        )}
      />
      <ForumUtilityNav className="mb-2" />
      <ForumPageHeader
        title="Announcements"
        description="Forum updates and notices from the team."
      />
      <ForumAnnouncementsPage
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
      />
    </section>
  );
}
