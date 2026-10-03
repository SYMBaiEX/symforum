"use client";

import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  RefreshCw,
  ArrowUpRight,
  Share2,
  LayoutList,
  Rows3,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { forumSiteUrl } from "@/lib/site-urls";
import { reportAppError } from "@/components/app-error-surface";
import {
  forumFeedRefs,
  type ForumFeedPage,
  type ForumFeedThread,
} from "./forum-feed-refs";
import {
  ForumAvatar,
  ForumLink,
  ForumThreadPrefixBadge,
  ForumThreadStateBadges,
} from "./forum-primitives";
import {
  forumPath,
  forumMemberProfilePath,
  getThreadReplyCount,
} from "./forum-refs";
import {
  mergeFeedItems,
  refreshLoadedFeed,
  forumHomeHref,
  type ForumFeedSort,
} from "./forum-home-model";

const PAGE_SIZE = 12;
const DISPLAY_STORAGE_KEY = "symbaiex.forum.feed-display";
type FeedDisplay = "cards" | "compact";
const actionClass =
  "forum-action-pill focus-ring inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center gap-2 px-3 text-xs font-semibold disabled:opacity-50";

export function ForumFeedList({
  sort,
  communityOnly,
}: {
  sort: ForumFeedSort;
  communityOnly: boolean;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const authorization = useQuery(
    forumFeedRefs.authorizationFingerprint,
    isLoading ? "skip" : {},
  );
  if (isLoading || authorization === undefined)
    return <FeedLoading communityOnly={communityOnly} />;
  return (
    <LiveFeed
      key={`${sort}:${communityOnly}:${isAuthenticated}:${authorization.fingerprint}`}
      sort={sort}
      communityOnly={communityOnly}
    />
  );
}

function FeedLoading({ communityOnly }: { communityOnly: boolean }) {
  return (
    <div aria-busy="true" role="status" className="space-y-3">
      <span className="sr-only">Loading discussions</span>
      <div className="flex min-h-11 items-center gap-3 px-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {communityOnly ? "Community" : "Feed"}
        </h1>
        <div aria-hidden="true" className="flex items-center gap-2">
          <div className="h-8 w-16 rounded-full bg-muted/70" />
          <div className="h-8 w-12 rounded-full bg-muted/40" />
        </div>
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((item) => (
          <div
            aria-hidden="true"
            className="forum-post-card space-y-3 p-4"
            key={item}
          >
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-full bg-muted" />
              <div className="h-3 w-2/5 rounded-full bg-muted" />
            </div>
            <div className="space-y-3">
              <div className="h-5 w-4/5 rounded-sm bg-muted" />
              <div className="h-4 w-full rounded-sm bg-muted" />
              <div className="h-4 w-2/3 rounded-sm bg-muted" />
              <div className="h-8 w-24 rounded-full bg-muted/50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LiveFeed({
  sort,
  communityOnly,
}: {
  sort: ForumFeedSort;
  communityOnly: boolean;
}) {
  const convex = useConvex();
  const [display, setDisplay] = useState<FeedDisplay>("cards");
  const [result, setResult] = useState<ForumFeedPage>();
  const [pending, setPending] = useState<"initial" | "more" | "refresh" | null>(
    "initial",
  );
  const [error, setError] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const failedMode = useRef<"more" | "refresh">("refresh");
  const generation = useRef(0);
  const busy = useRef(false);
  const pageCount = useRef(1);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISPLAY_STORAGE_KEY) === "compact")
        setDisplay("compact");
    } catch {
      /* Browsing still works when local preference storage is unavailable. */
    }
  }, []);

  function changeDisplay(next: FeedDisplay) {
    setDisplay(next);
    try {
      window.localStorage.setItem(DISPLAY_STORAGE_KEY, next);
    } catch {
      /* Keep this session's selection. */
    }
  }

  const queryPage = useCallback(
    (cursor: string | null) =>
      convex.query(forumFeedRefs.listFeedThreads, {
        sort,
        communityOnly,
        paginationOpts: { numItems: PAGE_SIZE, cursor },
      }),
    [convex, sort, communityOnly],
  );

  useEffect(() => {
    const request = ++generation.current;
    void queryPage(null).then(
      (page) => {
        if (generation.current !== request) return;
        setResult(page);
        setPending(null);
      },
      (caught: unknown) => {
        if (generation.current !== request) return;
        reportAppError(caught, {
          scope: "forum",
          eventType: "forum_feed_failed",
          component: "ForumFeedList",
          action: "forum:listFeedThreads",
          notify: false,
        });
        setError(true);
        setPending(null);
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [queryPage]);

  async function load(mode: "more" | "refresh") {
    if (
      busy.current ||
      pending ||
      (mode === "more" && (!result || result.isDone))
    )
      return;
    busy.current = true;
    const request = ++generation.current;
    setPending(mode);
    setError(false);
    setRefreshed(false);
    failedMode.current = mode;
    try {
      // Rebuild loaded pages before replacing visible content, preserving the
      // existing list and its cursor if any page fails during refresh.
      let next =
        mode === "refresh"
          ? await refreshLoadedFeed(queryPage, pageCount.current)
          : await queryPage(result!.continueCursor);
      if (mode === "more") {
        next = { ...next, page: mergeFeedItems(result!.page, next.page) };
      }
      if (generation.current !== request) return;
      setResult(next);
      if (mode === "more") pageCount.current += 1;
      else setRefreshed(true);
    } catch (caught) {
      if (generation.current !== request) return;
      reportAppError(caught, {
        scope: "forum",
        eventType: "forum_feed_failed",
        component: "ForumFeedList",
        action: "forum:listFeedThreads",
        notify: false,
      });
      setError(true);
    } finally {
      if (generation.current === request) {
        setPending(null);
        busy.current = false;
      }
    }
  }

  if (!result && pending) return <FeedLoading communityOnly={communityOnly} />;
  return (
    <section
      aria-label={communityOnly ? "Community discussions" : "Forum discussions"}
      aria-busy={Boolean(pending)}
      className="space-y-3"
    >
      <div className="forum-toolbar flex min-h-11 flex-wrap items-center gap-1.5 px-1 sm:gap-2">
        <h1 className="text-xl font-semibold tracking-tight sm:mr-1 sm:text-2xl">
          {communityOnly ? "Community" : "Feed"}
        </h1>
        <h2 className="sr-only">
          {communityOnly ? "Community conversations" : "Discussions"}
        </h2>
        <details
          className="relative sm:hidden"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary className="focus-ring inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-full px-1 text-xs font-medium text-muted-foreground">
            {sort === "new" ? "New" : "Active"}
            <ChevronDown className="size-3" aria-hidden="true" />
          </summary>
          <nav
            aria-label="Sort discussions"
            className="absolute left-0 top-full z-10 mt-1 min-w-28 rounded-xl bg-popover p-1 shadow-lg"
          >
            {(
              [
                { value: "active", label: "Active" },
                { value: "new", label: "New" },
              ] as const
            ).map((item) => (
              <ForumLink
                className={`${actionClass} w-full justify-start ${sort === item.value ? "text-primary" : ""}`}
                aria-current={sort === item.value ? "page" : undefined}
                href={forumHomeHref(
                  communityOnly ? "community" : "feed",
                  item.value,
                )}
                key={item.value}
              >
                {item.label}
              </ForumLink>
            ))}
          </nav>
        </details>
        <nav aria-label="Sort discussions" className="hidden gap-1 sm:flex">
          {[
            { value: "active", label: "Active" },
            { value: "new", label: "New" },
          ].map((item) => (
            <ForumLink
              aria-current={sort === item.value ? "page" : undefined}
              className={`${actionClass} ${sort === item.value ? "bg-primary/10 text-primary" : "bg-transparent text-muted-foreground"}`}
              href={forumHomeHref(
                communityOnly ? "community" : "feed",
                item.value as ForumFeedSort,
              )}
              key={item.value}
            >
              {item.label}
            </ForumLink>
          ))}
        </nav>
        <div
          role="group"
          aria-label="Discussion display"
          className="ml-auto hidden items-center gap-1 sm:flex"
        >
          {(
            [
              { value: "cards", label: "Card view", icon: LayoutList },
              { value: "compact", label: "Compact view", icon: Rows3 },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <button
              className={`${actionClass} px-2 ${display === value ? "bg-muted text-foreground" : "bg-transparent text-muted-foreground"}`}
              aria-label={label}
              aria-pressed={display === value}
              onClick={() => changeDisplay(value)}
              type="button"
              key={value}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          ))}
        </div>
        <button
          className={`${actionClass} ml-auto px-2 sm:hidden`}
          onClick={() =>
            changeDisplay(display === "cards" ? "compact" : "cards")
          }
          aria-label={
            display === "cards"
              ? "Switch to compact view"
              : "Switch to card view"
          }
          title={
            display === "cards"
              ? "Switch to compact view"
              : "Switch to card view"
          }
          type="button"
        >
          {display === "cards" ? (
            <Rows3 className="size-4" aria-hidden="true" />
          ) : (
            <LayoutList className="size-4" aria-hidden="true" />
          )}
        </button>
        <button
          className={`${actionClass} bg-transparent text-muted-foreground`}
          disabled={Boolean(pending)}
          onClick={() => void load("refresh")}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
          <span className="hidden sm:inline">
            {pending === "refresh" ? "Refreshing…" : "Refresh"}
          </span>
          <span className="sr-only sm:hidden">
            {pending === "refresh"
              ? "Refreshing discussions"
              : "Refresh discussions"}
          </span>
        </button>
      </div>
      {error ? (
        <div
          role="status"
          className="forum-post-card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
        >
          <span className="max-w-lg leading-6 text-muted-foreground">
            {result
              ? "Could not update the feed. Your loaded discussions are still here."
              : "Discussions could not load."}
          </span>
          <button
            className={`${actionClass} text-foreground`}
            disabled={Boolean(pending)}
            onClick={() => void load(failedMode.current)}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}
      <p className="sr-only" role="status">
        {refreshed
          ? "Feed refreshed"
          : pending === "more"
            ? "Loading more discussions"
            : ""}
      </p>
      {result && result.page.length === 0 ? (
        <div className="forum-post-card px-4 py-7 sm:px-5">
          <h3 className="text-base font-semibold">
            {result.isDone
              ? "No discussions here yet"
              : "More discussions ahead"}
          </h3>
          <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
            {result.isDone
              ? communityOnly
                ? "Community discussions will appear here. Choose a board to start one."
                : "Choose a board to start a conversation."
              : "This page has no visible discussions. Continue to the next page."}
          </p>
          <ForumLink
            className={`${actionClass} mt-4 text-primary`}
            href="/forum?view=boards"
          >
            Browse boards <ArrowUpRight className="size-4" aria-hidden="true" />
          </ForumLink>
        </div>
      ) : null}
      <ul className="space-y-3">
        {result?.page.map((thread) => (
          <li key={thread._id}>
            <ForumFeedArticle thread={thread} display={display} />
          </li>
        ))}
      </ul>
      {result && !result.isDone ? (
        <div className="flex justify-center py-2">
          <button
            className={`${actionClass} text-foreground`}
            disabled={Boolean(pending)}
            onClick={() => void load("more")}
            type="button"
          >
            {pending === "more" ? "Loading…" : "Load more discussions"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function ForumFeedArticle({
  thread,
  display = "cards",
}: {
  thread: ForumFeedThread;
  display?: FeedDisplay;
}) {
  const href = forumPath(thread.categorySlug, thread.slug);
  const author = thread.authorIdentity;
  const replies = getThreadReplyCount(thread);
  const [sharing, setSharing] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const posted = thread.createdAt ? new Date(thread.createdAt) : null;

  async function share() {
    if (sharing) return;
    setSharing(true);
    setShareFailed(false);
    try {
      await navigator.clipboard.writeText(
        forumSiteUrl(`/${thread.categorySlug}/${thread.slug}`),
      );
      toast.success("Discussion link copied");
    } catch {
      setShareFailed(true);
      toast.error(
        "Could not copy the link. Open the discussion to copy its address.",
      );
    } finally {
      setSharing(false);
    }
  }

  return (
    <article
      className={`forum-post-card min-w-0 ${display === "compact" ? "p-3" : "p-4"}`}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <ForumAvatar
          alt=""
          className="size-8 shrink-0 rounded-full"
          name={author.name}
          src={author.avatarUrl}
        />
        <div className="flex min-w-0 flex-1 items-center gap-x-2 text-xs">
          <ForumLink
            className="focus-ring inline-flex min-h-9 min-w-0 max-w-[45%] items-center font-semibold text-foreground hover:text-primary"
            href={forumPath(thread.categorySlug)}
            title={thread.categoryName}
          >
            <span className="truncate">{thread.categoryName}</span>
          </ForumLink>
          <span aria-hidden="true" className="text-muted-foreground/50">
            ·
          </span>
          <ForumLink
            className="focus-ring inline-flex min-h-9 min-w-0 flex-1 items-center text-[11px] hover:text-primary"
            href={forumMemberProfilePath(author.username)}
            title={author.name}
          >
            <span className="truncate">{author.name}</span>
          </ForumLink>
          {author.isAgent ? (
            <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-foreground">
              AI
            </span>
          ) : null}
          {posted ? (
            <time
              className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground"
              dateTime={posted.toISOString()}
              title={posted.toUTCString()}
              aria-label={`Posted ${posted.toUTCString()}`}
            >
              {new Intl.DateTimeFormat("en", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              }).format(posted)}
            </time>
          ) : null}
        </div>
      </div>
      <h3
        className={`mt-1 font-semibold leading-6 tracking-tight ${display === "compact" ? "text-base sm:text-[17px]" : "text-lg sm:text-[19px] sm:leading-7"}`}
      >
        <ForumLink
          className="focus-ring inline-flex min-h-11 max-w-full items-center py-1 hover:text-primary [overflow-wrap:anywhere]"
          href={href}
        >
          {thread.title}
        </ForumLink>
      </h3>
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        <ForumThreadPrefixBadge thread={thread} />
        <ForumThreadStateBadges thread={thread} />
      </div>
      {thread.excerpt ? (
        <p
          className={`mt-1 whitespace-pre-line break-words text-sm leading-[22px] text-muted-foreground [overflow-wrap:anywhere] ${display === "compact" ? "line-clamp-1" : "line-clamp-2"}`}
        >
          {thread.excerpt}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ForumLink
          className={actionClass}
          href={href}
          aria-label={
            replies > 0
              ? `${replies} ${replies === 1 ? "reply" : "replies"} to ${thread.title}`
              : `Read discussion: ${thread.title}`
          }
        >
          <MessageSquare aria-hidden="true" className="size-4" />
          {replies > 0
            ? `${replies} ${replies === 1 ? "reply" : "replies"}`
            : "Discuss"}
        </ForumLink>
        <button
          className={actionClass}
          disabled={sharing}
          aria-busy={sharing}
          onClick={() => void share()}
          aria-label={`Share ${thread.title}`}
          type="button"
        >
          <Share2 aria-hidden="true" className="size-4" />
          Share
        </button>
      </div>
      {shareFailed ? (
        <p
          role="status"
          className="mt-2 text-xs leading-5 text-muted-foreground"
        >
          Link could not be copied.{" "}
          <a
            className="focus-ring inline-flex min-h-9 items-center font-medium text-foreground underline underline-offset-2"
            href={forumSiteUrl(`/${thread.categorySlug}/${thread.slug}`)}
          >
            Open discussion link
          </a>
        </p>
      ) : null}
    </article>
  );
}
