import { NewsletterSignup } from "@/components/newsletter-signup";
import { StructuredData } from "@/components/structured-data";
import {
  ForumBodyGrid,
  ForumSectionHeader,
} from "@/components/forum/forum-layout-primitives";
import { getDailyNews } from "@/lib/news-data";
import { getPublicNewsletterIssues } from "@/lib/newsletter-data";
import { newsStoryPath } from "@/lib/news-slugs";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Rss } from "lucide-react";
import { breadcrumbStructuredData } from "@/lib/seo";
import { newsSiteUrl, primarySiteUrl } from "@/lib/site-urls";

export const metadata: Metadata = {
  title: "Newsletter",
  description:
    "Belle's source-grounded daily signals and weekly SYMBaiEX field notes.",
  alternates: { canonical: "/newsletter" },
  openGraph: {
    type: "website",
    url: primarySiteUrl("/newsletter"),
    title: "Newsletter",
    description:
      "Belle's source-grounded daily signals and weekly SYMBaiEX field notes.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX newsletter archive and latest source-grounded editions.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Newsletter",
    description:
      "Belle's source-grounded daily signals and weekly SYMBaiEX field notes.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX newsletter archive and latest source-grounded editions.",
      },
    ],
  },
};

export const revalidate = 60;

export default async function NewsletterArchivePage() {
  const [issues, currentStories] = await Promise.all([
    getPublicNewsletterIssues(30),
    getDailyNews(4),
  ]);
  const [featured, ...rest] = issues;

  const sidebar = (
    <div className="space-y-3">
      <section className="forum-panel p-4" id="live-desk">
        <ForumSectionHeader title="On the live desk" />
        <h3 className="mt-2 text-base font-semibold">
          Today&apos;s reading list
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Current stories from the Hacker News index.
        </p>
        {currentStories.length > 0 ? (
          <ol className="mt-3 divide-y divide-border border-y border-border">
            {currentStories.map((story) => (
              <li className="py-3" key={story.hnItemId}>
                <Link
                  className="focus-ring text-sm font-medium leading-5 transition-colors hover:text-accent-cyan"
                  href={newsSiteUrl(newsStoryPath(story))}
                >
                  {story.title}
                </Link>
                <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                  #{String(story.rank).padStart(2, "0")} /{" "}
                  {story.host ?? "Hacker News"}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 border-y border-border py-3 text-sm leading-5 text-muted-foreground">
            The live index is temporarily unavailable.
          </p>
        )}
        <Link
          className="forum-action-pill focus-ring mt-3 w-full justify-between"
          href={newsSiteUrl("/news")}
        >
          Open the full news index
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </Link>
      </section>

      <section className="forum-panel p-4">
        <ForumSectionHeader title="Archive details" />
        <dl className="mt-3 grid grid-cols-2 gap-4 border-t border-border pt-3">
          <div>
            <dt className="font-mono text-[10px] uppercase text-muted-foreground">
              Published
            </dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight">
              {issues.length}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase text-muted-foreground">
              Editions
            </dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight">
              Daily / weekly
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );

  return (
    <section className="page-frame page-frame-dense">
      <h1 className="sr-only">Newsletter</h1>
      <StructuredData
        data={breadcrumbStructuredData([
          { name: "Home", url: primarySiteUrl("/") },
          { name: "Newsletter", url: primarySiteUrl("/newsletter") },
        ])}
      />

      <ForumBodyGrid mobileSidebarLabel="Newsletter context" sidebar={sidebar}>
        <section
          aria-labelledby="newsletter-subscribe-heading"
          className="forum-panel p-4 md:p-5"
          id="newsletter-subscribe"
          tabIndex={-1}
        >
          <ForumSectionHeader
            id="newsletter-subscribe-heading"
            title="Get the next edition"
          >
            <Link
              className="forum-action-pill focus-ring"
              href="/feed/newsletter.xml"
            >
              <Rss aria-hidden="true" className="size-4" />
              RSS
            </Link>
          </ForumSectionHeader>
          <NewsletterSignup
            className="mt-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            source="newsletter-archive"
          />
        </section>

        {featured ? (
          <article
            className="forum-panel scroll-mt-24 p-4 md:p-5"
            id="latest-edition"
          >
            <div className="grid gap-4 md:grid-cols-[9.5rem_minmax(0,1fr)] md:gap-5">
              <div className="border-b border-border pb-3 md:border-b-0 md:border-r md:pb-0 md:pr-4">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Latest edition
                </p>
                <time
                  className="mt-1 block font-mono text-[10px] uppercase text-muted-foreground"
                  dateTime={new Date(
                    featured.sentAt ?? featured.updatedAt,
                  ).toISOString()}
                >
                  {formatDate(featured.sentAt ?? featured.updatedAt)}
                </time>
                <p className="mt-3 font-mono text-[10px] uppercase text-muted-foreground">
                  {featured.edition === "weekly-field-note"
                    ? "Field note"
                    : "Daily signal"}
                </p>
                {featured.sourceCount > 0 ? (
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {featured.qualityScore !== undefined
                      ? `Quality ${featured.qualityScore}/100 · `
                      : ""}
                    {featured.sourceCount} source anchors
                  </p>
                ) : null}
              </div>
              <div className="min-w-0 self-center">
                <h2 className="max-w-4xl text-xl font-bold leading-tight tracking-tight md:text-2xl">
                  {featured.headline}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {featured.dek}
                </p>
                <Link
                  className="forum-primary-action focus-ring mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
                  href={`/newsletter/${featured.slug}`}
                >
                  Read the edition
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </Link>
              </div>
            </div>
          </article>
        ) : (
          <section className="forum-panel p-4 md:p-5" id="latest-edition">
            <ForumSectionHeader title="The public archive" />
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              The next reviewed edition will appear here. Follow the live news
              index in the meantime.
            </p>
            <Link
              className="forum-action-pill focus-ring mt-3 inline-flex"
              href={newsSiteUrl("/news")}
            >
              Open the live news index
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </Link>
          </section>
        )}

        {rest.length > 0 ? (
          <section
            aria-labelledby="newsletter-archive-heading"
            className="forum-panel overflow-hidden"
            id="newsletter-archive"
          >
            <ForumSectionHeader
              id="newsletter-archive-heading"
              title="Previous editions"
            >
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                Newest first · {rest.length} entries
              </span>
            </ForumSectionHeader>
            <div className="divide-y divide-border border-t border-border">
              {rest.map((issue) => (
                <Link
                  className="group grid gap-2 px-4 py-3 transition-colors hover:bg-muted/20 md:grid-cols-[7.5rem_minmax(0,1fr)_7rem] md:items-start md:gap-4"
                  href={`/newsletter/${issue.slug}`}
                  key={issue._id}
                >
                  <time
                    className="font-mono text-[10px] uppercase text-muted-foreground"
                    dateTime={new Date(
                      issue.sentAt ?? issue.updatedAt,
                    ).toISOString()}
                  >
                    {formatDate(issue.sentAt ?? issue.updatedAt)}
                  </time>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-5 transition-colors group-hover:text-primary">
                      {issue.headline}
                    </span>
                    <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                      {issue.dek}
                    </span>
                  </span>
                  <span className="font-mono text-[10px] uppercase text-muted-foreground md:text-right">
                    {issue.edition === "weekly-field-note"
                      ? "Field note"
                      : "Daily signal"}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </ForumBodyGrid>
    </section>
  );
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
