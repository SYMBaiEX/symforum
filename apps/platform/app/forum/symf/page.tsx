import { installation } from "@/lib/installation";
import { SYMF_TOKEN } from "@/lib/symf-token";
import type { Metadata } from "next";
import { ForumSymf } from "@/components/forum/forum-symf";
import { forumSiteUrl } from "@/lib/site-urls";

const title = `$${SYMF_TOKEN.symbol} | ${installation.name}`;
const description =
  `Explore the official ${installation.name} token on Solana: live candles from 1 minute to 4 hours, market cap, liquidity, volume and recent buys and sells.`;
const socialImage = {
  url: forumSiteUrl("/images/social/symf-token-v1.png"),
  width: 1200,
  height: 630,
  alt: `$${SYMF_TOKEN.symbol}, the ${installation.name} community token on Solana. Live chart, market cap and recent trades.`,
};

export const metadata: Metadata = {
  title: `$${SYMF_TOKEN.symbol} token`,
  description,
  alternates: { canonical: forumSiteUrl("/symf") },
  openGraph: {
    title,
    description,
    url: forumSiteUrl("/symf"),
    siteName: installation.name,
    type: "website",
    locale: "en_US",
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    site: installation.x.accounts.symforum ? `@${installation.x.accounts.symforum}` : undefined,
    creator: installation.x.accounts.symforum ? `@${installation.x.accounts.symforum}` : undefined,
    title,
    description,
    images: [socialImage],
  },
};

export default function ForumSymfPage() {
  return (
    <section className="page-frame page-frame-dense">
      <ForumSymf />
    </section>
  );
}
