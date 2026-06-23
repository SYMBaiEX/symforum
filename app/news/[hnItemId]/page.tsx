import { CommentsPanel } from "@/components/comments-panel";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { InteractionBar } from "@/components/interaction-bar";
import { SiteShell } from "@/components/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getIndexedStory, stripHnHtml } from "@/lib/indexed-news";
import { compactNumber, formatDate } from "@/lib/format";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ hnItemId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { hnItemId } = await params;
  const story = await getIndexedStory(Number(hnItemId));
  return {
    title: story?.title ?? "Indexed story",
    description: story?.host
      ? `${story.host} indexed from Hacker News`
      : "Indexed Hacker News story",
  };
}

export default async function NewsStoryPage({ params }: PageProps) {
  const { hnItemId } = await params;
  const storyId = Number(hnItemId);
  if (!Number.isInteger(storyId)) {
    notFound();
  }
  const story = await getIndexedStory(storyId);
  if (!story) {
    notFound();
  }

  const convexEnabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const body = stripHnHtml(story.text);
  const entityId = String(story.hnItemId);

  return (
    <SiteShell>
      <article className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-24">
        <div className="grid gap-10 md:grid-cols-12">
          <aside className="font-mono text-xs uppercase text-muted-foreground md:col-span-3">
            <div className="sticky top-24 flex flex-col gap-3">
              <span>HN #{story.hnItemId}</span>
              {story.rank ? <span>Rank {story.rank}</span> : null}
              {story.timePosted ? (
                <span>{formatDate(story.timePosted * 1000)}</span>
              ) : null}
              <span>{story.host ?? "news.ycombinator.com"}</span>
              <div className="flex flex-wrap gap-2 pt-4">
                <Badge variant="outline" className="font-mono uppercase">
                  {compactNumber(story.score)} pts
                </Badge>
                <Badge variant="secondary" className="font-mono uppercase">
                  {compactNumber(story.descendants)} HN comments
                </Badge>
              </div>
            </div>
          </aside>
          <div className="md:col-span-8">
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Indexed article
            </p>
            <h1 className="mt-5 break-words text-5xl font-bold leading-[0.92] text-balance md:text-7xl">
              {story.title}
            </h1>
            <div className="mt-8 flex flex-wrap gap-3">
              {story.url ? (
                <Button asChild>
                  <Link href={story.url} target="_blank">
                    Read source
                    <ArrowUpRight />
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <Link href="/news">Back to index</Link>
              </Button>
            </div>

            <div className="mt-10 border-y border-row-border py-5">
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

            <section className="mt-10 border border-row-border bg-card/55 p-5">
              {body ? (
                <div className="flex flex-col gap-5">
                  {body.split(/\n{2,}/).map((paragraph) => (
                    <p key={paragraph} className="leading-8">
                      {paragraph}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="leading-8 text-muted-foreground">
                  This indexed story points to an external source article. Read
                  the source, then come back here for the SYMBiEX discussion
                  layer.
                </p>
              )}
            </section>

            <section className="mt-14">
              <h2 className="mb-5 font-mono text-sm uppercase">Comments</h2>
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
