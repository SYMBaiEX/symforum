import type { Metadata } from "next";
import { ForumSymf } from "@/components/forum/forum-symf";
import { forumSiteUrl } from "@/lib/site-urls";

const title = "$SYMF | SYMBaiEX Forum";
const description =
  "Explore the official SYMBaiEX Forum token on Solana: live candles from 1 minute to 4 hours, market cap, liquidity, volume and recent buys and sells.";
const socialImage = {
  url: forumSiteUrl("/images/social/symf-token-v1.png"),
  width: 1200,
  height: 630,
  alt: "$SYMF, the SYMBaiEX Forum community token on Solana. Live chart, market cap and recent trades, alongside the Forum's signal moth mascot.",
};

export const metadata: Metadata = {
  title: "$SYMF token",
  description,
  alternates: { canonical: forumSiteUrl("/symf") },
  openGraph: {
    title,
    description,
    url: forumSiteUrl("/symf"),
    siteName: "SYMBaiEX Forum",
    type: "website",
    locale: "en_US",
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    site: "@symforum",
    creator: "@symforum",
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
