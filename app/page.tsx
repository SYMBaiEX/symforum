import { AsciiSection } from "@/components/ascii-section";
import { DailyNewsList } from "@/components/daily-news-list";
import { EntryRow } from "@/components/entry-row";
import { SectionHeader } from "@/components/section-header";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";
import { getFeaturedPost } from "@/lib/blog-data";
import { getDailyNews } from "@/lib/news-data";
import katex from "katex";
import Link from "next/link";

const identityEquation = katex.renderToString(
  '\\left(\\text{"}\\mathrm{SYMBiEX}\\text{"}\\right)\\;\\equiv\\;\\mathrm{Symbiosis}+\\mathrm{AI}+\\mathrm{Experiment}\\;\\rightarrow\\;\\mathrm{SYMBaiEX}',
  {
    throwOnError: false,
    output: "html",
  },
);

export default async function HomePage() {
  const [featured, dailyNews] = await Promise.all([
    getFeaturedPost(),
    getDailyNews(5),
  ]);

  return (
    <SiteShell>
      <section>
        <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-10">
          <h1 className="grid gap-4 break-words md:grid-cols-12 md:items-start">
            <span className="font-mono text-4xl font-semibold leading-none text-foreground md:col-span-12 md:text-6xl lg:text-7xl">
              Hi, I&apos;m
            </span>
            <span className="max-w-5xl text-5xl font-bold leading-[0.9] text-balance md:col-span-10 md:col-start-2 md:text-7xl lg:text-8xl">
              <span className="block">Austin</span>
              <span className="block pl-8 md:pl-20">Hamilton</span>
            </span>
          </h1>

          <div className="mt-4 grid gap-5 md:grid-cols-12 md:items-end">
            <div
              className="overflow-x-auto whitespace-nowrap text-[10px] font-normal leading-none text-foreground sm:text-xs md:col-span-10 md:col-start-2 md:text-xl"
              aria-label="SYMBiEX equals Symbiosis plus AI plus Experiment, making SYMBaiEX"
              dangerouslySetInnerHTML={{ __html: identityEquation }}
            />
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
        <SectionHeader title="Daily news" divided={false} />
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
