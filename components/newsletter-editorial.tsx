import { NewsletterIssueViewTracker } from "@/components/newsletter-issue-view-tracker";
import { Button } from "@/components/ui/button";
import type { PublicNewsletterIssueRecord } from "@/lib/convex-refs";
import {
  parseEditorialNewsletterPayload,
  type EditorialNewsletterPayload,
} from "@/convex/newsletterPayload";
import { ArrowUpRight, MessageSquareText } from "lucide-react";
import Link from "next/link";

export function NewsletterEditorial({
  issue,
}: {
  issue: PublicNewsletterIssueRecord;
}) {
  const payload = parseEditorialNewsletterPayload(issue.body);
  if (payload === null) {
    return <LegacyNewsletterIssue issue={issue} />;
  }

  return (
    <article className="newsletter-editorial grid gap-4">
      <NewsletterIssueViewTracker slug={issue.slug} />
      <header className="newsletter-issue-header forum-panel grid gap-4 p-4 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-5 md:p-5">
        <div className="flex items-start gap-3 border-b border-border pb-3 md:block md:border-b-0 md:border-r md:pb-0 md:pr-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
            B
          </span>
          <div>
            <p className="page-kicker text-primary">
              {payload.edition === "weekly-field-note"
                ? "Weekly field note"
                : "Belle's daily signal"}
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
              {formatEditionDate(payload.runDate)}
            </p>
            <p className="mt-2 text-sm font-semibold">Belle</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {payload.author.role}
            </p>
          </div>
        </div>
        <div className="self-center">
          <h1 className="max-w-4xl text-balance text-xl font-bold leading-tight tracking-tight md:text-3xl">
            {payload.headline}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {payload.dek}
          </p>
        </div>
      </header>

      {payload.heroImage ? (
        <figure className="forum-panel overflow-hidden p-0">
          <div
            aria-label={payload.heroImage.alt}
            className="aspect-[16/7] w-full bg-cover bg-center"
            role="img"
            style={{ backgroundImage: `url("${payload.heroImage.url}")` }}
          />
          <figcaption className="flex flex-wrap justify-between gap-2 border-t border-border px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground">
            <span>{payload.heroImage.credit ?? "Source image"}</span>
            {payload.heroImage.sourceUrl ? (
              <a
                className="transition-colors hover:text-foreground"
                href={payload.heroImage.sourceUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Image source
              </a>
            ) : null}
          </figcaption>
        </figure>
      ) : null}

      <div className="newsletter-editorial-body grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid min-w-0 gap-3">
          <section className="forum-panel border-l-2 border-primary/70 p-4 md:p-5">
            <p className="page-kicker text-primary">The thesis</p>
            <p className="mt-2 text-base font-medium leading-7">
              {payload.thesis}
            </p>
          </section>
          <div className="forum-panel grid gap-4 p-4 md:p-5">
            <p className="max-w-3xl whitespace-pre-line text-sm leading-7 text-foreground/90">
              {payload.lead}
            </p>
            {payload.sections?.map((section) => (
              <section
                className="max-w-3xl border-t border-border pt-4"
                key={section.heading}
              >
                <h2 className="text-lg font-semibold tracking-tight">
                  {section.heading}
                </h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-7 text-foreground/85">
                  {section.body}
                </p>
              </section>
            ))}
          </div>
        </div>
        <NewsletterSignalChart payload={payload} />
      </div>

      <section className="forum-panel newsletter-source-section overflow-hidden p-0">
        <div className="forum-section-header flex-wrap gap-y-1 px-4 py-3">
          <span className="page-kicker text-primary">Source-led briefing</span>
          <h2 className="text-sm font-semibold">
            The evidence behind the argument
          </h2>
        </div>
        <div className="grid gap-2 border-t border-border p-3 md:p-4">
          {payload.stories.map((story, index) => (
            <article
              className="forum-post-card grid gap-3 p-3 md:grid-cols-[2rem_minmax(0,1fr)_auto] md:gap-4"
              key={story.hnItemId}
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
                  <span>{story.host ?? "Hacker News"}</span>
                  <span>/</span>
                  <span>Signal {story.signalScore}</span>
                </div>
                <h3 className="mt-1 text-base font-semibold leading-6">
                  {story.title}
                </h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {story.summary}
                </p>
                <p className="mt-2 max-w-3xl text-sm leading-6">
                  <span className="font-semibold">Why it matters:</span>{" "}
                  {story.whyItMatters}
                </p>
                <ul className="mt-2 grid gap-1.5 text-sm leading-6 text-foreground/85">
                  {story.takeaways.map((takeaway) => (
                    <li className="flex gap-2" key={takeaway}>
                      <span className="text-accent-cyan">→</span>
                      <span>{takeaway}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-start gap-2 md:flex-col">
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`/newsletter/${issue.slug}/go/source-${story.hnItemId}`}
                    prefetch={false}
                  >
                    Source
                    <ArrowUpRight />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link
                    href={`/newsletter/${issue.slug}/go/discussion-${story.hnItemId}`}
                    prefetch={false}
                  >
                    HN
                  </Link>
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <EditorialList
          items={payload.practicalMoves}
          title="What to do with this"
        />
        <EditorialList
          items={payload.whatToWatch}
          title="What Belle is watching"
        />
      </section>

      <section className="forum-panel p-4 md:p-5">
        <p className="page-kicker text-primary">Continue the story</p>
        <p className="mt-2 max-w-3xl text-base font-medium leading-7">
          {payload.discussion.question}
        </p>
        {payload.discussion.forumUrl ? (
          <Button asChild className="mt-5" size="sm">
            <Link href={`/newsletter/${issue.slug}/go/forum`} prefetch={false}>
              <MessageSquareText />
              Discuss with the forum
            </Link>
          </Button>
        ) : null}
      </section>

      <footer className="forum-panel text-xs leading-6 text-muted-foreground">
        <p>{payload.methodology}</p>
        <p className="mt-2">{payload.author.disclosure}</p>
        <p className="mt-2">
          Editorial quality score: {payload.quality.score}/100. Source coverage{" "}
          {payload.quality.sourceCoverage} / diversity{" "}
          {payload.quality.sourceDiversity} / originality{" "}
          {payload.quality.originality} / utility {payload.quality.utility}.
        </p>
      </footer>
    </article>
  );
}

function NewsletterSignalChart({
  payload,
}: {
  payload: EditorialNewsletterPayload;
}) {
  return (
    <aside className="forum-panel self-start p-4 lg:sticky lg:top-4">
      <p className="page-kicker text-primary">Signal map</p>
      <h2 className="mt-2 text-base font-semibold">{payload.chart.title}</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {payload.chart.subtitle}
      </p>
      <div className="mt-4 grid gap-3">
        {payload.chart.items.map((item) => (
          <div key={item.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase">
              <span>{item.label}</span>
              <span className="text-muted-foreground">{item.value}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(2, item.value)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
              {item.note}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 border-t border-border pt-3 font-mono text-[9px] uppercase text-muted-foreground">
        {payload.chart.metricLabel}
      </p>
    </aside>
  );
}

function EditorialList({ items, title }: { items: string[]; title: string }) {
  return (
    <section className="forum-panel p-4">
      <p className="page-kicker text-primary">{title}</p>
      <ul className="mt-3 grid gap-2">
        {items.map((item) => (
          <li className="flex gap-3 text-sm leading-6" key={item}>
            <span className="text-muted-foreground">/</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LegacyNewsletterIssue({
  issue,
}: {
  issue: PublicNewsletterIssueRecord;
}) {
  return (
    <article className="forum-panel page-content p-4 md:p-5">
      <p className="page-kicker text-primary">Archive edition</p>
      <h1 className="mt-2 text-xl font-bold leading-tight md:text-2xl">
        {issue.subject}
      </h1>
      <p className="mt-5 text-base leading-7 text-muted-foreground">
        {issue.previewText}
      </p>
      <Button asChild className="mt-6" size="sm">
        <Link href="/news">Open the daily news index</Link>
      </Button>
    </article>
  );
}

function formatEditionDate(runDate: string) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${runDate}T12:00:00.000Z`));
}
