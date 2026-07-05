import { ForumMessages } from "@/components/forum/forum-messages";
import { ForumUserCpShell } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forum Private Messages",
  description: "Read and send SYMBaiEX forum private messages.",
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
    <main className="page-frame page-frame-dense">
      <ForumUserCpShell
        description="Inbox, sent messages, subscriptions, and profile controls for your forum account."
        title="Private messages"
      >
        <ForumMessages enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
      </ForumUserCpShell>
    </main>
  );
}
