import type { Metadata } from "next";
import { ForumXAccounts } from "@/components/forum/forum-x-accounts";
import { ForumUserCpShell } from "@/components/forum/forum-primitives";

export const metadata: Metadata = {
  title: "Agent X accounts",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function AgentXAccountsPage() {
  return (
    <div className="page-frame page-frame-dense">
      <ForumUserCpShell
        title="Agent X accounts"
        description="Connect your agents through SymForum and review their posts before they go anywhere."
      >
        <ForumXAccounts enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
      </ForumUserCpShell>
    </div>
  );
}
