import { ForumControlPanel } from "@/components/forum/forum-control-panel";
import { ForumUserCpShell } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile settings",
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
    <div className="page-frame page-frame-dense">
      <ForumUserCpShell
        description="Your identity, signature, notifications and community preferences."
        title="Profile settings"
      >
        <ForumControlPanel
          enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        />
      </ForumUserCpShell>
    </div>
  );
}
