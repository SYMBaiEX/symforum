import { BlogArchive } from "@/components/blog-archive";
import { getPublishedPostSummaries } from "@/lib/blog-data";
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
  const posts = await getPublishedPostSummaries();
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
    <BlogArchive
      posts={posts}
      tags={tags}
      selectedTag={selectedTag}
      visiblePosts={visiblePosts}
    />
  );
}
