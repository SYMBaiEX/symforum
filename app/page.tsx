import { DailyNewsList } from "@/components/daily-news-list";
import { EntryRow } from "@/components/entry-row";
import { HomeBanner } from "@/components/home-banner";
import { SectionHeader } from "@/components/section-header";
import { Button } from "@/components/ui/button";
import { getLatestPosts } from "@/lib/blog-data";
import { getDailyNews } from "@/lib/news-data";
import katex from "katex";
import Link from "next/link";
import { Suspense } from "react";

const identityEquation = katex.renderToString(
  '\\left(\\text{"}\\mathrm{SYMBiEX}\\text{"}\\right)\\;\\equiv\\;\\mathrm{Symbiosis}+\\mathrm{AI}+\\mathrm{Experiment}\\;\\rightarrow\\;\\mathrm{SYMBaiEX}',
  {
    throwOnError: false,
    output: "html",
  },
);

export default function HomePage() {
  return (
    <>
      <HomeIntro />
      <HomeBanner />
      <Suspense fallback={<HomeContentFallback />}>
        <HomeContent />
      </Suspense>
    </>
  );
}

function HomeIntro() {
  return (
    <section>
      <div className="page-frame page-frame-dense">
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
            role="img"
            className="overflow-x-auto whitespace-nowrap text-[10px] font-normal leading-none text-foreground sm:text-xs md:col-span-10 md:col-start-2 md:text-xl"
            aria-label="SYMBiEX equals Symbiosis plus AI plus Experiment, making SYMBaiEX"
            dangerouslySetInnerHTML={{ __html: identityEquation }}
          />
        </div>
      </div>
    </section>
  );
}

async function HomeContent() {
  const [latestPosts, dailyNews] = await Promise.all([
    getLatestPosts(5),
    getDailyNews(5),
  ]);

  return (
    <>
      <section className="page-frame page-frame-spacious">
        <SectionHeader title="Latest Blogs" divided={false} />
        <div className="mt-8">
          {latestPosts.length > 0 ? (
            latestPosts.map((post, index) => (
              <EntryRow
                key={post.slug}
                post={post}
                divided={index > 0}
                compact
              />
            ))
          ) : (
            <div className="border-y border-row-border py-6 font-mono text-xs uppercase text-muted-foreground">
              No published posts yet.
            </div>
          )}
        </div>
        <div className="mt-5">
          <Button asChild variant="outline">
            <Link href="/blog" prefetch>
              All posts
            </Link>
          </Button>
        </div>
      </section>

      <section className="page-frame page-frame-bottom">
        <SectionHeader title="Daily news" divided={false} />
        <div className="mt-6">
          <DailyNewsList stories={dailyNews} />
        </div>
        <div className="mt-5">
          <Button asChild variant="outline">
            <Link href="/news" prefetch>
              Open today&apos;s index
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}

function HomeContentFallback() {
  return (
    <div aria-busy="true">
      <section className="page-frame page-frame-spacious">
        <SectionHeader title="Latest Blogs" divided={false} />
        <div className="mt-8 divide-y divide-row-border border-y border-row-border">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-24 bg-muted/10" />
          ))}
        </div>
      </section>
      <section className="page-frame page-frame-bottom">
        <SectionHeader title="Daily news" divided={false} />
        <div className="mt-6 h-40 border-y border-row-border bg-muted/10" />
      </section>
    </div>
  );
}
