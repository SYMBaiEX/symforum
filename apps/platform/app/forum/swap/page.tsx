import type { Metadata } from "next";
import { StandaloneSwap } from "@/components/swap/token-swap";
import { forumSiteUrl } from "@/lib/site-urls";

export const metadata: Metadata = {
  title: "Swap tokens",
  description:
    "Compare Solana swap quotes on SYMBaiEX Forum, with wallet-approved transactions and transparent platform fees.",
  alternates: { canonical: forumSiteUrl("/swap") },
};
export default function SwapPage() {
  return (
    <section className="page-frame page-frame-dense">
      <StandaloneSwap enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
