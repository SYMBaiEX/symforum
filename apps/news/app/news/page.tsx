import { NewsFeed } from "@/components/news-feed";
import { StructuredData } from "@/components/structured-data";
import {
  ForumBodyGrid,
  ForumSectionHeader,
} from "@/components/forum/forum-layout-primitives";
import { getNewsPageData } from "@/lib/news-data";
import { getPublicNewsletterIssues } from "@/lib/newsletter-data";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Rss } from "lucide-react";
import { breadcrumbStructuredData } from "@/lib/seo";
import { newsletterSiteUrl, primarySiteUrl } from "@/lib/site-urls";

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

  const sidebar = (
    <div className="space-y-3">
      <section className="forum-panel p-4">
        <ForumSectionHeader title="From the newsletter" />
        {latestIssue ? (
          <>
            <Link
              className="focus-ring mt-2 block text-sm font-semibold leading-5 hover:text-primary"
              href={newsletterSiteUrl(`/newsletter/${latestIssue.slug}`)}
            >
              {latestIssue.headline}
            </Link>
            <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
              {formatDate(latestIssue.sentAt ?? latestIssue.updatedAt)}
              {latestIssue.sourceCount > 0
                ? ` / ${latestIssue.sourceCount} sources`
                : ""}
            </p>
            <Link
              className="forum-action-pill focus-ring mt-3 w-full justify-between"
              href={newsletterSiteUrl(`/newsletter/${latestIssue.slug}`)}
            >
              Read the latest edition
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </Link>
          </>
        ) : (
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            No public edition is available yet.
          </p>
        )}
        <Link
          className="focus-ring mt-3 inline-flex min-h-9 items-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          href={newsletterSiteUrl("/newsletter")}
        >
          Browse the newsletter archive
        </Link>
      </section>

      <section className="forum-panel p-4" id="how-to-read">
        <ForumSectionHeader title="How to read the index" />
        <dl className="mt-2 divide-y divide-border border-y border-border">
          <div className="py-3">
            <dt className="font-mono text-[10px] uppercase text-muted-foreground">
              Rank
            </dt>
            <dd className="mt-1 text-sm leading-5">
              Current or archived Hacker News order.
            </dd>
          </div>
          <div className="py-3">
            <dt className="font-mono text-[10px] uppercase text-muted-foreground">
              Source
            </dt>
            <dd className="mt-1 text-sm leading-5">
              Opens the linked article in a new tab.
            </dd>
          </div>
          <div className="py-3">
            <dt className="font-mono text-[10px] uppercase text-muted-foreground">
              Discussion
            </dt>
            <dd className="mt-1 text-sm leading-5">
              Story pages include the original Hacker News thread.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );

  return (
    <section className="page-frame page-frame-dense">
      <h1 className="sr-only">News</h1>
      <StructuredData
        data={breadcrumbStructuredData([
          { name: "Home", url: primarySiteUrl("/") },
          { name: "News", url: primarySiteUrl("/news") },
        ])}
      />

      <ForumBodyGrid mobileSidebarLabel="News context" sidebar={sidebar}>
        <section aria-labelledby="top-stories" className="forum-panel">
          <ForumSectionHeader id="top-stories" title="Top stories">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              Ranked / Hacker News
            </span>
            <Link
              className="forum-action-pill focus-ring"
              href="/feed/news.xml"
            >
              <Rss aria-hidden="true" className="size-4" />
              RSS
            </Link>
          </ForumSectionHeader>
          <div className="border-t border-border py-2">
            <NewsFeed
              enabled={convexEnabled}
              initialStories={initialStories}
              initialTimeline={initialTimeline}
              variant="forum"
            />
          </div>
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
