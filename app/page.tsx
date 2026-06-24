import { AsciiSection } from "@/components/ascii-section";
import { DailyNewsList } from "@/components/daily-news-list";
import { EntryRow } from "@/components/entry-row";
import { SectionHeader } from "@/components/section-header";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";
import { getFeaturedPost } from "@/lib/blog-data";
import { getDailyNews } from "@/lib/news-data";
import Link from "next/link";

export default async function HomePage() {
  const [featured, dailyNews] = await Promise.all([
    getFeaturedPost(),
    getDailyNews(5),
  ]);

  return (
    <SiteShell>
      <section>
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
          </div>
        </div>
      </section>

      <AsciiSection />

      <section className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24">
        <SectionHeader title="Latest blog" divided={false} />
        <div className="mt-8">
          {featured ? (
            <EntryRow post={featured} divided={false} compact />
          ) : (
            <div className="border-y border-row-border py-6 font-mono text-xs uppercase text-muted-foreground">
              No published posts yet.
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 md:px-8 md:pb-24">
        <SectionHeader title="daily news" divided={false} />
        <div className="mt-6">
          <DailyNewsList stories={dailyNews} />
        </div>
        <div className="mt-5">
          <Button asChild variant="outline">
            <Link href="/news">Open today&apos;s index</Link>
          </Button>
        </div>
      </section>
    </SiteShell>
  );
}
