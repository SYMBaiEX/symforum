import { BlogPostFilter } from "@/components/blog-post-filter";
import { EntryRow } from "@/components/entry-row";
import { SectionHeader } from "@/components/section-header";
import { getPublishedPosts } from "@/lib/blog-data";
import { primarySiteUrl } from "@/lib/site-urls";
import type { Metadata } from "next";

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

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string | string[] }>;
}) {
  const posts = await getPublishedPosts();
  const requestedTag = (await searchParams).tag;
  const tagCounts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) {
      if (tag) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
  }
  const tags = Array.from(tagCounts, ([name, count]) => ({ count, name })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  const requestedTagValue =
    typeof requestedTag === "string" ? requestedTag : undefined;
  const selectedTag = tagCounts.has(requestedTagValue ?? "")
    ? requestedTagValue
    : undefined;
  const visiblePosts = selectedTag
    ? posts.filter((post) => post.tags.includes(selectedTag))
    : posts;

  return (
    <>
      <section className="page-frame page-frame-spacious">
        <SectionHeader title="All posts" headingLevel="h1" divided={false} />
        <div className="mt-8">
          {posts.length === 0 ? (
            <div className="py-6 font-mono text-xs uppercase text-muted-foreground">
              No published posts yet.
            </div>
          ) : (
            <>
              <BlogPostFilter
                tags={tags}
                selectedTag={selectedTag}
                totalPosts={posts.length}
              />
              <div>
                {visiblePosts.map((post, index) => (
                  <EntryRow
                    key={post.slug}
                    post={post}
                    divided={false}
                    compact
                    priority={index === 0}
                    headingLevel="h2"
                  />
                ))}
              </div>
              {/* 50 mirrors the .take(50) cap in convex/posts.ts listPublished */}
              {posts.length >= 50 && (
                <div className="mt-6 font-mono text-[10px] uppercase text-muted-foreground">
                  Showing the latest 50 posts
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
