import type { Metadata } from "next";
import { Suspense } from "react";
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
    <section
      className="page-frame page-frame-dense"
      data-forum-layout="terminal"
    >
      <Suspense
        fallback={
          <p role="status" className="p-4 text-sm text-muted-foreground">
            Loading trading terminal…
          </p>
        }
      >
        <TerminalPage enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
      </Suspense>
    </section>
  );
}
