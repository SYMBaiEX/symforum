"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { convexRefs, type NewsSnapshotRecord } from "@/lib/convex-refs";
import { compactNumber } from "@/lib/format";
import type { HnStory } from "@/lib/hn";
import { newsStoryPath } from "@/lib/news-slugs";
import { safeExternalUrl } from "@/lib/safe-url";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Bookmark,
  ChevronDown,
  ChevronUp,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export function NewsFeed({
  enabled,
  initialStories,
}: {
  enabled: boolean;
  initialStories: HnStory[];
}) {
  if (!enabled) {
    return (
      <NewsRows
        interactive={false}
        snapshotDate="Live HN fallback"
        stories={initialStories}
      />
    );
  }
  return <LiveNewsFeed initialStories={initialStories} />;
}

function LiveNewsFeed({ initialStories }: { initialStories: HnStory[] }) {
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const data = useQuery(
    convexRefs.news.timeline,
    selectedDate ? { snapshotDate: selectedDate } : {},
  );

  if (data === undefined) {
    return (
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-16 w-full bg-muted" />
        ))}
      </div>
    );
  }

  if (data.snapshot === null && data.snapshots.length === 0) {
    return (
      <NewsRows
        interactive
        snapshotDate="Live HN fallback"
        stories={initialStories}
      />
    );
  }
  return (
    <NewsRows
      interactive
      onSnapshotChange={setSelectedDate}
      selectedSnapshotDate={data.snapshot?.snapshotDate ?? selectedDate}
      snapshotDate={data.snapshot?.snapshotDate ?? "No snapshot"}
      snapshots={data.snapshots}
      stories={data.stories}
    />
  );
}

