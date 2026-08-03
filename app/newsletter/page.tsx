import { NewsletterSignup } from "@/components/newsletter-signup";
import { Button } from "@/components/ui/button";
import { parseEditorialNewsletterPayload } from "@/convex/newsletterPayload";
import { getPublicNewsletterIssues } from "@/lib/newsletter-data";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Newsletter",
  description:
    "Belle's source-grounded daily signals and weekly SYMBaiEX field notes.",
};

export const revalidate = 60;

export default async function NewsletterArchivePage() {
  const issues = await getPublicNewsletterIssues(30);
  const [featured, ...rest] = issues;
  const featuredPayload = featured
    ? parseEditorialNewsletterPayload(featured.body)
    : null;

  return (
    <section className="page-frame page-frame-spacious">
      <div className="grid gap-3 border-y border-row-border py-4 md:grid-cols-12 md:items-center">
        <p className="page-kicker md:col-span-3">Belle&apos;s desk</p>
        <NewsletterSignup
          className="md:col-span-9"
          source="newsletter-archive"
        />
      </div>

      {featured ? (
        <article className="mt-8 grid gap-6 border-b border-row-border pb-8 md:grid-cols-12">
          <div className="md:col-span-3">
            <p className="page-kicker text-accent-canary">Latest edition</p>
            <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
              {formatDate(featured.sentAt ?? featured.updatedAt)}
            </p>
            {featuredPayload ? (
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Quality {featuredPayload.quality.score}/100 /{" "}
                {featuredPayload.stories.length} source anchors
              </p>
            ) : null}
          </div>
          <div className="md:col-span-9">
            <h2 className="max-w-4xl text-3xl font-semibold leading-tight md:text-5xl">
              {featuredPayload?.headline ?? featured.subject}
            </h2>
            <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
              {featuredPayload?.dek ?? featured.previewText}
            </p>
            <Button asChild className="mt-5" size="sm">
              <Link href={`/newsletter/${featured.slug}`}>
                Read the edition
              </Link>
            </Button>
          </div>
        </article>
      ) : (
        <div className="mt-8 border-y border-row-border py-10">
          <p className="text-sm text-muted-foreground">
            The public archive begins with the next reviewed edition.
          </p>
        </div>
      )}

      {rest.length > 0 ? (
        <div className="mt-8">
          <p className="page-kicker">Previous editions</p>
          <div className="mt-3 divide-y divide-row-border border-y border-row-border">
            {rest.map((issue) => {
              const payload = parseEditorialNewsletterPayload(issue.body);
              return (
                <Link
                  className="grid gap-3 py-4 transition-colors hover:bg-muted/10 md:grid-cols-[8rem_minmax(0,1fr)_auto] md:items-center md:px-2"
                  href={`/newsletter/${issue.slug}`}
                  key={issue._id}
                >
                  <span className="font-mono text-[10px] uppercase text-muted-foreground">
                    {formatDate(issue.sentAt ?? issue.updatedAt)}
                  </span>
                  <span>
                    <span className="block text-base font-semibold">
                      {payload?.headline ?? issue.subject}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-sm leading-6 text-muted-foreground">
                      {payload?.dek ?? issue.previewText}
                    </span>
                  </span>
                  <span className="font-mono text-[10px] uppercase text-muted-foreground">
                    {payload?.edition === "weekly-field-note"
                      ? "Field note"
                      : "Daily signal"}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
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
