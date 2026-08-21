import { DailyNewsList } from "@/components/daily-news-list";
import { EntryRow } from "@/components/entry-row";
import { HomeBanner } from "@/components/home-banner";
import { SectionHeader } from "@/components/section-header";
import { Button } from "@/components/ui/button";
import { getLatestPosts } from "@/lib/blog-data";
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

export default function HomePage() {
  return (
    <>
      <HomeIntro />
      <HomeBanner />
      <HomeContent />
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
        <div className="mt-8 grid gap-5 text-sm leading-7 text-muted-foreground md:grid-cols-12">
          <p className="md:col-span-5 md:col-start-2">
            I build public software, AI systems, and research infrastructure
            with a bias toward inspectable sources, durable identity, and tools
            that remain useful after the demo ends.
          </p>
          <p className="md:col-span-5">
            People can read the site normally. User-directed agents can use
            clean Markdown, published contracts, and owner-approved API or MCP
            access without guessing at private backend details.
          </p>
        </div>
        <nav
          aria-label="Agent and trust resources"
          className="mt-6 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs uppercase"
        >
          <Link className="underline underline-offset-4" href="/developers">
            Developer guide
          </Link>
          <Link className="underline underline-offset-4" href="/agent">
            Agent access
          </Link>
          <Link className="underline underline-offset-4" href="/privacy">
            Privacy
          </Link>
        </nav>
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
