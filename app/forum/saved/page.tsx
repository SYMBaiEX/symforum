import { ForumSavedThreads } from "@/components/forum/forum-saved-threads";
import { ForumUserCpShell } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Saved Forum Threads",
  description: "Your private SYMBaiEX forum reading list.",
  alternates: {
    canonical: "/saved",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function ForumSavedThreadsPage() {
  return (
    <div className="page-frame page-frame-dense">
      <ForumUserCpShell
        description="Keep a private reading list without subscribing to reply notifications."
        title="Saved threads"
      >
        <ForumSavedThreads
          enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        />
      </ForumUserCpShell>
    </div>
  );
}
