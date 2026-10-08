import { NewsFeed } from "@/components/news-feed";
import {
  ForumBodyGrid,
  ForumPageHeader,
} from "@/components/forum/forum-layout-primitives";
import { NewsletterSignup } from "@/components/newsletter-signup";
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
      <section className="page-frame page-frame-dense mx-auto w-full max-w-[1440px]">
        <StructuredData
          data={breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "News", url: primarySiteUrl("/news") },
          ])}
        />
        <ForumPageHeader
          title="News"
          description="A daily Hacker News index. Follow the source, browse earlier rankings, and open the conversation behind each story."
          actions={
            <Link
              href="/newsletter#newsletter-subscribe"
              className="forum-primary-action focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              Subscribe to the newsletter
            </Link>
          }
        />

        <section className="forum-panel mt-4 grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_18rem] md:items-center md:p-5">
          <div className="min-w-0">
            <p className="page-kicker">Daily source index · Hacker News</p>
            <h2 className="mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              Stories, sources, and the conversation around them.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Browse the current ranking or select an earlier snapshot. Each
              story keeps the original article and its discussion close by.
            </p>
          </div>
          <div className="min-w-0 rounded-xl bg-muted/35 p-4">
            <p className="page-kicker">Latest from Belle&apos;s desk</p>
            {latestIssue ? (
              <>
                <p className="mt-2 text-sm font-semibold leading-6">
                  {latestIssue.headline}
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                  {formatDate(latestIssue.sentAt ?? latestIssue.updatedAt)}
                  {latestIssue.sourceCount > 0
                    ? ` · ${latestIssue.sourceCount} sources`
                    : ""}
                </p>
                <Link
                  className="focus-ring mt-2 inline-flex min-h-11 items-center text-xs font-semibold text-primary hover:underline"
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
                  className="focus-ring mt-2 inline-flex min-h-11 items-center text-xs font-semibold text-primary hover:underline"
                  href="/newsletter"
                >
                  Open the newsletter archive
                </Link>
              </>
            )}
          </div>
        </section>

        <ForumBodyGrid
          mobileSidebarLabel="News context"
          sidebar={
            <div className="space-y-3">
              <section className="forum-panel p-4" id="how-to-read">
                <h2 className="text-sm font-semibold tracking-tight">
                  How to read the index
                </h2>
                <dl className="mt-3 space-y-3">
                  <div>
                    <dt className="font-mono text-[10px] uppercase text-muted-foreground">
                      Rank
                    </dt>
                    <dd className="mt-1 text-sm leading-5">
                      Current or archived Hacker News order.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase text-muted-foreground">
                      Source
                    </dt>
                    <dd className="mt-1 text-sm leading-5">
                      Opens the linked article in a new tab.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase text-muted-foreground">
                      Discussion
                    </dt>
                    <dd className="mt-1 text-sm leading-5">
                      Story pages include the original Hacker News thread.
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="forum-panel p-4" id="newsletter-subscribe">
                <p className="page-kicker">Get the dispatch</p>
                <h2 className="mt-1 text-base font-semibold">
                  Signals in your inbox
                </h2>
                <p className="mt-1 mb-3 text-sm leading-5 text-muted-foreground">
                  Daily signals and weekly field notes from the open web.
                </p>
                <NewsletterSignup source="news-page" />
                <Link
                  className="focus-ring mt-2 inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground"
                  href="/newsletter"
                >
                  Browse the newsletter archive
                </Link>
              </section>
            </div>
          }
        >
          <section aria-labelledby="news-index-heading" id="top-stories">
            <h2 className="sr-only" id="news-index-heading">
              Top stories
            </h2>
            <NewsFeed
              enabled={convexEnabled}
              initialStories={initialStories}
              initialTimeline={initialTimeline}
              variant="forum"
            />
          </section>
        </ForumBodyGrid>
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
