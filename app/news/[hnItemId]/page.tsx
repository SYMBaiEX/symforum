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
import { breadcrumbStructuredData, compactSeoTitle } from "@/lib/seo";
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
        "Austin Hamilton",
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
  const stats = story.platformStats ?? {
    comments: 0,
    score: 0,
    saves: 0,
  };

  return (
    <>
      <article className="page-frame">
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
          <h1 className="page-title mt-3">{story.title}</h1>
          <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground">
            <a
              href={`https://news.ycombinator.com/item?id=${story.hnItemId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
            >
              HN #{story.hnItemId}
            </a>
            {story.rank ? <span>Rank {story.rank}</span> : null}
            {story.timePosted ? (
              <span>{formatDate(story.timePosted * 1000)}</span>
            ) : null}
            <span>{story.host ?? "news.ycombinator.com"}</span>
            <span>{compactNumber(stats.score)} pts</span>
            <span>{compactNumber(stats.comments)} comments</span>
            <span>{compactNumber(stats.saves)} saves</span>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {sourceUrl ? (
              <Button asChild size="sm">
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                  Read source
                  <ArrowUpRight />
                </a>
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href="/news" prefetch>
                Back to index
              </Link>
            </Button>
            {convexEnabled ? (
              <InteractionBar entityType="hnStory" entityId={entityId} />
            ) : (
              <p className="font-mono text-xs uppercase text-muted-foreground">
                Connect Convex to enable voting and saves.
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
                This indexed story points to an external source article. Read
                the source, then come back here for the SYMBiEX discussion
                layer.
              </p>
            )}
          </section>

          <section className="page-content-readable mt-10">
            <h2 className="mb-3 font-mono text-xs uppercase">Thread</h2>
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
