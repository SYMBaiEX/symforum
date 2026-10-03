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
import {
  forumHomeHref,
  type ForumHomeView,
  type ForumFeedSort,
} from "./forum-home-model";
import {
  ForumAvatar,
  ForumLink,
  ForumIndexTable,
  ForumStatusBox,
} from "./forum-primitives";
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
  { value: "feed", label: "Feed" },
  { value: "news", label: "News" },
  { value: "community", label: "Community" },
  { value: "boards", label: "Boards" },
] as const;
const quietLink =
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground";

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
      <ForumHomeHeader overview={overview} view={view} sort={sort} />
      <div className="mt-8 grid items-start gap-10 lg:grid-cols-[minmax(0,760px)_240px]">
        <div className="min-w-0">
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
                  className="mb-10 rounded-lg bg-muted/35 px-5 py-5 sm:px-6"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
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
                  <div className="space-y-5">
                    {news.slice(0, 3).map((story) => (
                      <article key={story.hnItemId}>
                        <h3 className="text-lg font-semibold leading-6">
                          <Link
                            className="focus-ring rounded-sm hover:text-primary"
                            href={asRoute(primarySiteUrl(newsStoryPath(story)))}
                          >
                            {story.title}
                          </Link>
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
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
                </section>
              ) : null}
              <div className="mb-2 flex gap-1" aria-label="Sort discussions">
                {[
                  { value: "active", label: "Active" },
                  { value: "new", label: "New" },
                ].map((item) => (
                  <ForumLink
                    aria-current={sort === item.value ? "page" : undefined}
                    className={`${quietLink} ${sort === item.value ? "bg-muted text-foreground" : ""}`}
                    href={forumHomeHref(view, item.value as ForumFeedSort)}
                    key={item.value}
                  >
                    {item.label}
                  </ForumLink>
                ))}
              </div>
              <ForumFeedList sort={sort} communityOnly={view === "community"} />
            </>
          )}
        </div>
        <ForumHomeRail
          overview={overview}
          online={snapshot?.data}
          onlineRefreshError={refreshError}
          refreshOnlineSummary={refreshNow}
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
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {view === "feed"
              ? "The feed"
              : view === "news"
                ? "News"
                : view === "community"
                  ? "Community"
                  : "Boards"}
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
      <nav aria-label="Forum views" className="mt-6 flex flex-wrap gap-1">
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
      <div className="mb-6 flex justify-end">
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
      <ForumIndexTable
        categories={overview.categories}
        sections={overview.sections}
      />
    </section>
  );
}

function ForumHomeRail({
  overview,
  online,
  onlineRefreshError,
  refreshOnlineSummary,
}: {
  overview?: ForumOverviewRecord;
  online?: ForumOnlineSummaryRecord;
  onlineRefreshError: boolean;
  refreshOnlineSummary: () => void;
}) {
  const boards =
    overview?.categories
      .filter((category) => category.kind !== "section")
      .slice(0, 7) ?? [];
  return (
    <aside aria-label="Forum context" className="space-y-8 text-sm">
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
