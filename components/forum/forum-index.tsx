"use client";

import { reportAppError } from "@/components/app-error-surface";
import { NewsFeed } from "@/components/news-feed";
import { Button } from "@/components/ui/button";
import { userFacingError } from "@/lib/auth-errors";
import type { NewsTimelineRecord } from "@/lib/convex-refs";
import type { HnStory } from "@/lib/hn";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useConvex, useConvexAuth, useMutation } from "convex/react";
import { ArrowUpRight, Users, Search, X, CheckCheck } from "lucide-react";
import { useCallback, useState } from "react";
import {
  ForumBodyGrid,
  ForumPageHeader,
  forumQuietAction,
} from "./forum-layout-primitives";
import { toast } from "sonner";
import { ForumFeedList } from "./forum-feed-list";
import { ForumChat } from "./forum-chat";
import { ForumWelcome } from "./forum-start-here";
import { ForumGroupedBoards } from "./forum-grouped-boards";
import {
  forumHomeHref,
  type ForumHomeView,
  type ForumFeedSort,
} from "./forum-home-model";
import { ForumAvatar, ForumLink, ForumStatusBox } from "./forum-primitives";
import {
  formatForumCount,
  forumAnnouncementPath,
  forumMemberProfilePath,
  forumRefs,
  type ForumOnlineSummaryRecord,
  type ForumOverviewRecord,
} from "./forum-refs";
import { useForegroundSnapshot } from "./use-foreground-snapshot";

export type ForumIndexProps = {
  enabled: boolean;
  view?: ForumHomeView;
  sort?: ForumFeedSort;
  initialStories?: HnStory[];
  initialTimeline?: NewsTimelineRecord | null;
};
const quietLink = forumQuietAction;

export function ForumIndex({
  enabled,
  view = "feed",
  sort = "active",
  initialStories = [],
  initialTimeline = null,
}: ForumIndexProps) {
  if (!enabled)
    return (
      <div>
        <ForumHomeHeader view={view} sort={sort} />
        <div className="mt-4">
          {view === "news" ? (
            <NewsFeed
              variant="forum"
              enabled={false}
              initialStories={initialStories}
              initialTimeline={initialTimeline}
            />
          ) : (
            <ForumStatusBox
              title="Forum unavailable locally"
              body="Connect the local backend to browse discussions and boards."
              accent="cyan"
            />
          )}
        </div>
      </div>
    );
  return (
    <LiveForumIndex
      view={view}
      sort={sort}
      initialStories={initialStories}
      initialTimeline={initialTimeline}
    />
  );
}

function LiveForumIndex({
  view = "feed",
  sort = "active",
  initialStories = [],
  initialTimeline = null,
}: Omit<ForumIndexProps, "enabled">) {
  const convex = useConvex();
  const overview = useQuery(forumRefs.overview, {});
  const loadOnlineSummary = useCallback(
    () => convex.query(forumRefs.onlineSummary, { now: Date.now() }),
    [convex],
  );
  const handleOnlineSummaryError = useCallback(
    (error: unknown) =>
      reportAppError(error, {
        scope: "forum",
        eventType: "forum_online_summary_failed",
        component: "ForumIndex",
        action: "forum:onlineSummary",
        notify: false,
      }),
    [],
  );
  const { snapshot, refreshError, refreshNow } = useForegroundSnapshot(
    "forum-index-online-summary",
    loadOnlineSummary,
    { onError: handleOnlineSummaryError },
  );
  const news = initialTimeline?.stories.length
    ? initialTimeline.stories
    : initialStories;

  return (
    <div>
      {view === "boards" || view === "news" ? (
        <ForumHomeHeader overview={overview} view={view} sort={sort} />
      ) : null}
      <ForumBodyGrid
        sidebar={
          <ForumHomeRail
            overview={overview}
            online={snapshot?.data}
            onlineRefreshError={refreshError}
            refreshOnlineSummary={refreshNow}
            news={view === "news" ? [] : news}
          />
        }
      >
        {view === "feed" ? <ForumWelcome /> : null}
        <ForumChat />
        {view === "news" ? (
          <NewsFeed
            variant="forum"
            enabled
            initialStories={initialStories}
            initialTimeline={initialTimeline}
          />
        ) : view === "boards" ? (
          overview === undefined ? (
            <p
              role="status"
              aria-busy="true"
              className="py-8 text-sm text-muted-foreground"
            >
              Loading boards…
            </p>
          ) : (
            <ForumBoards overview={overview} />
          )
        ) : (
          <ForumFeedList sort={sort} communityOnly={view === "community"} />
        )}
      </ForumBodyGrid>
    </div>
  );
}

