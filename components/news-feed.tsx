"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { convexRefs } from "@/lib/convex-refs";
import { compactNumber } from "@/lib/format";
import type { HnStory } from "@/lib/hn";
import { newsStoryPath } from "@/lib/news-slugs";
import { useQuery } from "convex/react";
import { ArrowRight, ArrowUpRight, Bookmark, MessageSquare } from "lucide-react";
import Link from "next/link";

export function NewsFeed({
  enabled,
  initialStories,
}: {
  enabled: boolean;
  initialStories: HnStory[];
}) {
  if (!enabled) {
    return (
      <NewsRows snapshotDate="Live HN fallback" stories={initialStories} />
    );
  }
  return <LiveNewsFeed initialStories={initialStories} />;
}

function LiveNewsFeed({ initialStories }: { initialStories: HnStory[] }) {
  const data = useQuery(convexRefs.news.latest);
  if (data === undefined) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (data.stories.length === 0) {
    return (
      <NewsRows snapshotDate="Live HN fallback" stories={initialStories} />
    );
  }
  return (
    <NewsRows
      snapshotDate={data.snapshot?.snapshotDate ?? "Latest"}
      stories={data.stories}
    />
  );
}

function NewsRows({
  snapshotDate,
  stories,
}: {
  snapshotDate: string;
  stories: HnStory[];
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-y border-row-border py-2 font-mono text-[11px] uppercase text-muted-foreground">
        <span>Snapshot / {snapshotDate}</span>
        <span>Daily refresh via Vercel Cron</span>
      </div>
      <div>
        {stories.map((story) => {
          const stats = story.platformStats ?? {
            comments: 0,
            score: 0,
            saves: 0,
          };

          return (
            <article
              key={story.hnItemId}
              className="grid gap-2 border-b border-row-border py-3 transition-colors hover:bg-muted/35 md:grid-cols-[3rem_minmax(0,1fr)_auto] md:items-start md:gap-4 md:px-2"
            >
              <div className="font-mono text-[11px] uppercase text-muted-foreground">
                #{story.rank.toString().padStart(2, "0")}
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-snug md:text-lg">
                  <Link
                    href={newsStoryPath(story)}
                    className="focus-ring inline-flex items-center gap-2 transition-colors hover:text-primary"
                  >
                    {story.title}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </h2>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {story.host ? <span>{story.host}</span> : null}
                  {story.by ? <span>by {story.by}</span> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                <Badge variant="outline" className="font-mono uppercase">
                  {compactNumber(stats.score)} pts
                </Badge>
                <Badge
                  variant="secondary"
                  className="gap-1 bg-accent-canary text-black"
                >
                  <MessageSquare />
                  {compactNumber(stats.comments)} comments
                </Badge>
                <Badge variant="outline" className="gap-1 font-mono uppercase">
                  <Bookmark />
                  {compactNumber(stats.saves)} saves
                </Badge>
                <Button asChild variant="outline" size="sm">
                  <Link href={newsStoryPath(story)}>Discuss</Link>
                </Button>
                {story.url ? (
                  <Button asChild variant="ghost" size="icon">
                    <Link
                      href={story.url}
                      target="_blank"
                      aria-label={`Open source article for ${story.title}`}
                    >
                      <ArrowUpRight />
                    </Link>
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
