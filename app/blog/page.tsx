import { BlogPostFilter } from "@/components/blog-post-filter";
import { SectionHeader } from "@/components/section-header";
import { getPublishedPosts } from "@/lib/blog-data";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Essays and field notes by Austin Hamilton about software, AI systems, and engineering practice.",
  alternates: { canonical: "/blog" },
};

export default async function BlogPage() {
  const posts = await getPublishedPosts();

  return (
    <>
      <section className="page-frame page-frame-spacious">
        <SectionHeader title="All posts" divided={false} />
        <div className="mt-8">
          <Suspense fallback={null}>
            <BlogPostFilter posts={posts} />
          </Suspense>
        </div>
      </section>
    </>
  );
}