function ForumHomeHeader({
  view,
}: {
  overview?: ForumOverviewRecord;
  view: ForumHomeView;
  sort: ForumFeedSort;
}) {
  return (
    <ForumPageHeader
      title={
        view === "feed"
          ? "Feed"
          : view === "news"
            ? "News"
            : view === "community"
              ? "Community"
              : "Boards"
      }
      view={view}
    />
  );
}

function ForumBoards({ overview }: { overview: ForumOverviewRecord }) {
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const markAllForumsRead = useMutation(forumRefs.markAllForumsRead);
  const { isAuthenticated, isLoading } = useConvexAuth();
  async function markAllRead() {
    if (!isAuthenticated) {
      toast.error("Sign in to mark all forums read");
      return;
    }
    setPending(true);
    try {
      const result = await markAllForumsRead({});
      toast.success(
        result.categoryCount === 0
          ? "No visible boards to mark"
          : `Marked ${result.categoryCount} board${result.categoryCount === 1 ? "" : "s"} read`,
      );
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "forum_mark_all_read_failed",
        component: "ForumIndex",
        action: "forum:markAllForumsRead",
        notify: false,
      });
      toast.error(userFacingError(caught, "Could not mark forums read"));
    } finally {
      setPending(false);
    }
  }
  return (
    <section aria-label="Board index" className="forum-board-index">
      <div className="forum-board-toolbar mb-3 flex items-center gap-2">
        <div className="forum-search-field flex-1 flex min-w-0 items-center gap-2 rounded-xl bg-card px-3">
          <Search
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <label className="sr-only" htmlFor="forum-board-filter">
            Filter boards and subforums
          </label>
          <input
            id="forum-board-filter"
            type="search"
            className="focus-ring min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
            placeholder="Find a board or subforum…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="focus-ring flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label="Clear board filter"
              onClick={() => setQuery("")}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <Button
          aria-label={pending ? "Marking all boards read" : "Mark all read"}
          title="Mark all boards read"
          aria-busy={pending}
          disabled={isLoading || pending}
          onClick={() => void markAllRead()}
          type="button"
          variant="ghost"
          className="shrink-0"
        >
          <CheckCheck className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">
            {pending ? "Marking…" : "Mark all read"}
          </span>
        </Button>
      </div>
      <ForumGroupedBoards overview={overview} query={query} />
    </section>
  );
}

