import type { Metadata } from "next";
import { FORUM_SITE_URL } from "@/lib/site-urls";

export const metadata: Metadata = {
  metadataBase: new URL(FORUM_SITE_URL),
};

export default function ForumLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="forum-surface">{children}</div>;
}