function NewsRows({
  interactive,
  onSnapshotChange,
  selectedSnapshotDate,
  snapshotDate,
  snapshots = [],
  stories,
}: {
  interactive: boolean;
  onSnapshotChange?: (snapshotDate: string) => void;
  selectedSnapshotDate?: string;
  snapshotDate: string;
  snapshots?: NewsSnapshotRecord[];
  stories: HnStory[];
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 py-1 font-mono text-[10px] uppercase text-muted-foreground">
        <span>Snapshot / {snapshotDate}</span>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <span>Daily refresh via Vercel Cron</span>
          {snapshots.length > 0 && onSnapshotChange ? (
            <SnapshotSelect
              onValueChange={onSnapshotChange}
              snapshots={snapshots}
              value={selectedSnapshotDate}
            />
          ) : null}
        </div>
      </div>
      <div className="grid gap-0.5">
        {stories.length === 0 ? (
          <div className="py-4 font-mono text-[10px] uppercase text-muted-foreground">
            No indexed stories for this snapshot yet.
          </div>
        ) : null}
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
              className="group grid items-center gap-2 py-2 transition-colors hover:bg-muted/30 md:grid-cols-[2.75rem_minmax(0,1fr)_minmax(25rem,max-content)] md:gap-4 md:px-2"
            >
              <div className="flex items-center font-mono text-[10px] uppercase text-muted-foreground md:justify-end md:text-right">
                #{story.rank.toString().padStart(2, "0")}
              </div>
              <div className="flex min-w-0 items-center border-l border-row-border pl-4 transition-colors group-hover:border-primary md:min-h-8">
                <div className="flex min-w-0 items-center gap-2.5">
                  {interactive ? (
                    <NewsVoteControl
                      entityId={String(story.hnItemId)}
                      initialScore={stats.score}
                      title={story.title}
                    />
                  ) : null}
                  <h2 className="font-sans text-[15px] font-semibold leading-snug text-balance md:text-base">
                    <Link
                      href={newsStoryPath(story)}
                      className="focus-ring inline-flex max-w-full items-baseline gap-2 transition-colors hover:text-primary"
                    >
                      <span>{story.title}</span>
                    </Link>
                  </h2>
                </div>
              </div>
              <div className="flex items-center border-l border-transparent pl-4 font-mono text-[10px] uppercase text-muted-foreground md:justify-end md:border-0 md:pl-0 md:text-right">
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

function SnapshotSelect({
  onValueChange,
  snapshots,
  value,
}: {
  onValueChange: (snapshotDate: string) => void;
  snapshots: NewsSnapshotRecord[];
  value?: string;
}) {
  return (
    <Select onValueChange={onValueChange} value={value}>
      <SelectTrigger
        aria-label="Select news snapshot date"
        className="h-7 w-[10.5rem] rounded-none border-row-border bg-background px-2 py-0 font-mono text-[10px] uppercase shadow-none"
      >
        <SelectValue placeholder="Select date" />
      </SelectTrigger>
      <SelectContent align="end" className="rounded-none">
        <SelectGroup>
          {snapshots.map((snapshot) => {
            const disabled =
              snapshot.status !== "complete" || snapshot.storyCount === 0;
            return (
              <SelectItem
                key={snapshot.snapshotDate}
                className="font-mono text-[10px] uppercase"
                disabled={disabled}
                value={snapshot.snapshotDate}
              >
                {formatSnapshotLabel(snapshot)}
              </SelectItem>
            );
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function formatSnapshotLabel(snapshot: NewsSnapshotRecord) {
  const date = new Date(`${snapshot.snapshotDate}T12:00:00`);
  const label = Number.isNaN(date.valueOf())
    ? snapshot.snapshotDate
    : new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
  const status = snapshot.status === "complete" ? "" : ` / ${snapshot.status}`;
  const count = snapshot.storyCount > 0 ? ` / ${snapshot.storyCount}` : "";

  return `${label}${status}${count}`;
}

function NewsVoteControl({
  entityId,
  initialScore,
  title,
}: {
  entityId: string;
  initialScore: number;
  title: string;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const summary = useQuery(convexRefs.interactions.summary, {
    entityType: "hnStory",
    entityId,
  });
  const setInteraction = useMutation(convexRefs.interactions.set);
  const [authOpen, setAuthOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const viewer = summary?.viewer;
  const vote: -1 | 0 | 1 =
    viewer?.vote === 1 ? 1 : viewer?.vote === -1 ? -1 : 0;
  const score = summary?.score ?? initialScore;
  const voteDisabled = isLoading || (isAuthenticated && !summary) || pending;

  async function onVote(nextVote: -1 | 1) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }
    setPending(true);
    try {
      await setInteraction({
        entityType: "hnStory",
        entityId,
        vote: vote === nextVote ? 0 : nextVote,
        saved: viewer?.saved ?? false,
      });
    } catch {
      setAuthOpen(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground">
        <Button
          aria-label={
            vote === 1 ? `Remove upvote for ${title}` : `Upvote ${title}`
          }
          aria-pressed={vote === 1}
          className="size-5 border border-row-border bg-background/60 p-0 hover:border-foreground"
          disabled={voteDisabled}
          onClick={() => void onVote(1)}
          size="icon"
          type="button"
          variant={vote === 1 ? "default" : "ghost"}
        >
          <ChevronUp />
        </Button>
        <span className="min-w-4 text-center leading-none">
          {compactNumber(score)}
        </span>
        <Button
          aria-label={
            vote === -1 ? `Remove downvote for ${title}` : `Downvote ${title}`
          }
          aria-pressed={vote === -1}
          className="size-5 border border-row-border bg-background/60 p-0 hover:border-foreground"
          disabled={voteDisabled}
          onClick={() => void onVote(-1)}
          size="icon"
          type="button"
          variant={vote === -1 ? "default" : "ghost"}
        >
          <ChevronDown />
        </Button>
      </div>
      <Dialog open={authOpen} onOpenChange={setAuthOpen}>
        <DialogContent className="rounded-none sm:max-w-sm sm:rounded-none">
          <DialogHeader>
            <DialogTitle>Sign in to vote</DialogTitle>
            <DialogDescription>
              Use a SYM handle to upvote, downvote, save, and comment on the
              SYMBiEX news layer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-start sm:space-x-0">
            <Button asChild>
              <Link href="/signin?mode=signUp&redirectTo=/news">Sign up</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/signin?mode=signIn&redirectTo=/news">Sign in</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
