import { BlogPostFilter } from "@/components/blog-post-filter";
import { SectionHeader } from "@/components/section-header";
import { getPublishedPosts } from "@/lib/blog-data";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
};

export default async function BlogPage() {
  const posts = await getPublishedPosts();

  return (
    <>
      <section className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-24">
        <SectionHeader title="All posts" divided={false} />
        <div className="mt-8">
          <BlogPostFilter posts={posts} />
        </div>
      </section>
    </>
  );
}
