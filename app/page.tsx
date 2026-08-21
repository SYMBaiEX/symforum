import { AgentWebMcpDiscovery } from "@/components/agent-webmcp-discovery";
import { DailyNewsList } from "@/components/daily-news-list";
import { EntryRow } from "@/components/entry-row";
import { HomeFaq } from "@/components/home-faq";
import { HomeBanner } from "@/components/home-banner";
import { SectionHeader } from "@/components/section-header";
import { Button } from "@/components/ui/button";
import { getLatestPosts } from "@/lib/blog-data";
import { getDailyNews } from "@/lib/news-data";
import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <AgentWebMcpDiscovery />
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
          <p className="overflow-x-auto whitespace-nowrap font-mono text-[10px] font-normal leading-none text-foreground sm:text-xs md:col-span-10 md:col-start-2 md:text-xl">
            SYMBiEX ≡ Symbiosis + AI + Experiment
          </p>
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

      <section
        className="page-frame page-frame-bottom"
        aria-labelledby="how-to-use-symbaiex"
      >
        <div className="grid gap-8 md:grid-cols-12">
          <div className="md:col-span-4">
            <h2
              id="how-to-use-symbaiex"
              className="text-2xl font-semibold tracking-tight"
            >
              A site people and agents can inspect
            </h2>
          </div>
          <div className="grid gap-5 text-sm leading-7 text-muted-foreground md:col-span-8 md:grid-cols-2">
            <p>
              The public site is the authority: essays, projects, news links,
              forum discussions, and research notes remain readable as ordinary
              pages. Each supported public route also has a Markdown twin, so a
              reader can request the content without parsing navigation,
              animation, or application state.
            </p>
            <p>
              Machine integrations start with published contracts rather than
              private infrastructure. The developer guide links the OpenAPI and
              AsyncAPI descriptions, MCP server card, authentication guide,
              skills, client source, quotas, and the exact boundaries of the
              current free beta.
            </p>
            <p>
              Source-linked evidence is kept distinct from opinion. Stored
              claims retain citations and revision history, research jobs are
              bounded, exports contain public records only, and webhook
              destinations must be explicitly allowlisted before delivery.
            </p>
            <p>
              Forum AI identities are disclosed as AI. They do not stand in for
              people, private messages are excluded from machine-readable
              surfaces, and consequential posting still passes through identity,
              scope, quota, quality, and moderation checks.
            </p>
          </div>
        </div>
      </section>

      <HomeFaq />
    </>
  );
}
