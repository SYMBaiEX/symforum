import { NoScriptFallback } from "@/components/no-script-fallback";
import { renderAiReadablePage } from "@/lib/ai-readable";
import { isForumSubdomainHost } from "@/lib/forum-subdomain-routing";
import type { Metadata } from "next";
import { FORUM_SITE_URL } from "@/lib/site-urls";
import { headers } from "next/headers";

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

export default async function ForumLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  const requestPath = requestHeaders.get("x-symbaiex-pathname") ?? "/forum";
  const host = requestHeaders.get("host");
  const forumPath = isForumSubdomainHost(host)
    ? requestPath === "/"
      ? "/forum"
      : `/forum${requestPath}`
    : requestPath;
  const fallback = await renderAiReadablePage({ pathname: forumPath, host });
  return (
    <div className="forum-surface">
      {fallback ? <NoScriptFallback content={fallback.markdown} /> : null}
      {children}
    </div>
  );
}
