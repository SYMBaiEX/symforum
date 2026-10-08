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
      <header className="mb-3 border-b border-row-border pb-3">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          SYMBaiEX forum
        </p>
        <h1 className="mt-1 text-2xl font-semibold leading-tight">
          A useful place to think in public
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          Public discussion for software, AI systems, open source, and adjacent
          experiments.
        </p>
      </header>
      <ForumUtilityNav className="mb-2" />
      <ForumIndex enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
