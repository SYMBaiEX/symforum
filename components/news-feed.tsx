"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { convexRefs } from "@/lib/convex-refs";
import { compactNumber } from "@/lib/format";
import type { HnStory } from "@/lib/hn";
import { newsStoryPath } from "@/lib/news-slugs";
import { safeExternalUrl } from "@/lib/safe-url";
import { useQuery } from "convex/react";
import { ArrowUpRight, Bookmark, MessageSquare } from "lucide-react";
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
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-16 w-full bg-muted" />
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
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 py-1.5 font-mono text-[10px] uppercase text-muted-foreground">
        <span>Snapshot / {snapshotDate}</span>
        <span>Daily refresh via Vercel Cron</span>
      </div>
      <div className="grid gap-2">
        {stories.map((story) => {
          const sourceUrl = safeExternalUrl(story.url);
          const stats = story.platformStats ?? {
            comments: 0,
            score: 0,
            saves: 0,
          };

          return (
            <article
              key={story.hnItemId}
              className="group grid gap-3 py-3.5 transition-colors hover:bg-muted/30 md:grid-cols-[2.75rem_minmax(0,1fr)_minmax(25rem,max-content)] md:gap-4 md:px-2"
            >
              <div className="pt-1 font-mono text-[10px] uppercase text-muted-foreground md:text-right">
                #{story.rank.toString().padStart(2, "0")}
              </div>
              <div className="min-w-0 border-l border-row-border pl-4 transition-colors group-hover:border-primary">
                <div className="min-w-0">
                  <h2 className="font-sans text-base font-semibold leading-snug text-balance md:text-lg">
                    <Link
                      href={newsStoryPath(story)}
                      className="focus-ring inline-flex max-w-full items-baseline gap-2 transition-colors hover:text-primary"
                    >
                      <span>{story.title}</span>
                    </Link>
                  </h2>
                </div>
              </div>
              <div className="border-l border-transparent pl-4 font-mono text-[10px] uppercase text-muted-foreground md:border-0 md:pl-0 md:pt-1 md:text-right">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:flex-nowrap md:justify-end md:whitespace-nowrap">
                  <span>{story.host ?? "news.ycombinator.com"}</span>
                  {story.by ? <span>by {story.by}</span> : null}
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="size-3" />
                    {compactNumber(stats.comments)} comments
                  </span>
                  {stats.score > 0 ? (
                    <span>{compactNumber(stats.score)} pts</span>
                  ) : null}
                  {stats.saves > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <Bookmark className="size-3" />
                      {compactNumber(stats.saves)} saves
                    </span>
                  ) : null}
                  {sourceUrl ? (
                    <Link
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="focus-ring inline-flex items-center gap-1 transition-colors hover:text-foreground"
                      aria-label={`Open source article for ${story.title}`}
                    >
                      source
                      <ArrowUpRight className="size-3" />
                    </Link>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
