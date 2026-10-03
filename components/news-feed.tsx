"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  convexRefs,
  type InteractionSummaryRecord,
  type NewsSnapshotRecord,
  type NewsTimelineRecord,
} from "@/lib/convex-refs";
import { isAuthRequiredError } from "@/lib/auth-errors";
import { ConvexError } from "convex/values";
import { compactNumber } from "@/lib/format";
import type { HnStory } from "@/lib/hn";
import { emptyNewsFeedState } from "@/lib/news-feed-state";
import { newsStoryPath } from "@/lib/news-slugs";
import { safeExternalUrl } from "@/lib/safe-url";
import { primarySiteUrl } from "@/lib/site-urls";
import { asRoute } from "@/lib/typed-route";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Bookmark,
  ChevronDown,
  ChevronUp,
  MessageSquare,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";

const AuthRequiredDialog = dynamic(
  () =>
    import("@/components/auth-required-dialog").then(
      (module) => module.AuthRequiredDialog,
    ),
  { ssr: false },
);

export function NewsFeed({
  enabled,
  initialStories,
  initialTimeline,
}: {
  enabled: boolean;
  initialStories: HnStory[];
  initialTimeline?: NewsTimelineRecord | null;
}) {
  if (!enabled) {
    return <NewsRows interactive={false} stories={initialStories} />;
  }
  return (
    <NewsFeedErrorBoundary
      fallback={<NewsRows interactive={false} stories={initialStories} />}
    >
      <LiveNewsFeed
        initialStories={initialStories}
        initialTimeline={initialTimeline ?? null}
      />
    </NewsFeedErrorBoundary>
  );
}

class NewsFeedErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function LiveNewsFeed({
  initialStories,
  initialTimeline,
}: {
  initialStories: HnStory[];
  initialTimeline: NewsTimelineRecord | null;
}) {
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [visibleData, setVisibleData] = useState<NewsTimelineRecord | null>(
    initialTimeline,
  );
  const data = useQuery(
    convexRefs.news.timeline,
    selectedDate
      ? { snapshotDate: selectedDate }
      : initialTimeline === null
        ? {}
        : "skip",
  );
  const pending = selectedDate !== undefined && data === undefined;

  useEffect(() => {
    if (data !== undefined) {
      setVisibleData(data);
    }
  }, [data]);

  function onSnapshotChange(snapshotDate: string) {
    setSelectedDate(snapshotDate);
  }

  const showLiveFallback =
    selectedDate === undefined &&
    visibleData !== null &&
    visibleData.stories.length === 0 &&
    initialStories.length > 0;

  if (showLiveFallback && visibleData !== null) {
    return (
      <NewsRows
        interactive
        onSnapshotChange={onSnapshotChange}
        snapshots={visibleData.snapshots}
        stories={initialStories}
      />
    );
  }

  if (visibleData === null) {
    const emptyState = emptyNewsFeedState({
      queryResolved: data !== undefined,
      fallbackStoryCount: initialStories.length,
      selectedDate,
    });
    if (emptyState === "loading") {
      return (
        <div className="py-8 text-sm text-muted-foreground">
          Loading stories…
        </div>
      );
    }
    if (emptyState === "fallback") {
      return <NewsRows interactive stories={initialStories} />;
    }
    return (
      <div
        className="py-8 text-sm leading-6 text-muted-foreground"
        role="status"
      >
        The news index is temporarily unavailable. Try again shortly.
      </div>
    );
  }

  const selectedSnapshotDate =
    selectedDate ?? visibleData.snapshot?.snapshotDate;

  return (
    <NewsRows
      interactive
      onSnapshotChange={onSnapshotChange}
      pending={pending}
      selectedSnapshotDate={selectedSnapshotDate}
      snapshots={visibleData.snapshots}
      stories={visibleData.stories}
    />
  );
}

function NewsRows({
  interactive,
  onSnapshotChange,
  pending,
  selectedSnapshotDate,
  snapshots = [],
  stories,
}: {
  interactive: boolean;
  onSnapshotChange?: (snapshotDate: string) => void;
  pending?: boolean;
  selectedSnapshotDate?: string;
  snapshots?: NewsSnapshotRecord[];
  stories: HnStory[];
}) {
  if (interactive) {
    return (
      <InteractiveNewsRows
        onSnapshotChange={onSnapshotChange}
        pending={pending}
        selectedSnapshotDate={selectedSnapshotDate}
        snapshots={snapshots}
        stories={stories}
      />
    );
  }

  return (
    <NewsRowsView
      authLoading={false}
      interactive={false}
      isAuthenticated={false}
      onSnapshotChange={onSnapshotChange}
      pending={pending}
      selectedSnapshotDate={selectedSnapshotDate}
      snapshots={snapshots}
      stories={stories}
      summaries={null}
    />
  );
}

