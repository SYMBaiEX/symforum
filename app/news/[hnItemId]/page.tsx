import { CommentsPanel } from "@/components/comments-panel";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { InteractionBar } from "@/components/interaction-bar";
import { SiteShell } from "@/components/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { compactNumber, formatDate } from "@/lib/format";
import { getIndexedStory, stripHnHtml } from "@/lib/indexed-news";
import { newsStorySlug, parseNewsStoryParam } from "@/lib/news-slugs";
import { safeExternalUrl } from "@/lib/safe-url";
import { ArrowUpRight, Bookmark, MessageSquare } from "lucide-react";
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
  return {
    title: story?.title ?? "Indexed story",
    description: story?.host
      ? `${story.host} indexed from Hacker News`
      : "Indexed Hacker News story",
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
    <SiteShell>
      <article className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-14">
        <div className="grid gap-7 md:grid-cols-12">
          <aside className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
            <div className="sticky top-24 flex flex-col gap-2 border-y border-row-border py-3">
              <span>HN #{story.hnItemId}</span>
              {story.rank ? <span>Rank {story.rank}</span> : null}
              {story.timePosted ? (
                <span>{formatDate(story.timePosted * 1000)}</span>
              ) : null}
              <span>{story.host ?? "news.ycombinator.com"}</span>
              <div className="flex flex-wrap gap-1.5 pt-2">
                <Badge variant="outline" className="font-mono uppercase">
                  {compactNumber(stats.score)} pts
                </Badge>
                <Badge
                  variant="secondary"
                  className="gap-1 font-mono uppercase"
                >
                  <MessageSquare />
                  {compactNumber(stats.comments)} comments
                </Badge>
                <Badge variant="outline" className="gap-1 font-mono uppercase">
                  <Bookmark />
                  {compactNumber(stats.saves)} saves
                </Badge>
              </div>
            </div>
          </aside>
          <div className="md:col-span-8">
            <p className="font-mono text-[11px] uppercase text-muted-foreground">
              Indexed article
            </p>
            <h1 className="mt-3 break-words text-3xl font-bold leading-tight text-balance md:text-5xl">
              {story.title}
            </h1>
            <div className="mt-5 flex flex-wrap gap-2">
              {sourceUrl ? (
                <Button asChild size="sm">
                  <Link
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Read source
                    <ArrowUpRight />
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant="outline" size="sm">
                <Link href="/news">Back to index</Link>
              </Button>
            </div>

            <div className="mt-6 border-y border-row-border py-3">
              {convexEnabled ? (
                <ConvexClientProvider>
                  <InteractionBar entityType="hnStory" entityId={entityId} />
                </ConvexClientProvider>
              ) : (
                <p className="font-mono text-xs uppercase text-muted-foreground">
                  Connect Convex to enable voting and saves.
                </p>
              )}
            </div>

            <section className="mt-6 border border-row-border bg-card/55 p-4">
              {body ? (
                <div className="flex flex-col gap-4">
                  {body.split(/\n{2,}/).map((paragraph) => (
                    <p
                      key={paragraph}
                      className="text-sm leading-7 md:text-base"
                    >
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

            <section className="mt-9">
              <h2 className="mb-3 font-mono text-xs uppercase">Comments</h2>
              {convexEnabled ? (
                <ConvexClientProvider>
                  <CommentsPanel
                    entityType="hnStory"
                    entityId={entityId}
                    enabled={convexEnabled}
                  />
                </ConvexClientProvider>
              ) : (
                <CommentsPanel
                  entityType="hnStory"
                  entityId={entityId}
                  enabled={convexEnabled}
                />
              )}
            </section>
          </div>
        </div>
      </article>
    </SiteShell>
  );
}
