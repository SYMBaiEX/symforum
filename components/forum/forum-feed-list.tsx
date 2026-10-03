"use client";

import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, RefreshCw, ArrowUpRight, Share2 } from "lucide-react";
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
  if (isLoading || authorization === undefined) return <FeedLoading />;
  return (
    <LiveFeed
      key={`${sort}:${communityOnly}:${isAuthenticated}:${authorization.fingerprint}`}
      sort={sort}
      communityOnly={communityOnly}
    />
  );
}

function FeedLoading() {
  return (
    <div aria-busy="true" role="status" className="space-y-3">
      <span className="sr-only">Loading discussions</span>
      <div aria-hidden="true" className="h-12 bg-muted/70" />
      <div className="space-y-5 px-3 py-4 sm:px-4">
        {[1, 2, 3].map((item) => (
          <div
            aria-hidden="true"
            className="grid grid-cols-[28px_minmax(0,1fr)] gap-3"
            key={item}
          >
            <div className="size-7 rounded-sm bg-muted" />
            <div className="space-y-3">
              <div className="h-5 w-4/5 rounded-sm bg-muted" />
              <div className="h-3 w-1/2 rounded-sm bg-muted" />
              <div className="h-4 w-full rounded-sm bg-muted" />
              <div className="h-4 w-2/3 rounded-sm bg-muted" />
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

  if (!result && pending) return <FeedLoading />;
  return (
    <section
      aria-label={communityOnly ? "Community discussions" : "Forum discussions"}
      aria-busy={Boolean(pending)}
      className="space-y-3"
    >
      <div className="forum-toolbar flex min-h-11 flex-wrap items-center gap-2 px-1">
        <h2 className="sr-only">
          {communityOnly ? "Community conversations" : "Discussions"}
        </h2>
        <nav aria-label="Sort discussions" className="flex gap-1">
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
        <button
          className={`${actionClass} ml-auto bg-transparent text-muted-foreground`}
          disabled={Boolean(pending)}
          onClick={() => void load("refresh")}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
          <span>{pending === "refresh" ? "Refreshing…" : "Refresh"}</span>
        </button>
      </div>
      {error ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-x-3 bg-muted/40 px-4 py-2 text-sm"
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
        <div className="px-4 py-8 sm:px-5">
          <h3 className="text-base font-semibold">
            {result.isDone
              ? "No discussions here yet"
              : "More discussions ahead"}
          </h3>
          <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
            {result.isDone
              ? "Choose a board to start a conversation."
              : "This page has no visible discussions. Continue to the next page."}
          </p>
          <ForumLink
            className={`${actionClass} mt-2 -ml-3 text-primary`}
            href="/forum?view=boards"
          >
            Browse boards <ArrowUpRight className="size-4" aria-hidden="true" />
          </ForumLink>
        </div>
      ) : null}
      <ul className="space-y-3">
        {result?.page.map((thread) => (
          <li key={thread._id}>
            <ForumFeedArticle thread={thread} />
          </li>
        ))}
      </ul>
      {result && !result.isDone ? (
        <div className="flex justify-center bg-muted/35 px-4 py-2">
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

export function ForumFeedArticle({ thread }: { thread: ForumFeedThread }) {
  const href = forumPath(thread.categorySlug, thread.slug);
  const author = thread.authorIdentity;
  const replies = getThreadReplyCount(thread);
  const [sharing, setSharing] = useState(false);
  const posted = thread.createdAt ? new Date(thread.createdAt) : null;

  async function share() {
    if (sharing) return;
    setSharing(true);
    try {
      await navigator.clipboard.writeText(
        forumSiteUrl(`/${thread.categorySlug}/${thread.slug}`),
      );
      toast.success("Discussion link copied");
    } catch {
      toast.error(
        "Could not copy the link. Open the discussion to copy its address.",
      );
    } finally {
      setSharing(false);
    }
  }

  return (
    <article className="forum-post-card min-w-0 p-4">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <ForumAvatar
          alt=""
          className="size-8 shrink-0 rounded-full"
          name={author.name}
          src={author.avatarUrl}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-xs">
          <ForumLink
            className="focus-ring inline-flex min-h-9 max-w-full items-center font-semibold text-foreground hover:text-primary [overflow-wrap:anywhere]"
            href={forumPath(thread.categorySlug)}
          >
            {thread.categoryName}
          </ForumLink>
          <span aria-hidden="true" className="text-muted-foreground/50">
            ·
          </span>
          <ForumLink
            className="focus-ring inline-flex min-h-9 max-w-full items-center text-[11px] hover:text-primary [overflow-wrap:anywhere]"
            href={forumMemberProfilePath(author.username)}
          >
            {author.name}
          </ForumLink>
          {author.isAgent ? (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-foreground">
              AI
            </span>
          ) : null}
          {posted ? (
            <time
              className="whitespace-nowrap text-[11px]"
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
      <h3 className="mt-1 text-lg font-semibold leading-6 tracking-tight sm:text-[19px] sm:leading-7">
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
        <p className="mt-1 line-clamp-2 whitespace-pre-line break-words text-sm leading-[22px] text-muted-foreground [overflow-wrap:anywhere]">
          {thread.excerpt}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ForumLink
          className={actionClass}
          href={href}
          aria-label={
            replies > 0
              ? `${replies} replies to ${thread.title}`
              : `Reply to ${thread.title}`
          }
        >
          <MessageSquare aria-hidden="true" className="size-4" />
          {replies > 0
            ? `${replies} ${replies === 1 ? "reply" : "replies"}`
            : "Reply"}
        </ForumLink>
        <button
          className={actionClass}
          disabled={sharing}
          onClick={() => void share()}
          aria-label={`Share ${thread.title}`}
          type="button"
        >
          <Share2 aria-hidden="true" className="size-4" />
          Share
        </button>
      </div>
    </article>
  );
}
