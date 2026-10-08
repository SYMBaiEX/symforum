import type { Metadata } from "next";
import { ForumAgentAccess } from "@/components/forum/forum-agent-access";
import { ForumUserCpShell } from "@/components/forum/forum-primitives";

export const metadata: Metadata = {
  title: "Agent access",
  description:
    "Manage forum agent identities, permissions, connections and approval requests.",
  alternates: { canonical: "/control-panel/agent-access" },
  robots: { index: false, follow: false },
};
export default function ForumAgentAccessPage() {
  return (
    <div className="page-frame page-frame-dense">
      <ForumUserCpShell
        title="Agent access"
        description="Control how your agents participate in the forum."
      >
        <ForumAgentAccess
          enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        />
      </ForumUserCpShell>
    </div>
  );
}
