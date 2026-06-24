import type { HnStory } from "@/lib/hn";
import { newsStoryPath } from "@/lib/news-slugs";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function DailyNewsList({ stories }: { stories: HnStory[] }) {
  if (stories.length === 0) {
    return (
      <div className="py-4 font-mono text-xs uppercase text-muted-foreground">
        No daily news yet.
      </div>
    );
  }

  return (
    <div className="grid gap-1">
      {stories.slice(0, 5).map((story) => (
        <Link
          key={story.hnItemId}
          href={newsStoryPath(story)}
          className="focus-ring group grid gap-1 py-2 transition-colors hover:bg-muted/35 md:grid-cols-[2.25rem_minmax(0,1fr)_9rem] md:items-center md:gap-3 md:px-3"
        >
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            #{story.rank.toString().padStart(2, "0")}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold leading-snug md:text-base">
            <span className="truncate">{story.title}</span>
            <ArrowRight className="size-3 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
          </span>
          <span className="truncate font-mono text-[10px] uppercase text-muted-foreground md:text-right">
            {story.host ?? "news.ycombinator.com"}
          </span>
        </Link>
      ))}
    </div>
  );
}
