import { ForumControlPanel } from "@/components/forum/forum-control-panel";
import { ForumUserCpShell } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forum User CP",
  description: "Edit SYMBaiEX forum profile settings, titles, and signatures.",
  alternates: {
    canonical: "/control-panel",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function ForumControlPanelPage() {
  return (
    <main className="page-frame page-frame-dense">
      <ForumUserCpShell
        description="Profile, signature, and watched-thread tools for your forum account."
        title="Profile settings"
      >
        <ForumControlPanel
          enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        />
      </ForumUserCpShell>
    </main>
  );
}
