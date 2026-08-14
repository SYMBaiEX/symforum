import { BlogPostFilter } from "@/components/blog-post-filter";
import { SectionHeader } from "@/components/section-header";
import { getPublishedPosts } from "@/lib/blog-data";
import { primarySiteUrl } from "@/lib/site-urls";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Essays and field notes by Austin Hamilton about software, AI systems, and engineering practice.",
  alternates: { canonical: "/blog" },
  openGraph: {
    type: "website",
    url: primarySiteUrl("/blog"),
    title: "Blog",
    description:
      "Essays and field notes by Austin Hamilton about software, AI systems, and engineering practice.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX blog archive and source-grounded field notes.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "SYMBaIEX blog",
    description:
      "Essays and field notes by Austin Hamilton about software engineering, AI systems, and open-source work.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX blog archive and source-grounded field notes.",
      },
    ],
  },
};

export default async function BlogPage() {
  const posts = await getPublishedPosts();

  return (
    <>
      <section className="page-frame page-frame-spacious">
        <SectionHeader title="All posts" headingLevel="h1" divided={false} />
        <div className="mt-8">
          <Suspense fallback={null}>
            <BlogPostFilter posts={posts} />
          </Suspense>
        </div>
      </section>
    </>
  );
}
