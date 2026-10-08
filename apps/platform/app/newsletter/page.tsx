import { NewsletterSignup } from "@/components/newsletter-signup";
import {
  ForumBodyGrid,
  ForumPageHeader,
  ForumSectionHeader,
} from "@/components/forum/forum-layout-primitives";
import { StructuredData } from "@/components/structured-data";
import { Button } from "@/components/ui/button";
import { getDailyNews } from "@/lib/news-data";
import { getPublicNewsletterIssues } from "@/lib/newsletter-data";
import { newsStoryPath } from "@/lib/news-slugs";
import type { Metadata } from "next";
import { ArrowUpRight, BookOpen, Radio } from "lucide-react";
import Link from "next/link";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";

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

  return (
    <section className="page-frame page-frame-dense newsletter-page">
      <StructuredData
        data={breadcrumbStructuredData([
          { name: "Home", url: primarySiteUrl("/") },
          { name: "Newsletter", url: primarySiteUrl("/newsletter") },
        ])}
      />

      <ForumPageHeader
        title="Newsletter"
        description="Daily signals and weekly field notes, with the sources and context kept close."
        actions={
          <Link
            className="forum-primary-action focus-ring inline-flex items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
            href="#newsletter-subscribe"
          >
            <Radio aria-hidden="true" className="size-4" />
            Get the next edition
          </Link>
        }
      />

      {featured ? (
        <article
          id="latest-edition"
          className="forum-panel newsletter-featured-edition scroll-mt-24 p-4 md:p-5"
        >
          <div className="grid gap-4 md:grid-cols-[9.5rem_minmax(0,1fr)] md:gap-5">
            <div className="flex gap-3 border-b border-border pb-3 md:block md:border-b-0 md:border-r md:pb-0 md:pr-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <BookOpen aria-hidden="true" className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Latest edition
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                  {formatDate(featured.sentAt ?? featured.updatedAt)}
                </p>
                <p className="mt-2 inline-flex rounded-full bg-muted px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground">
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
            </div>
            <div className="min-w-0 self-center">
              <h2 className="max-w-4xl text-xl font-bold leading-tight tracking-tight md:text-2xl">
                {featured.headline}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {featured.dek}
              </p>
              <Button asChild className="forum-primary-action mt-4" size="sm">
                <Link href={`/newsletter/${featured.slug}`}>
                  Read the edition
                  <ArrowUpRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        </article>
      ) : (
        <section id="latest-edition" className="forum-panel forum-status-box">
          <p className="page-kicker text-primary">Latest edition</p>
          <p className="mt-2 font-semibold">
            The public archive is ready for its next issue.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Subscribe for the next reviewed dispatch, or follow today&apos;s
            stories on the live desk.
          </p>
          <Link className="forum-action-pill mt-3 inline-flex" href="/news">
            Open the live news index
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </section>
      )}

      <ForumBodyGrid
        mobileSidebarLabel="Newsletter context"
        mobileSidebarAlwaysOpen
        sidebar={
          <div className="grid gap-3">
            <section
              id="newsletter-subscribe"
              className="forum-panel scroll-mt-24 p-4"
            >
              <ForumSectionHeader title="Get the next edition" />
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Source-linked stories, sent as daily signals and weekly field
                notes.
              </p>
              <NewsletterSignup className="mt-3" source="newsletter-archive" />
              <Link
                className="focus-ring mt-3 inline-flex min-h-9 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                href="/newsletter/preferences"
              >
                Manage subscription preferences
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </Link>
            </section>

            <section
              id="live-desk"
              className="forum-panel scroll-mt-24 overflow-hidden p-0"
            >
              <ForumSectionHeader title="On the live desk">
                <Radio aria-hidden="true" className="size-4 text-primary" />
              </ForumSectionHeader>
              <div className="px-4 pb-2 pt-1">
                <p className="text-xs leading-5 text-muted-foreground">
                  Today&apos;s reading list from the live news index.
                </p>
              </div>
              {currentStories.length > 0 ? (
                <ol className="divide-y divide-border border-t border-border">
                  {currentStories.map((story) => (
                    <li className="px-4 py-3" key={story.hnItemId}>
                      <Link
                        className="focus-ring text-sm font-medium leading-5 transition-colors hover:text-primary"
                        href={newsStoryPath(story)}
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
                <p className="border-t border-border px-4 py-3 text-sm leading-6 text-muted-foreground">
                  The live index is temporarily unavailable.
                </p>
              )}
              <div className="border-t border-border px-4 py-2">
                <Link
                  className="focus-ring inline-flex min-h-9 items-center gap-1 font-mono text-[10px] uppercase text-muted-foreground hover:text-primary"
                  href="/news"
                >
                  Open full news index
                  <ArrowUpRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
            </section>

            <section className="forum-panel p-4">
              <p className="page-kicker">Editorial approach</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Each issue keeps its sources visible and separates the reported
                signal from Belle&apos;s analysis.
              </p>
            </section>
          </div>
        }
      >
        <section
          id="newsletter-archive"
          aria-labelledby="newsletter-archive-heading"
          className="forum-panel newsletter-archive-list scroll-mt-24 overflow-hidden p-0"
        >
          <ForumSectionHeader
            title="Previous editions"
            id="newsletter-archive-heading"
          >
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              Newest first
            </span>
          </ForumSectionHeader>
          {rest.length > 0 ? (
            <div className="divide-y divide-border border-t border-border">
              {rest.map((issue) => (
                <Link
                  className="group grid gap-2 px-4 py-3 transition-colors hover:bg-muted/35 md:grid-cols-[minmax(0,1fr)_8.5rem] md:items-center"
                  href={`/newsletter/${issue.slug}`}
                  key={issue._id}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground">
                      <span>{formatDate(issue.sentAt ?? issue.updatedAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {issue.edition === "weekly-field-note"
                          ? "Field note"
                          : "Daily signal"}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm font-semibold leading-5 transition-colors group-hover:text-primary">
                      {issue.headline}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {issue.dek}
                    </span>
                  </span>
                  <span className="hidden items-center justify-end gap-1 text-xs font-medium text-muted-foreground group-hover:text-primary md:flex">
                    Read edition
                    <ArrowUpRight aria-hidden="true" className="size-3.5" />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="border-t border-border px-4 py-4 text-sm leading-6 text-muted-foreground">
              Previous editions will appear here after publication.
            </p>
          )}
        </section>
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
