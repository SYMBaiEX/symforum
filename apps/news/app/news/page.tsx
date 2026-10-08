import { NewsFeed } from "@/components/news-feed";
import { StructuredData } from "@/components/structured-data";
import { getNewsPageData } from "@/lib/news-data";
import { getPublicNewsletterIssues } from "@/lib/newsletter-data";
import type { Metadata } from "next";
import Link from "next/link";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";

export const metadata: Metadata = {
  title: "News",
  description:
    "Daily index of top Hacker News stories with on-site votes, saves, and comments.",
  alternates: { canonical: "/news" },
  openGraph: {
    type: "website",
    url: primarySiteUrl("/news"),
    title: "News",
    description:
      "Daily index of top Hacker News stories with on-site votes, saves, and comments.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX daily news index and signal collection.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Daily news index",
    description:
      "Daily index of top Hacker News stories with on-site votes, saves, and comments.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX daily news index and signal collection.",
      },
    ],
  },
};

export default async function NewsPage() {
  const convexEnabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const [{ initialTimeline, initialStories }, newsletterIssues] =
    await Promise.all([getNewsPageData(30), getPublicNewsletterIssues(1)]);
  const latestIssue = newsletterIssues[0] ?? null;

  return (
    <>
      <section className="page-frame page-frame-spacious">
        <StructuredData
          data={breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "News", url: primarySiteUrl("/news") },
          ])}
        />
        <header className="grid gap-6 border-y border-row-border py-6 md:grid-cols-12 md:gap-8 md:py-9">
          <div className="md:col-span-3">
            <h1 className="text-2xl font-semibold md:text-3xl">News</h1>
            <p className="mt-2 font-mono text-[10px] uppercase leading-5 text-muted-foreground">
              Source desk
              <br />
              Hacker News
            </p>
          </div>
          <div className="md:col-span-6">
            <p className="page-kicker text-accent-cyan">
              The open web / ranked
            </p>
            <h2 className="mt-3 max-w-4xl text-balance text-4xl font-semibold leading-[0.98] tracking-tight md:text-6xl">
              Stories, sources, and the conversation around them.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              A daily Hacker News index with the article and its discussion kept
              close together. Browse by snapshot, follow the source, or open the
              thread behind the ranking.
            </p>
          </div>
          <aside className="border-l-2 border-accent-cyan pl-4 md:col-span-3 md:self-end md:pb-1">
            <p className="page-kicker">From Belle&apos;s desk</p>
            {latestIssue ? (
              <>
                <p className="mt-2 text-sm font-semibold leading-6">
                  {latestIssue.headline}
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                  {formatDate(latestIssue.sentAt ?? latestIssue.updatedAt)}
                  {latestIssue.sourceCount > 0
                    ? ` / ${latestIssue.sourceCount} sources`
                    : ""}
                </p>
                <Link
                  className="focus-ring mt-3 inline-flex font-mono text-[10px] uppercase text-foreground underline decoration-accent-canary underline-offset-4 transition-colors hover:text-accent-canary"
                  href={`/newsletter/${latestIssue.slug}`}
                >
                  Read the latest edition
                </Link>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Source-grounded daily signals and weekly field notes.
                </p>
                <Link
                  className="focus-ring mt-3 inline-flex font-mono text-[10px] uppercase text-foreground underline decoration-accent-canary underline-offset-4 transition-colors hover:text-accent-canary"
                  href="/newsletter"
                >
                  Open the newsletter archive
                </Link>
              </>
            )}
          </aside>
        </header>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-10">
          <section aria-labelledby="news-index-heading" className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-row-border pb-3">
              <div>
                <p className="page-kicker">Source index</p>
                <h2
                  className="mt-1 text-xl font-semibold"
                  id="news-index-heading"
                >
                  Top stories
                </h2>
              </div>
              <p className="font-mono text-[10px] uppercase text-muted-foreground">
                Ranked / Hacker News
              </p>
            </div>
            <div className="mt-3">
              <NewsFeed
                enabled={convexEnabled}
                initialStories={initialStories}
                initialTimeline={initialTimeline}
              />
            </div>
          </section>

          <aside className="self-start lg:sticky lg:top-4">
            <div className="border border-row-border bg-muted/10 p-4">
              <p className="page-kicker">How to read the index</p>
              <dl className="mt-4 divide-y divide-row-border border-y border-row-border">
                <div className="py-3">
                  <dt className="font-mono text-[10px] uppercase text-muted-foreground">
                    Rank
                  </dt>
                  <dd className="mt-1 text-sm leading-6">
                    Current or archived Hacker News order.
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="font-mono text-[10px] uppercase text-muted-foreground">
                    Source
                  </dt>
                  <dd className="mt-1 text-sm leading-6">
                    Opens the linked article in a new tab.
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="font-mono text-[10px] uppercase text-muted-foreground">
                    Discussion
                  </dt>
                  <dd className="mt-1 text-sm leading-6">
                    Story pages include the original Hacker News thread.
                  </dd>
                </div>
              </dl>
              <Link
                className="focus-ring mt-4 inline-flex font-mono text-[10px] uppercase text-muted-foreground underline decoration-row-border underline-offset-4 transition-colors hover:text-foreground"
                href="/newsletter"
              >
                Browse the newsletter archive
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