function InteractiveNewsRows({
  onSnapshotChange,
  pending,
  selectedSnapshotDate,
  snapshots = [],
  stories,
}: {
  onSnapshotChange?: (snapshotDate: string) => void;
  pending?: boolean;
  selectedSnapshotDate?: string;
  snapshots?: NewsSnapshotRecord[];
  stories: HnStory[];
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const entityIds = useMemo(
    () => stories.map((story) => String(story.hnItemId)),
    [stories],
  );
  const summaries = useQuery(
    convexRefs.interactions.summaries,
    entityIds.length > 0 ? { entityType: "hnStory", entityIds } : "skip",
  );

  return (
    <NewsRowsView
      authLoading={isLoading}
      interactive
      isAuthenticated={isAuthenticated}
      onSnapshotChange={onSnapshotChange}
      pending={pending}
      selectedSnapshotDate={selectedSnapshotDate}
      snapshots={snapshots}
      stories={stories}
      summaries={summaries}
    />
  );
}

function NewsRowsView({
  authLoading,
  interactive,
  isAuthenticated,
  onSnapshotChange,
  pending,
  selectedSnapshotDate,
  snapshots = [],
  stories,
  summaries,
}: {
  authLoading: boolean;
  interactive: boolean;
  isAuthenticated: boolean;
  onSnapshotChange?: (snapshotDate: string) => void;
  pending?: boolean;
  selectedSnapshotDate?: string;
  snapshots?: NewsSnapshotRecord[];
  stories: HnStory[];
  summaries: Record<string, InteractionSummaryRecord> | null | undefined;
}) {
  const showSnapshotControl = Boolean(onSnapshotChange);

  return (
    <div>
      {showSnapshotControl ? (
        <NewsFilterBar>
          {snapshots.length > 0 && onSnapshotChange ? (
            <SnapshotSelect
              ariaLabelledBy="news-snapshot-filter-label"
              onValueChange={onSnapshotChange}
              snapshots={snapshots}
              value={selectedSnapshotDate}
            />
          ) : (
            <DisabledSnapshotControl label="No indexed days" />
          )}
        </NewsFilterBar>
      ) : null}
      <div
        aria-busy={pending}
        aria-label="Hacker News stories"
        className={`space-y-7 transition-opacity${pending ? " opacity-50" : ""}`}
      >
        {stories.length === 0 ? (
          <p className="py-8 text-sm text-muted-foreground" role="status">
            No indexed stories for this snapshot yet.
          </p>
        ) : null}
        {stories.map((story) => {
          const sourceUrl = safeExternalUrl(story.url);
          const entityId = String(story.hnItemId);
          const summary = summaries?.[entityId];
          const stats = summary ??
            story.platformStats ?? {
              comments: 0,
              score: 0,
              saves: 0,
            };
          const discussionUrl = asRoute(primarySiteUrl(newsStoryPath(story)));
          const hnUrl = `https://news.ycombinator.com/item?id=${story.hnItemId}`;

          return (
            <article
              key={story.hnItemId}
              className="group rounded-xl px-3 py-3 transition-colors hover:bg-muted/40 sm:px-4"
            >
              <div className="flex items-start gap-3 sm:gap-4">
                {interactive ? (
                  <NewsVoteControl
                    authLoading={authLoading}
                    entityId={entityId}
                    initialScore={stats.score}
                    isAuthenticated={isAuthenticated}
                    summary={summary}
                    title={story.title}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <a
                      href={hnUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="focus-ring rounded-sm text-primary transition-colors hover:text-foreground"
                      aria-label={`View ${story.title} on Hacker News`}
                    >
                      Hacker News
                    </a>
                    {story.host ? <span>{story.host}</span> : null}
                  </div>
                  <h2 className="font-sans text-xl font-semibold leading-7 tracking-[-0.02em]">
                    <Link
                      href={discussionUrl}
                      prefetch
                      className="focus-ring rounded-sm transition-colors hover:text-primary"
                    >
                      {story.title}
                    </Link>
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground">
                    {story.score !== undefined ? (
                      <span>{compactNumber(story.score)} HN points</span>
                    ) : null}
                    {story.descendants !== undefined ? (
                      <a
                        href={hnUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="focus-ring rounded-sm transition-colors hover:text-foreground"
                      >
                        {compactNumber(story.descendants)} HN comments
                      </a>
                    ) : null}
                    {story.by ? <span>Submitted by {story.by}</span> : null}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
                    <Link
                      href={discussionUrl}
                      prefetch
                      className="focus-ring inline-flex items-center gap-1.5 rounded-sm transition-colors hover:text-foreground"
                    >
                      <MessageSquare aria-hidden="true" className="size-3.5" />
                      {stats.comments > 0
                        ? `${compactNumber(stats.comments)} SYMBaiEX comments`
                        : "Discuss on SYMBaiEX"}
                    </Link>
                    {!interactive && stats.score !== 0 ? (
                      <span>{compactNumber(stats.score)} SYMBaiEX votes</span>
                    ) : null}
                    {stats.saves > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Bookmark aria-hidden="true" className="size-3.5" />
                        {compactNumber(stats.saves)} saves
                      </span>
                    ) : null}
                    {sourceUrl ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="focus-ring inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground"
                        aria-label={`Read source article for ${story.title}`}
                      >
                        Read source
                        <ArrowUpRight aria-hidden="true" className="size-3.5" />
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function NewsFilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-6 flex items-center gap-3 px-3 text-[13px] text-muted-foreground sm:px-4">
      <span id="news-snapshot-filter-label">Edition</span>
      {children}
    </div>
  );
}

function DisabledSnapshotControl({ label }: { label: string }) {
  return (
    <button
      aria-labelledby="news-snapshot-filter-label"
      className="h-9 w-[13rem] rounded-lg bg-muted/50 px-3 text-left text-xs text-muted-foreground"
      disabled
      type="button"
    >
      {label}
    </button>
  );
}

function SnapshotSelect({
  ariaLabelledBy,
  onValueChange,
  snapshots,
  value,
}: {
  ariaLabelledBy?: string;
  onValueChange: (snapshotDate: string) => void;
  snapshots: NewsSnapshotRecord[];
  value?: string;
}) {
  return (
    <Select onValueChange={onValueChange} value={value}>
      <SelectTrigger
        aria-labelledby={ariaLabelledBy}
        className="h-9 w-[13rem] rounded-lg border-transparent bg-muted/50 px-3 py-0 text-xs shadow-none"
      >
        <SelectValue placeholder="Select date" />
      </SelectTrigger>
      <SelectContent align="end" className="rounded-lg">
        <SelectGroup>
          {snapshots.map((snapshot) => {
            const disabled =
              snapshot.status !== "complete" || snapshot.storyCount === 0;
            return (
              <SelectItem
                key={snapshot.snapshotDate}
                className="text-xs"
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
  authLoading,
  entityId,
  initialScore,
  isAuthenticated,
  summary,
  title,
}: {
  authLoading: boolean;
  entityId: string;
  initialScore: number;
  isAuthenticated: boolean;
  summary?: InteractionSummaryRecord;
  title: string;
}) {
  const setInteraction = useMutation(convexRefs.interactions.set);
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const viewer = summary?.viewer;
  const vote: -1 | 0 | 1 =
    viewer?.vote === 1 ? 1 : viewer?.vote === -1 ? -1 : 0;
  const score = summary?.score ?? initialScore;
  const voteDisabled = authLoading || (isAuthenticated && !summary) || pending;

  async function onVote(nextVote: -1 | 1) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }
    setPending(true);
    setError("");
    try {
      await setInteraction({
        entityType: "hnStory",
        entityId,
        vote: vote === nextVote ? 0 : nextVote,
        saved: viewer?.saved ?? false,
      });
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "news",
        eventType: "vote_failed",
        component: "NewsVoteControl",
        action: "interactions:set",
        entityType: "hnStory",
        entityId,
        metadata: { vote: nextVote },
        notify: false,
      });
      const data = caught instanceof ConvexError ? caught.data : null;
      setError(
        data !== null &&
          typeof data === "object" &&
          "message" in data &&
          typeof data.message === "string"
          ? data.message
          : "Could not update vote. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div
        className="flex w-8 shrink-0 flex-col items-center gap-1 text-xs text-muted-foreground"
        role="group"
        aria-label={`SYMBaiEX votes for ${title}`}
      >
        <Button
          aria-label={
            vote === 1 ? `Remove upvote for ${title}` : `Upvote ${title}`
          }
          aria-pressed={vote === 1}
          className="size-8 rounded-lg border-0 p-0 hover:bg-muted"
          disabled={voteDisabled}
          onClick={() => void onVote(1)}
          size="icon"
          type="button"
          variant={vote === 1 ? "default" : "ghost"}
        >
          <ChevronUp />
        </Button>
        <span className="min-w-4 py-0.5 text-center font-medium leading-none">
          {compactNumber(score)}
        </span>
        <Button
          aria-label={
            vote === -1 ? `Remove downvote for ${title}` : `Downvote ${title}`
          }
          aria-pressed={vote === -1}
          className="size-8 rounded-lg border-0 p-0 hover:bg-muted"
          disabled={voteDisabled}
          onClick={() => void onVote(-1)}
          size="icon"
          type="button"
          variant={vote === -1 ? "default" : "ghost"}
        >
          <ChevronDown />
        </Button>
      </div>
      {error ? (
        <span className="text-xs text-muted-foreground" role="status">
          {error}
        </span>
      ) : null}
      {authOpen ? (
        <AuthRequiredDialog
          action="vote and discuss"
          open
          redirectTo="/news"
          setOpen={setAuthOpen}
        />
      ) : null}
    </>
  );
}
