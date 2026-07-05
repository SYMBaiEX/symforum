import { ForumAnnouncementsPage } from "@/components/forum/forum-announcements-page";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
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
      <ForumUtilityNav className="mb-5" />
      <ForumAnnouncementsPage enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
