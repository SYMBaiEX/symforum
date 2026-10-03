import { CommentsPanel } from "@/components/comments-panel";
import { InteractionBar } from "@/components/interaction-bar";
import { StructuredData } from "@/components/structured-data";
import { Button } from "@/components/ui/button";
import { compactNumber, formatDate } from "@/lib/format";
import { getIndexedStory, stripHnHtml } from "@/lib/indexed-news";
import {
  newsStoryPath,
  newsStorySlug,
  parseNewsStoryParam,
} from "@/lib/news-slugs";
import { safeExternalUrl } from "@/lib/safe-url";
import {
  breadcrumbStructuredData,
  compactSeoTitle,
  SITE_BRAND,
} from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

type PageProps = {
  params: Promise<{ hnItemId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { hnItemId } = await params;
  const storyId = parseNewsStoryParam(hnItemId);
  const story = storyId === null ? null : await getIndexedStory(storyId);
  const canonical = story
    ? primarySiteUrl(newsStoryPath(story))
    : primarySiteUrl(`/news/${encodeURIComponent(hnItemId)}`);
  return {
    title: {
      absolute: compactSeoTitle(
        story?.title ?? "Indexed story",
        SITE_BRAND,
      ),
    },
    description: story?.host
      ? `${story.host} indexed from Hacker News`
      : "Indexed Hacker News story",
    alternates: { canonical },
    robots: story ? undefined : { index: false, follow: false },
    openGraph: story
      ? {
          type: "article",
          url: canonical,
          title: story.title,
          description: story.host
            ? `${story.host} indexed from Hacker News`
            : "Indexed Hacker News story",
          publishedTime: story.timePosted
            ? new Date(story.timePosted * 1000).toISOString()
            : undefined,
          images: [
            {
              url: `${primarySiteUrl("/")}opengraph-image`,
              alt: `SYMBaiEX indexed news story: ${story.title}`,
            },
          ],
        }
      : undefined,
    twitter: story
      ? {
          card: "summary_large_image",
          title: story.title,
          description: story.host
            ? `${story.host} indexed from Hacker News`
            : "Indexed Hacker News story",
          images: [`${primarySiteUrl("/")}opengraph-image`],
        }
      : undefined,
  };
}

export default async function NewsStoryPage({ params }: PageProps) {
  const { hnItemId } = await params;
  const storyId = parseNewsStoryParam(hnItemId);
  if (storyId === null || !Number.isInteger(storyId)) {
    notFound();
  }
  const story = await getIndexedStory(storyId);
  if (!story) {
    notFound();
  }
  const canonicalSlug = newsStorySlug(story);
  if (hnItemId !== canonicalSlug) {
    permanentRedirect(`/news/${canonicalSlug}`);
  }

  const convexEnabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const body = stripHnHtml(story.text);
  const entityId = String(story.hnItemId);
  const sourceUrl = safeExternalUrl(story.url);

  return (
    <>
      <article className="page-frame max-w-[820px]">
        <StructuredData
          data={[
            {
              "@type": "NewsArticle",
              "@id": `${primarySiteUrl(newsStoryPath(story))}#article`,
              headline: story.title,
              description: story.host
                ? `${story.host} indexed from Hacker News`
                : "Indexed Hacker News story",
              datePublished: story.timePosted
                ? new Date(story.timePosted * 1000).toISOString()
                : undefined,
              mainEntityOfPage: {
                "@id": primarySiteUrl(newsStoryPath(story)),
              },
              isBasedOn: story.url,
              author: { "@type": "Organization", name: "Hacker News" },
            },
            breadcrumbStructuredData([
              { name: "Home", url: primarySiteUrl("/") },
              { name: "News", url: primarySiteUrl("/news") },
              {
                name: story.title,
                url: primarySiteUrl(newsStoryPath(story)),
              },
            ]),
          ]}
        />
        <div className="page-content">
          <Link
            href="/news"
            className="focus-ring mb-6 inline-flex rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Daily news
          </Link>
          <h1 className="text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">
            {story.title}
          </h1>
          <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[13px] leading-6 text-muted-foreground">
            <a
              href={`https://news.ycombinator.com/item?id=${story.hnItemId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring rounded-sm text-primary transition-colors hover:text-foreground"
            >
              Hacker News
            </a>
            {story.timePosted ? (
              <span>{formatDate(story.timePosted * 1000)}</span>
            ) : null}
            <span>{story.host ?? "news.ycombinator.com"}</span>
            {story.score !== undefined ? (
              <span>{compactNumber(story.score)} HN points</span>
            ) : null}
            {story.descendants !== undefined ? (
              <span>{compactNumber(story.descendants)} HN comments</span>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {sourceUrl ? (
              <Button asChild size="sm">
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                  Read source
                  <ArrowUpRight />
                </a>
              </Button>
            ) : null}
            {convexEnabled ? (
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label="SYMBaiEX votes and saves"
              >
                <span className="text-xs text-muted-foreground">SYMBaiEX</span>
                <InteractionBar entityType="hnStory" entityId={entityId} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Voting and saves are temporarily unavailable.
              </p>
            )}
          </div>

          <section className="page-content-readable mt-8">
            {body ? (
              <div className="flex flex-col gap-4">
                {body.split(/\n{2,}/).map((paragraph, index) => (
                  <p key={index} className="text-sm leading-7 md:text-base">
                    {paragraph}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-7 text-muted-foreground md:text-base">
                Read the original article at {story.host ?? "the source"}, then
                share your thoughts with the community below.
              </p>
            )}
          </section>

          <section className="page-content-readable mt-10">
            <h2 className="mb-5 text-xl font-semibold tracking-tight">
              SYMBaiEX discussion
            </h2>
            <CommentsPanel
              entityType="hnStory"
              entityId={entityId}
              enabled={convexEnabled}
            />
          </section>
        </div>
      </article>
    </>
  );
}
