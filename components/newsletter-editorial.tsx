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
    <article>
      <NewsletterIssueViewTracker slug={issue.slug} />
      <header className="grid gap-5 border-b border-row-border pb-7 md:grid-cols-12 md:pb-9">
        <div className="md:col-span-3">
          <p className="page-kicker">
            {payload.edition === "weekly-field-note"
              ? "Weekly field note"
              : "Belle's daily signal"}
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
            {formatEditionDate(payload.runDate)}
          </p>
          <div className="mt-5 border-l-2 border-accent-canary pl-3">
            <p className="text-sm font-medium">Belle</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {payload.author.role}
            </p>
          </div>
        </div>
        <div className="md:col-span-9">
          <h1 className="max-w-4xl text-balance text-3xl font-semibold leading-[1.05] md:text-5xl">
            {payload.headline}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
            {payload.dek}
          </p>
        </div>
      </header>

      {payload.heroImage ? (
        <figure className="mt-7 overflow-hidden border border-row-border bg-muted/15">
          <div
            aria-label={payload.heroImage.alt}
            className="aspect-[16/7] w-full bg-cover bg-center"
            role="img"
            style={{ backgroundImage: `url("${payload.heroImage.url}")` }}
          />
          <figcaption className="flex flex-wrap justify-between gap-2 border-t border-row-border px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground">
            <span>{payload.heroImage.credit ?? "Source image"}</span>
            {payload.heroImage.sourceUrl ? (
              <Link
                className="transition-colors hover:text-foreground"
                href={payload.heroImage.sourceUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Image source
              </Link>
            ) : null}
          </figcaption>
        </figure>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <section className="border-l-2 border-accent-canary bg-muted/10 px-4 py-4 md:px-5">
            <p className="page-kicker text-accent-canary">The thesis</p>
            <p className="mt-3 text-lg font-medium leading-8">
              {payload.thesis}
            </p>
          </section>
          <p className="mt-7 max-w-3xl whitespace-pre-line text-base leading-8 text-foreground/90">
            {payload.lead}
          </p>
          {payload.sections?.map((section) => (
            <section className="mt-9 max-w-3xl" key={section.heading}>
              <h2 className="text-2xl font-semibold">{section.heading}</h2>
              <p className="mt-3 whitespace-pre-line text-base leading-8 text-foreground/85">
                {section.body}
              </p>
            </section>
          ))}
        </div>
        <NewsletterSignalChart payload={payload} />
      </div>

      <section className="mt-10 border-t border-row-border pt-6">
        <div className="grid gap-2 md:grid-cols-12">
          <p className="page-kicker md:col-span-3">Source-led briefing</p>
          <h2 className="text-2xl font-semibold md:col-span-9">
            The evidence behind the argument
          </h2>
        </div>
        <div className="mt-5 divide-y divide-row-border border-y border-row-border">
          {payload.stories.map((story, index) => (
            <article
              className="grid gap-4 py-5 md:grid-cols-[3rem_minmax(0,1fr)_auto]"
              key={story.hnItemId}
            >
              <span className="font-mono text-xs text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
                  <span>{story.host ?? "Hacker News"}</span>
                  <span>/</span>
                  <span>Signal {story.signalScore}</span>
                </div>
                <h3 className="mt-2 text-xl font-semibold leading-7">
                  {story.title}
                </h3>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
                  {story.summary}
                </p>
                <p className="mt-3 max-w-3xl text-sm leading-7">
                  <span className="font-semibold">Why it matters:</span>{" "}
                  {story.whyItMatters}
                </p>
                <ul className="mt-3 grid gap-2 text-sm leading-6 text-foreground/85">
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
          accent="cyan"
          items={payload.practicalMoves}
          title="What to do with this"
        />
        <EditorialList
          accent="magenta"
          items={payload.whatToWatch}
          title="What Belle is watching"
        />
      </section>

      <section className="mt-8 border border-row-border bg-muted/10 p-5 md:p-7">
        <p className="page-kicker">Continue the story</p>
        <p className="mt-3 max-w-3xl text-xl font-medium leading-8">
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

      <footer className="mt-8 border-t border-row-border pt-5 text-xs leading-6 text-muted-foreground">
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
    <aside className="self-start border border-row-border bg-background p-4 lg:sticky lg:top-4">
      <p className="page-kicker">Signal map</p>
      <h2 className="mt-2 text-base font-semibold">{payload.chart.title}</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {payload.chart.subtitle}
      </p>
      <div className="mt-5 grid gap-4">
        {payload.chart.items.map((item) => (
          <div key={item.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase">
              <span>{item.label}</span>
              <span className="text-muted-foreground">{item.value}</span>
            </div>
            <div className="h-1.5 bg-muted">
              <div
                className="h-full bg-accent-magenta"
                style={{ width: `${Math.max(2, item.value)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
              {item.note}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-5 border-t border-row-border pt-3 font-mono text-[9px] uppercase text-muted-foreground">
        {payload.chart.metricLabel}
      </p>
    </aside>
  );
}

function EditorialList({
  accent,
  items,
  title,
}: {
  accent: "cyan" | "magenta";
  items: string[];
  title: string;
}) {
  return (
    <section className="border-t border-row-border pt-4">
      <p
        className={
          accent === "cyan"
            ? "page-kicker text-accent-cyan"
            : "page-kicker text-accent-magenta"
        }
      >
        {title}
      </p>
      <ul className="mt-4 grid gap-3">
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
    <article className="page-content">
      <p className="page-kicker">Archive edition</p>
      <h1 className="mt-3 text-3xl font-semibold md:text-5xl">
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
