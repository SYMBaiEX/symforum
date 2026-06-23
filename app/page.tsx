import { AsciiSection } from "@/components/ascii-section";
import { EntryRow } from "@/components/entry-row";
import { SectionHeader } from "@/components/section-header";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";
import { blogPosts } from "@/lib/content";
import Link from "next/link";

export default function HomePage() {
  const featured = blogPosts.find((post) => post.featured) ?? blogPosts[0];

  return (
    <SiteShell>
      <section className="swiss-grid border-b border-row-border">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-12 md:px-8 md:py-24">
          <div className="md:col-span-10">
            <p className="mb-6 font-mono text-xs uppercase text-muted-foreground">
              Software / AI systems / internet craft
            </p>
            <h1 className="max-w-5xl break-words text-6xl font-bold leading-[0.9] text-balance md:text-8xl lg:text-9xl">
              Hi, I&apos;m Austin Hamilton (&quot;SYMBiEX&quot;)
            </h1>
            <p className="mt-8 max-w-2xl text-xl leading-8 text-muted-foreground">
              I build sharp software, agentic systems, and public notebooks for
              the strange edges where engineering, taste, and automation meet.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/blog">Read blog</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/news">Latest news</Link>
              </Button>
            </div>
            <div className="mt-12 grid max-w-2xl grid-cols-3 border-y border-row-border py-4 font-mono text-xs uppercase text-muted-foreground">
              <span>Convex state</span>
              <span>Vercel deploy</span>
              <span>Geist type</span>
            </div>
          </div>
        </div>
      </section>

      <AsciiSection />

      <section className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24">
        <SectionHeader kicker="Featured" title="Latest essay">
          A working archive for design systems, AI engineering, and personal web
          experiments.
        </SectionHeader>
        <div className="mt-8">
          <EntryRow post={featured} />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 md:px-8 md:pb-24">
        <SectionHeader kicker="Dispatch" title="Indexed news layer">
          Hacker News supplies the daily source list; this site owns the reader
          route, voting, saves, and comments.
        </SectionHeader>
        <div className="mt-8 border-y border-row-border py-6">
          <Button asChild variant="outline">
            <Link href="/news">Open today&apos;s index</Link>
          </Button>
        </div>
      </section>
    </SiteShell>
  );
}
