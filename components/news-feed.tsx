"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { convexRefs } from "@/lib/convex-refs";
import { compactNumber } from "@/lib/format";
import type { HnStory } from "@/lib/hn";
import { newsStoryPath } from "@/lib/news-slugs";
import { safeExternalUrl } from "@/lib/safe-url";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  MessageSquare,
} from "lucide-react";
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
          <Skeleton key={index} className="h-11 w-full" />
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
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-y border-row-border py-1.5 font-mono text-[10px] uppercase text-muted-foreground">
        <span>Snapshot / {snapshotDate}</span>
        <span>Daily refresh via Vercel Cron</span>
      </div>
      <div>
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
              className="grid gap-1 border-b border-row-border py-1.5 transition-colors hover:bg-muted/35 md:grid-cols-[2.25rem_minmax(0,1fr)_7.25rem] md:items-center md:gap-2 md:px-1.5"
            >
              <div className="font-mono text-[9px] uppercase text-muted-foreground">
                #{story.rank.toString().padStart(2, "0")}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-[13px] font-semibold leading-snug md:text-[15px]">
                  <Link
                    href={newsStoryPath(story)}
                    className="focus-ring inline-flex max-w-full items-center gap-1.5 transition-colors hover:text-primary"
                  >
                    <span className="truncate">{story.title}</span>
                    <ArrowRight className="size-3 shrink-0" />
                  </Link>
                </h2>
                <div className="mt-px flex flex-wrap gap-1.5 font-mono text-[9px] uppercase text-muted-foreground">
                  {story.host ? <span>{story.host}</span> : null}
                  {story.by ? <span>by {story.by}</span> : null}
                </div>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase text-muted-foreground md:justify-end">
                <span>{compactNumber(stats.score)}p</span>
                <span className="inline-flex items-center gap-1 text-foreground">
                  <MessageSquare className="size-2.5" />
                  {compactNumber(stats.comments)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Bookmark className="size-2.5" />
                  {compactNumber(stats.saves)}
                </span>
                {sourceUrl ? (
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="size-6"
                  >
                    <Link
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
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
