"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { convexRefs } from "@/lib/convex-refs";
import { compactNumber } from "@/lib/format";
import type { HnStory } from "@/lib/hn";
import { useQuery } from "convex/react";
import { ArrowRight, ArrowUpRight, MessageSquare } from "lucide-react";
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
      <div className="flex flex-col gap-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 font-mono text-xs uppercase text-muted-foreground">
        <span>Snapshot / {snapshotDate}</span>
        <span>Daily refresh via Vercel Cron</span>
      </div>
      <div className="border-t border-row-border">
        {stories.map((story) => (
          <article
            key={story.hnItemId}
            className="grid gap-4 border-b border-row-border py-5 transition-colors hover:bg-muted/45 md:grid-cols-12 md:px-3"
          >
            <div className="font-mono text-xs uppercase text-muted-foreground md:col-span-2">
              #{story.rank.toString().padStart(2, "0")}
            </div>
            <div className="md:col-span-7">
              <h2 className="text-xl font-semibold leading-snug">
                <Link
                  href={`/news/${story.hnItemId}`}
                  className="focus-ring inline-flex items-center gap-2 transition-colors hover:text-primary"
                >
                  {story.title}
                  <ArrowRight />
                </Link>
              </h2>
              <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
                {story.host ? <span>{story.host}</span> : null}
                {story.by ? <span>by {story.by}</span> : null}
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-2 md:col-span-3 md:justify-end">
              <Badge variant="outline" className="font-mono uppercase">
                {compactNumber(story.score)} pts
              </Badge>
              <Badge
                variant="secondary"
                className="gap-1 bg-accent-canary text-black"
              >
                <MessageSquare />
                {compactNumber(story.descendants)}
              </Badge>
              <Button asChild variant="outline" size="sm">
                <Link href={`/news/${story.hnItemId}`}>Discuss</Link>
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
        ))}
      </div>
    </div>
  );
}
