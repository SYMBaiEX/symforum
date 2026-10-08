import { NewsletterSignup } from "@/components/newsletter-signup";
import { StructuredData } from "@/components/structured-data";
import { Button } from "@/components/ui/button";
import { getDailyNews } from "@/lib/news-data";
import { getPublicNewsletterIssues } from "@/lib/newsletter-data";
import { newsStoryPath } from "@/lib/news-slugs";
import type { Metadata } from "next";
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
    <section className="page-frame page-frame-spacious">
      <StructuredData
        data={breadcrumbStructuredData([
          { name: "Home", url: primarySiteUrl("/") },
          { name: "Newsletter", url: primarySiteUrl("/newsletter") },
        ])}
      />
      <header className="grid gap-7 border-y border-row-border py-6 md:grid-cols-12 md:gap-8 md:py-9">
        <div className="md:col-span-8">
          <p className="page-kicker text-accent-canary">
            Belle&apos;s desk / dispatches
          </p>
          <h1 className="page-title mt-3">Newsletter</h1>
          <p className="mt-2 max-w-3xl text-xl font-medium leading-tight md:text-3xl">
            Daily signals. Weekly field notes.
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
            Source-linked stories with the context, evidence, and practical
            questions kept together. Subscribe for new editions or read the
            archive below.
          </p>
        </div>
        <aside className="border-l-2 border-accent-canary pl-4 md:col-span-4 md:self-end">
          <p className="page-kicker">Get the next edition</p>
          <NewsletterSignup className="mt-3" source="newsletter-archive" />
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Daily signals and weekly field notes, with source references beside
            the editorial context.
          </p>
        </aside>
      </header>

      <div className="mt-8 grid gap-9 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
        <div className="min-w-0">
          {featured ? (
            <article className="border border-row-border bg-muted/10">
              <div className="grid gap-5 p-5 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-7 md:p-7">
                <div className="border-b border-row-border pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-5">
                  <p className="page-kicker text-accent-canary">
                    Latest edition
                  </p>
                  <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
                    {formatDate(featured.sentAt ?? featured.updatedAt)}
                  </p>
                  <p className="mt-4 inline-flex border border-row-border px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground">
                    {featured.edition === "weekly-field-note"
                      ? "Field note"
                      : "Daily signal"}
                  </p>
                  {featured.sourceCount > 0 ? (
                    <p className="mt-4 text-xs leading-5 text-muted-foreground">
                      {featured.qualityScore !== undefined
                        ? `Quality ${featured.qualityScore}/100 · `
                        : ""}
                      {featured.sourceCount} source anchors
                    </p>
                  ) : null}
                </div>
                <div>
                  <h2 className="max-w-4xl text-2xl font-semibold leading-tight md:text-4xl">
                    {featured.headline}
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
                    {featured.dek}
                  </p>
                  <Button asChild className="mt-5 rounded-none" size="sm">
                    <Link href={`/newsletter/${featured.slug}`}>
                      Read the edition
                    </Link>
                  </Button>
                </div>
              </div>
            </article>
          ) : (
            <div className="border-y border-row-border py-7">
              <p className="page-kicker">The public archive</p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                The next reviewed edition will appear here. You can subscribe
                above or follow the live news index in the meantime.
              </p>
              <Link
                className="focus-ring mt-4 inline-flex font-mono text-[10px] uppercase text-foreground underline decoration-accent-cyan underline-offset-4 transition-colors hover:text-accent-cyan"
                href="/news"
              >
                Open the live news index
              </Link>
            </div>
          )}

          {rest.length > 0 ? (
            <section
              aria-labelledby="newsletter-archive-heading"
              className="mt-9"
            >
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-row-border pb-3">
                <div>
                  <p className="page-kicker">The archive</p>
                  <h2
                    className="mt-1 text-xl font-semibold"
                    id="newsletter-archive-heading"
                  >
                    Previous editions
                  </h2>
                </div>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  Newest first
                </span>
              </div>
              <div className="mt-2 divide-y divide-row-border border-y border-row-border">
                {rest.map((issue) => (
                  <Link
                    className="group grid gap-2 py-4 transition-colors hover:bg-muted/20 md:grid-cols-[7.5rem_minmax(0,1fr)_7rem] md:items-start md:gap-4 md:px-2"
                    href={`/newsletter/${issue.slug}`}
                    key={issue._id}
                  >
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                      {formatDate(issue.sentAt ?? issue.updatedAt)}
                    </span>
                    <span>
                      <span className="block text-base font-semibold leading-6 transition-colors group-hover:text-primary">
                        {issue.headline}
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-muted-foreground">
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
        </div>

        <aside className="self-start lg:sticky lg:top-4">
          <section className="border border-row-border bg-muted/10 p-4">
            <p className="page-kicker text-accent-cyan">On the live desk</p>
            <h2 className="mt-2 text-lg font-semibold">
              Today&apos;s reading list
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Current stories from the Hacker News index.
            </p>
            {currentStories.length > 0 ? (
              <ol className="mt-4 divide-y divide-row-border border-y border-row-border">
                {currentStories.map((story) => (
                  <li className="py-3" key={story.hnItemId}>
                    <Link
                      className="focus-ring text-sm font-medium leading-5 transition-colors hover:text-accent-cyan"
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
              <p className="mt-4 border-y border-row-border py-3 text-sm leading-6 text-muted-foreground">
                The live index is temporarily unavailable.
              </p>
            )}
            <Link
              className="focus-ring mt-4 inline-flex font-mono text-[10px] uppercase text-foreground underline decoration-accent-cyan underline-offset-4 transition-colors hover:text-accent-cyan"
              href="/news"
            >
              Open the full news index
            </Link>
          </section>

          <div className="mt-6 border-t border-row-border pt-4">
            <p className="page-kicker">Editorial approach</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Each issue makes its sources visible and separates the reported
              signal from Belle&apos;s analysis.
            </p>
          </div>
        </aside>
      </div>
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
