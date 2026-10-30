import type { Metadata } from "next";
import { ForumTerminal } from "@/components/trading/forum-terminal";
import { forumSiteUrl } from "@/lib/site-urls";

export const metadata: Metadata = {
  title: "Solana trading terminal",
  description:
    "Research Solana tokens, follow forum discussions, track your watchlist and compare wallet-approved swap routes on SYMBaiEX Forum.",
  alternates: { canonical: forumSiteUrl("/trade") },
};
export default function TradePage() {
  return (
    <section className="page-frame page-frame-dense">
      <ForumTerminal enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
