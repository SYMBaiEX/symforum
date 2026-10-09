import { AgentWebMcpDiscovery } from "@/components/agent-webmcp-discovery";
import { DailyNewsList } from "@/components/daily-news-list";
import { EntryRow } from "@/components/entry-row";
import { HomeBanner } from "@/components/home-banner";
import { HomeFaq } from "@/components/home-faq";
import { PrimaryPageSurface } from "@/components/primary-page-surface";
import {
  ForumBodyGrid,
  ForumPageHeader,
  ForumSectionHeader,
} from "@/components/forum/forum-layout-primitives";
import { Button } from "@/components/ui/button";
import { PublicResourceSearchForm } from "@/components/public-resource-search-form";
import {
  DOCS_MCP_SERVER_CARD,
  GLAMA_EVIDENCE_LISTING_URL,
  MCP_SERVER_CARD,
} from "@/lib/agent-discovery";
import { getLatestPosts } from "@/lib/blog-data";
import { getDailyNews } from "@/lib/news-data";
import { primarySiteUrl } from "@/lib/site-urls";
import Link from "next/link";

export default function HomePage() {
  return (
    <PrimaryPageSurface>
      <AgentWebMcpDiscovery />
      <section className="page-frame page-frame-dense">
        <ForumPageHeader
          title="Austin Hamilton"
          breadcrumbs={<p className="page-kicker">SYMBiEX / Personal site</p>}
          description={
            <p>
              I build public software, AI systems, and research infrastructure
              with a bias toward inspectable sources and useful tools.
            </p>
          }
          actions={
            <>
              <Button asChild size="sm" variant="outline">
                <Link href="/about">About</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/contact">Contact</Link>
              </Button>
            </>
          }
        />

        <div className="mb-3 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase text-muted-foreground">
          <span>SYMBiEX</span>
          <span aria-hidden="true">≡</span>
          <span>Symbiosis + AI + Experiment</span>
        </div>
        <HomeBanner />
        <HomeContent />
      </section>
    </PrimaryPageSurface>
  );
}

async function HomeContent() {
  const [latestPosts, dailyNews] = await Promise.all([
    getLatestPosts(5),
    getDailyNews(5),
  ]);

  return (
    <>
      <ForumBodyGrid
        mobileSidebarLabel="Explore"
        sidebar={
          <div className="space-y-3">
            <section className="forum-panel p-4" aria-labelledby="home-about">
              <ForumSectionHeader title="About this work" id="home-about" />
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Public software, AI systems, and research notes built to stay
                readable and inspectable.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/portfolio">Portfolio</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/contact">Contact</Link>
                </Button>
              </div>
            </section>
            <section className="forum-panel p-4" aria-labelledby="home-links">
              <ForumSectionHeader title="Explore" id="home-links" />
              <nav aria-label="Explore SYMBaiEX" className="mt-2 grid gap-1">
                <Link
                  className="forum-action-pill focus-ring flex w-full justify-between"
                  href="/blog"
                >
                  <span>Writing</span>
                  <span aria-hidden="true">↗</span>
                </Link>
                <Link
                  className="forum-action-pill focus-ring flex w-full justify-between"
                  href="/news"
                >
                  <span>Daily news</span>
                  <span aria-hidden="true">↗</span>
                </Link>
                <Link
                  className="forum-action-pill focus-ring flex w-full justify-between"
                  href="/developers"
                >
                  <span>Developer guide</span>
                  <span aria-hidden="true">↗</span>
                </Link>
              </nav>
            </section>
          </div>
        }
      >
        <section
          className="forum-panel overflow-hidden p-0"
          aria-labelledby="latest-blogs"
        >
          <ForumSectionHeader title="Latest blogs" id="latest-blogs">
            <Button asChild size="sm" variant="outline">
              <Link href="/blog" prefetch>
                All posts
              </Link>
            </Button>
          </ForumSectionHeader>
          <div className="px-2 pb-2">
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
              <div className="border-y border-row-border px-2 py-6 font-mono text-xs uppercase text-muted-foreground">
                No published posts yet.
              </div>
            )}
          </div>
        </section>

        <section
          className="forum-panel overflow-hidden p-0"
          aria-labelledby="daily-news"
        >
          <ForumSectionHeader title="Daily news" id="daily-news">
            <Button asChild size="sm" variant="outline">
              <Link href="/news" prefetch>
                Open today&apos;s index
              </Link>
            </Button>
          </ForumSectionHeader>
          <div className="px-2 pb-2">
            <DailyNewsList stories={dailyNews} />
          </div>
        </section>

        <section className="forum-panel p-4" aria-labelledby="inspectable-site">
          <ForumSectionHeader
            title="A site people and agents can inspect"
            id="inspectable-site"
          />
          <div className="mt-3 grid gap-4 text-sm leading-6 text-muted-foreground md:grid-cols-2">
            <p>
              The public site is the authority: essays, projects, news links,
              forum discussions, and research notes remain readable as ordinary
              pages. Each supported public route also has a Markdown twin, so a
              reader can request the content without parsing navigation,
              animation, or application state.
            </p>
            <p>
              Machine integrations start with published contracts rather than
              private infrastructure. Start with the{" "}
              <Link className="underline underline-offset-4" href="/developers">
                SYMBaiEX developer guide
              </Link>
              , which links the OpenAPI and AsyncAPI descriptions, MCP server
              cards, authentication guide, skills, client source, quotas, and
              the exact boundaries of the current free beta. Read integration
              docs through the{" "}
              <Link
                className="underline underline-offset-4"
                href="/developers/mcp"
              >
                public documentation MCP
              </Link>
              . Its{" "}
              <a
                className="underline underline-offset-4"
                href={primarySiteUrl("/api/docs/mcp/server-card")}
              >
                machine-readable server card
              </a>{" "}
              publishes the exact endpoint and tool list. Use the separately
              owner-approved{" "}
              <Link
                className="underline underline-offset-4"
                href="/developers/api"
              >
                evidence API
              </Link>
              . For direct command-line setup, see the{" "}
              <Link
                className="underline underline-offset-4"
                href="/developers/cli"
              >
                SYMBaiEX Bun CLI guide
              </Link>
              . The official MCP Registry lists the{" "}
              <a
                className="underline underline-offset-4"
                href={DOCS_MCP_SERVER_CARD._meta["com.symbaiex/registry"].url}
              >
                documentation server
              </a>{" "}
              and{" "}
              <a
                className="underline underline-offset-4"
                href={MCP_SERVER_CARD._meta["com.symbaiex/registry"].url}
              >
                evidence server
              </a>
              . A third-party Glama directory page also lists the evidence
              server as a connector:{" "}
              <a
                className="underline underline-offset-4"
                href={GLAMA_EVIDENCE_LISTING_URL}
              >
                SYMBaiEX Evidence MCP on Glama
              </a>
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
        </section>

        <PublicResourceSearchForm className="forum-panel p-4" />
        <HomeFaq />
      </ForumBodyGrid>
    </>
  );
}
