import type { Metadata } from "next";
import { FORUM_SITE_URL } from "@/lib/site-urls";

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
  },
  twitter: {
    card: "summary",
    title: "SYMBaiEX forum",
    description:
      "A public discussion board for software, AI systems, open source, and adjacent experiments.",
  },
};

export default function ForumLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="forum-surface">{children}</div>;
}
