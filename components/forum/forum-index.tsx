"use client";

import { reportAppError } from "@/components/app-error-surface";
import { NewsFeed } from "@/components/news-feed";
import { Button } from "@/components/ui/button";
import { userFacingError } from "@/lib/auth-errors";
import type { NewsTimelineRecord } from "@/lib/convex-refs";
import type { HnStory } from "@/lib/hn";
import { newsStoryPath } from "@/lib/news-slugs";
import { primarySiteUrl } from "@/lib/site-urls";
import { asRoute } from "@/lib/typed-route";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useConvex, useConvexAuth, useMutation } from "convex/react";
import { ArrowUpRight, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ForumFeedList } from "./forum-feed-list";
import { ForumChat } from "./forum-chat";
import { ForumGroupedBoards } from "./forum-grouped-boards";
import {
  forumHomeHref,
  type ForumHomeView,
  type ForumFeedSort,
} from "./forum-home-model";
import { ForumAvatar, ForumLink, ForumStatusBox } from "./forum-primitives";
import {
  formatForumCount,
  formatForumDateTime,
  forumAnnouncementPath,
  forumMemberProfilePath,
  forumPath,
  forumRefs,
  getCategoryTitle,
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
const views = [
  { value: "boards", label: "Boards" },
  { value: "feed", label: "Feed" },
  { value: "news", label: "News" },
  { value: "community", label: "Community" },
] as const;
const quietLink =
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground";

export function ForumIndex({
  enabled,
  view = "boards",
  sort = "active",
  initialStories = [],
  initialTimeline = null,
}: ForumIndexProps) {
  if (!enabled)
    return (
      <div>
        <ForumHomeHeader view={view} sort={sort} />
        <div className="mt-8">
          {view === "news" ? (
            <NewsFeed
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
  view = "boards",
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
      <ForumHomeHeader overview={overview} view={view} sort={sort} />
      <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(220px,1fr)]">
        <div className="min-w-0">
          {view === "boards" ? <ForumChat /> : null}
          {view === "news" ? (
            <NewsFeed
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
            <>
              {view === "feed" && news.length > 0 ? (
                <section
                  aria-labelledby="forum-news-heading"
                  className="mb-6 rounded-lg bg-muted/35 px-4 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2
                      id="forum-news-heading"
                      className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                    >
                      On Hacker News
                    </h2>
                    <ForumLink
                      className={quietLink}
                      href={forumHomeHref("news")}
                    >
                      All news{" "}
                      <ArrowUpRight aria-hidden="true" className="size-4" />
                    </ForumLink>
                  </div>
                  <div className="space-y-1">
                    {news.slice(0, 3).map((story) => (
                      <article key={story.hnItemId}>
                        <Link
                          className="focus-ring flex min-h-11 flex-col justify-center rounded-sm hover:text-primary"
                          href={asRoute(primarySiteUrl(newsStoryPath(story)))}
                        >
                          <h3 className="text-base font-semibold leading-5">
                            {story.title}
                          </h3>
                          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                            {story.host ?? "Hacker News"}
                            {typeof story.score === "number"
                              ? ` · ${formatForumCount(story.score)} HN points`
                              : ""}
                            {typeof story.descendants === "number"
                              ? ` · ${formatForumCount(story.descendants)} HN comments`
                              : ""}
                          </p>
                        </Link>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              <ForumFeedList sort={sort} communityOnly={view === "community"} />
            </>
          )}
        </div>
        <ForumHomeRail
          overview={overview}
          online={snapshot?.data}
          onlineRefreshError={refreshError}
          refreshOnlineSummary={refreshNow}
          news={view === "boards" ? news : []}
        />
      </div>
    </div>
  );
}

function ForumHomeHeader({
  overview,
  view,
  sort,
}: {
  overview?: ForumOverviewRecord;
  view: ForumHomeView;
  sort: ForumFeedSort;
}) {
  const boards =
    overview?.categories.filter(
      (category) =>
        category.kind !== "section" &&
        category.isPostable !== false &&
        category.status === "active",
    ) ?? [];
  return (
    <header>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {view === "feed"
              ? "The feed"
              : view === "news"
                ? "News"
                : view === "community"
                  ? "Community"
                  : "Forum"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ForumLink
            aria-label="Search the forum"
            className={quietLink}
            href="/forum/search"
          >
            <Search aria-hidden="true" className="size-4" />
            <span className="hidden sm:inline">Search</span>
          </ForumLink>
          <details className="relative">
            <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              <Plus className="size-4" aria-hidden="true" />
              Create post
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg bg-popover p-3 shadow-xl ring-1 ring-row-border">
              <p className="px-2 pb-2 text-xs text-muted-foreground">
                Choose a board
              </p>
              {boards.length ? (
                <div className="space-y-1">
                  {boards.slice(0, 6).map((board) => (
                    <ForumLink
                      className={`${quietLink} flex w-full`}
                      href={`${forumPath(board.slug)}?compose=1`}
                      key={board.slug}
                    >
                      {getCategoryTitle(board)}
                    </ForumLink>
                  ))}
                </div>
              ) : (
                <ForumLink className={quietLink} href={forumHomeHref("boards")}>
                  Browse available boards
                </ForumLink>
              )}
              <ForumLink
                className={`${quietLink} mt-2 text-primary`}
                href={forumHomeHref("boards")}
              >
                All boards{" "}
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </ForumLink>
            </div>
          </details>
        </div>
      </div>
      <nav aria-label="Forum views" className="mt-2 flex flex-wrap gap-1">
        {views.map((item) => (
          <ForumLink
            aria-current={view === item.value ? "page" : undefined}
            className={`${quietLink} ${view === item.value ? "bg-primary/10 font-medium text-primary" : ""}`}
            href={forumHomeHref(item.value, sort)}
            key={item.value}
          >
            {item.label}
          </ForumLink>
        ))}
      </nav>
    </header>
  );
}

function ForumBoards({ overview }: { overview: ForumOverviewRecord }) {
  const [pending, setPending] = useState(false);
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
    <section aria-label="Board index">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Forum index</h2>
        <Button
          aria-busy={pending}
          disabled={isLoading || pending}
          onClick={() => void markAllRead()}
          type="button"
          variant="ghost"
        >
          {pending ? "Marking…" : "Mark all read"}
        </Button>
      </div>
      <ForumGroupedBoards overview={overview} />
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
  const boards =
    overview?.categories
      .filter((category) => category.kind !== "section")
      .slice(0, 7) ?? [];
  return (
    <aside aria-label="Forum context" className="space-y-6 text-sm">
      {overview?.newestThreads.length ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Latest activity</h2>
          <div className="space-y-3">
            {overview.newestThreads.slice(0, 4).map((thread) => (
              <article key={thread.slug}>
                <ForumLink
                  className="focus-ring flex min-h-11 items-center text-xs font-medium leading-5 hover:text-primary"
                  href={forumPath(thread.categorySlug, thread.slug)}
                >
                  {thread.title}
                </ForumLink>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  {thread.categoryName ?? "Forum"}
                  {thread.authorName ? ` · ${thread.authorName}` : ""}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {news.length ? (
        <section>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">On Hacker News</h2>
            <ForumLink className={quietLink} href={forumHomeHref("news")}>
              All news
            </ForumLink>
          </div>
          <div className="space-y-2">
            {news.slice(0, 3).map((story) => (
              <article key={story.hnItemId}>
                <Link
                  className="focus-ring flex min-h-11 items-center text-xs font-medium leading-5 hover:text-primary"
                  href={asRoute(primarySiteUrl(newsStoryPath(story)))}
                >
                  {story.title}
                </Link>
                <p className="text-[11px] text-muted-foreground">
                  {story.host ?? "Hacker News"}
                  {typeof story.score === "number"
                    ? ` · ${formatForumCount(story.score)} HN points`
                    : ""}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h2 className="mb-3 text-sm font-semibold">Boards</h2>
        <div className="flex flex-wrap gap-1 lg:flex-col lg:items-start">
          {boards.map((board) => (
            <ForumLink
              className={quietLink}
              href={forumPath(board.slug)}
              key={board.slug}
            >
              {getCategoryTitle(board)}
            </ForumLink>
          ))}
        </div>
        <ForumLink
          className={`${quietLink} mt-1 text-primary`}
          href={forumHomeHref("boards")}
        >
          Explore all boards{" "}
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </ForumLink>
      </section>
      {overview?.announcements.length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Announcements</h2>
          <div className="space-y-4">
            {overview.announcements.slice(0, 2).map((announcement) => (
              <ForumLink
                className="focus-ring block text-sm leading-6 text-muted-foreground hover:text-primary"
                href={forumAnnouncementPath(announcement)}
                key={announcement.slug}
              >
                {announcement.title}
              </ForumLink>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Forum tools</h2>
        <nav aria-label="Forum tools" className="flex flex-wrap gap-1">
          {[
            { href: "/forum/new-posts", label: "New posts" },
            { href: "/forum/members", label: "Members" },
            { href: "/forum/agents", label: "Agents" },
            { href: "/forum/calendar", label: "Calendar" },
            { href: "/forum/help", label: "Help" },
            { href: "/forum/announcements", label: "Announcements" },
          ].map((item) => (
            <ForumLink className={quietLink} href={item.href} key={item.href}>
              {item.label}
            </ForumLink>
          ))}
        </nav>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Around the forum</h2>
        <dl className="flex gap-6">
          <div>
            <dt className="text-xs text-muted-foreground">Online</dt>
            <dd className="mt-1 font-medium">
              {online
                ? `${formatForumCount(online.registeredCount)}${online.registeredCountLimited ? "+" : ""}`
                : "—"}
            </dd>
          </div>
          {overview ? (
            <div>
              <dt className="text-xs text-muted-foreground">Members</dt>
              <dd className="mt-1 font-medium">
                {formatForumCount(overview.statistics.memberCount)}
                {overview.statistics.memberCountLimited ? "+" : ""}
              </dd>
            </div>
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
          <div className="mt-4 flex flex-wrap gap-2">
            {online.members.slice(0, 5).map((member) => (
              <ForumLink
                className="focus-ring rounded-full"
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
        {online &&
        overview?.statistics.newestMember &&
        !online.members.some(
          (member) =>
            member.username === overview.statistics.newestMember!.username,
        ) ? (
          <div className="mt-4 text-xs leading-5 text-muted-foreground">
            <p>Newest member</p>
            <ForumLink
              className="focus-ring font-medium text-foreground hover:text-primary"
              href={forumMemberProfilePath(
                overview.statistics.newestMember.username,
              )}
            >
              {overview.statistics.newestMember.displayName}
            </ForumLink>
          </div>
        ) : null}
        {online ? (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Active since {formatForumDateTime(online.activeSince)}
          </p>
        ) : null}
        <ForumLink className={`${quietLink} mt-2 -ml-3`} href="/forum/online">
          See who’s here
        </ForumLink>
      </section>
    </aside>
  );
}
