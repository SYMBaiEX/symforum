import { ForumModerationPage } from "@/components/forum/forum-moderation-page";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forum Moderator CP",
  description:
    "Moderate SYMBaiEX forum reports, queues, warnings, and audit logs.",
  alternates: {
    canonical: "/moderation",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function ForumModerationRoute() {
  return (
    <div className="page-frame page-frame-dense">
      <ForumModerationPage
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
      />
    </div>
  );
}
