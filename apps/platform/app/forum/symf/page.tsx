import type { Metadata } from "next";
import { ForumSymf } from "@/components/forum/forum-symf";
import { forumSiteUrl } from "@/lib/site-urls";

export const metadata: Metadata = {
  title: "$SYMF token",
  description:
    "The official SYMBaiEX Forum token on Solana. View the live chart, verify the mint and find the community links.",
  alternates: { canonical: forumSiteUrl("/symf") },
  openGraph: { title: "$SYMF | SYMBaiEX Forum", url: forumSiteUrl("/symf") },
};

export default function ForumSymfPage() {
  return (
    <section className="page-frame page-frame-dense">
      <ForumSymf />
    </section>
  );
}
