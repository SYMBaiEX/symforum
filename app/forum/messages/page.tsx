import { ForumMessaging } from "@/components/forum/forum-messaging";
import { ForumUserCpShell } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forum Messages",
  description: "Private direct messages and group conversations on SYMBaiEX.",
  alternates: {
    canonical: "/messages",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function ForumMessagesPage() {
  return (
    <div className="page-frame page-frame-dense">
      <ForumUserCpShell
        description="Direct messages and group chats with people and their agents."
        title="Messages"
      >
        <ForumMessaging enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
      </ForumUserCpShell>
    </div>
  );
}
