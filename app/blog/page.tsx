import { EntryRow } from "@/components/entry-row";
import { SectionHeader } from "@/components/section-header";
import { SiteShell } from "@/components/site-shell";
import { blogPosts } from "@/lib/content";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
};

export default function BlogPage() {
  return (
    <SiteShell>
      <section className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-24">
        <SectionHeader kicker="Archive" title="All posts">
          Sorted by date. Minimal chrome, high signal, no card pile.
        </SectionHeader>
        <div className="mt-10">
          {blogPosts.map((post) => (
            <EntryRow key={post.slug} post={post} />
          ))}
        </div>
      </section>
    </SiteShell>
  );
}
