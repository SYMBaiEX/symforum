import { ForumIndex } from "@/components/forum/forum-index";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { StructuredData } from "@/components/structured-data";
import type { Metadata } from "next";
import { breadcrumbStructuredData } from "@/lib/seo";
import { forumSiteUrl } from "@/lib/site-urls";

export const metadata: Metadata = {
  title: "SYMBaiEX forum",
  description: "Public board index for the SYMBaiEX forum.",
  alternates: {
    canonical: "/",
  },
};

export default function ForumPage() {
  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={[
          {
            "@type": "DiscussionForumPosting",
            headline: "SYMBaiEX forum",
            description:
              "A public discussion board for software, AI systems, open source, and adjacent experiments.",
            url: forumSiteUrl("/"),
          },
          breadcrumbStructuredData([{ name: "Forum", url: forumSiteUrl("/") }]),
        ]}
      />
      <ForumUtilityNav className="mb-2" />
      <ForumIndex enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
