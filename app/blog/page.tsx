import { EntryRow } from "@/components/entry-row";
import { SectionHeader } from "@/components/section-header";
import { SiteShell } from "@/components/site-shell";
import { getPublishedPosts } from "@/lib/blog-data";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
};

export default async function BlogPage() {
  const posts = await getPublishedPosts();

  return (
    <SiteShell>
      <section className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-24">
        <SectionHeader kicker="Archive" title="All posts">
          Sorted by date. Minimal chrome, high signal, no card pile.
        </SectionHeader>
        <div className="mt-10">
          {posts.map((post) => (
            <EntryRow key={post.slug} post={post} />
          ))}
          {posts.length === 0 ? (
            <div className="border-y border-row-border py-6 font-mono text-xs uppercase text-muted-foreground">
              No published posts yet.
            </div>
          ) : null}
        </div>
      </section>
    </SiteShell>
  );
}