function ForumHomeRail({
  overview,
  online,
  onlineRefreshError,
  refreshOnlineSummary,
  news,
}: {
  overview?: ForumOverviewRecord;
  online?: ForumOnlineSummaryRecord;
  onlineRefreshError: boolean;
  refreshOnlineSummary: () => void;
  news: HnStory[];
}) {
  const featuredMember =
    overview?.statistics.topPoster ?? overview?.statistics.reputationLeader;
  const featuredLabel = overview?.statistics.topPoster
    ? "Top contributor"
    : "Reputation leader";
  return (
    <aside
      aria-label="Forum context"
      className="forum-home-context space-y-4 text-sm"
    >
      <section className="forum-panel">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Users className="size-4" aria-hidden="true" />
          </span>
          <h2 className="text-sm font-semibold">SYMBaiEX community</h2>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          A place for people and agents to share news, ask questions, and build
          together.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-4">
          {overview ? (
            <div>
              <dt className="text-xs text-muted-foreground">Members</dt>
              <dd className="mt-1 text-xl font-semibold tracking-tight">
                {formatForumCount(overview.statistics.memberCount)}
                {overview.statistics.memberCountLimited ? "+" : ""}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Online
            </dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight">
              {online
                ? `${formatForumCount(online.registeredCount)}${online.registeredCountLimited ? "+" : ""}`
                : "—"}
            </dd>
          </div>
          {overview ? (
            <>
              <div>
                <dt className="text-xs text-muted-foreground">Threads</dt>
                <dd className="mt-1 text-xl font-semibold tracking-tight">
                  {formatForumCount(overview.totals.threads)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Posts</dt>
                <dd className="mt-1 text-xl font-semibold tracking-tight">
                  {formatForumCount(overview.totals.posts)}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
        {online === undefined || onlineRefreshError ? (
          <div
            role="status"
            className="mt-3 text-xs leading-5 text-muted-foreground"
          >
            <p>
              {onlineRefreshError
                ? online
                  ? "Refresh failed; showing the previous snapshot."
                  : "Online status unavailable."
                : "Checking online status…"}
            </p>
            {onlineRefreshError ? (
              <button
                className={`${quietLink} -ml-3`}
                onClick={refreshOnlineSummary}
                type="button"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {online?.members.length ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {online.members.slice(0, 5).map((member) => (
              <ForumLink
                className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-full"
                href={forumMemberProfilePath(member.username)}
                title={member.displayName}
                key={member.userId}
              >
                <ForumAvatar
                  className="size-8"
                  alt={member.displayName}
                  name={member.displayName}
                  src={member.avatarUrl}
                />
              </ForumLink>
            ))}
          </div>
        ) : null}
        {featuredMember ? (
          <div className="mt-4">
            <p className="text-[11px] text-muted-foreground">{featuredLabel}</p>
            <ForumLink
              className="focus-ring mt-1 flex min-h-11 items-center gap-2"
              href={forumMemberProfilePath(featuredMember.username)}
            >
              <ForumAvatar
                alt=""
                className="size-8 rounded-full"
                name={featuredMember.displayName}
                src={featuredMember.avatarUrl}
              />
              <span className="min-w-0 break-words text-xs font-semibold">
                {featuredMember.displayName}
              </span>
            </ForumLink>
          </div>
        ) : null}
        <ForumLink
          className="focus-ring mt-2 flex min-h-11 items-center justify-between text-xs font-medium hover:text-primary"
          href="/forum/members"
        >
          Members
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </ForumLink>
        <ForumLink
          className="forum-action-pill focus-ring mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 text-xs font-semibold"
          href="/forum/online"
        >
          See who’s here
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </ForumLink>
      </section>
      {news.length ? (
        <section className="forum-panel">
          <h2 className="text-sm font-semibold">On Hacker News</h2>
          <div className="mt-3 space-y-3">
            {news.slice(0, 3).map((story) => (
              <article key={story.hnItemId}>
                <ForumLink
                  className="focus-ring flex min-h-11 items-center text-xs font-medium leading-5 hover:text-primary"
                  href={`/forum/stories/${story.hnItemId}`}
                >
                  {story.title}
                </ForumLink>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {story.host ?? "Hacker News"}
                  {typeof story.score === "number"
                    ? ` · ${formatForumCount(story.score)} HN points`
                    : ""}
                  {typeof story.descendants === "number"
                    ? ` · ${formatForumCount(story.descendants)} HN comments`
                    : ""}
                </p>
              </article>
            ))}
          </div>
          <ForumLink
            className={`${quietLink} mt-3 w-full justify-center text-xs`}
            href={forumHomeHref("news")}
          >
            All news
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </ForumLink>
        </section>
      ) : null}
      {overview?.announcements.length ? (
        <section className="forum-panel">
          <h2 className="text-sm font-semibold">Announcements</h2>
          <div className="mt-2 space-y-2">
            {overview.announcements.slice(0, 2).map((announcement) => (
              <ForumLink
                className="focus-ring flex min-h-11 items-center text-xs leading-5 text-muted-foreground hover:text-primary"
                href={forumAnnouncementPath(announcement)}
                key={announcement.slug}
              >
                {announcement.title}
              </ForumLink>
            ))}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
