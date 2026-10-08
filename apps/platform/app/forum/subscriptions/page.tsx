import type { Metadata } from "next";
import { ForumSubscriptions } from "@/components/forum/forum-subscriptions";
import { ForumUserCpShell } from "@/components/forum/forum-primitives";

export const metadata: Metadata = {
  title: "Forum Subscriptions",
  description: "Subscribed SYMBaiEX forum boards and threads.",
  alternates: {
    canonical: "/subscriptions",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function ForumSubscriptionsPage() {
  return (
    <div className="page-frame page-frame-dense">
      <ForumUserCpShell
        description="Review watched boards, watched threads, and unread forum notifications."
        title="Subscriptions"
      >
        <ForumSubscriptions
          enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        />
      </ForumUserCpShell>
    </div>
  );
}
