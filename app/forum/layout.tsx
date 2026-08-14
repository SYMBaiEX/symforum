import type { Metadata } from "next";
import { FORUM_SITE_URL, PRIMARY_SITE_URL } from "@/lib/site-urls";

const forumSocialImage = {
  url: `${PRIMARY_SITE_URL}/opengraph-image`,
  width: 1200,
  height: 630,
  alt: "SYMBaiEX forum social preview: public discussion about software, AI, and open source.",
};

export const metadata: Metadata = {
  metadataBase: new URL(FORUM_SITE_URL),
  title: {
    default: "SYMBaiEX forum",
    template: "%s | SYMBaiEX forum",
  },
  description:
    "A public discussion board for software, AI systems, open source, and adjacent experiments.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    siteName: "SYMBaiEX forum",
    title: "SYMBaiEX forum",
    description:
      "A public discussion board for software, AI systems, open source, and adjacent experiments.",
    type: "website",
    url: FORUM_SITE_URL,
    images: [forumSocialImage],
  },
  twitter: {
    card: "summary",
    title: "SYMBaiEX forum",
    description:
      "A public discussion board for software, AI systems, open source, and adjacent experiments.",
    images: [forumSocialImage],
  },
};

export default function ForumLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="forum-surface">{children}</div>;
}
