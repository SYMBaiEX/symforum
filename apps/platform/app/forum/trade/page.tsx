import type { Metadata } from "next";
import { TerminalPage } from "@/components/trading/terminal-page";
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
      <TerminalPage enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
