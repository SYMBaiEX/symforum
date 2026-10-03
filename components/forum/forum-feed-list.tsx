"use client";

import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, RefreshCw, ArrowUpRight } from "lucide-react";
import { ForumSectionHeader } from "./forum-layout-primitives";
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
  formatForumDateTime,
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
  "focus-ring inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-sm px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground disabled:opacity-50";

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
    <div
      aria-busy="true"
      role="status"
      className="overflow-hidden rounded-sm bg-muted/20"
    >
      <span className="sr-only">Loading discussions</span>
      <div aria-hidden="true" className="h-12 bg-muted/70" />
      <div className="space-y-8 px-4 py-6 sm:px-5">
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
      className="overflow-hidden rounded-sm bg-muted/20"
    >
      <ForumSectionHeader
        title={communityOnly ? "Community conversations" : "From the forum"}
      >
        <div className="flex max-w-full items-center gap-1">
          <nav aria-label="Sort discussions" className="flex gap-1">
            {[
              { value: "active", label: "Active" },
              { value: "new", label: "New" },
            ].map((item) => (
              <ForumLink
                aria-current={sort === item.value ? "page" : undefined}
                className={`${actionClass} ${sort === item.value ? "bg-background text-foreground" : ""}`}
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
            className={actionClass}
            disabled={Boolean(pending)}
            onClick={() => void load("refresh")}
            type="button"
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
            {pending === "refresh" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </ForumSectionHeader>
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
      <ul className="px-2 py-2 sm:px-3">
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
  return (
    <article className="group grid min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-x-3 rounded-sm px-2 py-4 transition-colors hover:bg-background/55 focus-within:bg-background/55 sm:gap-x-4">
      <ForumAvatar
        alt=""
        className="mt-3 size-7 rounded-sm"
        name={author.name}
        src={author.avatarUrl}
      />
      <div className="min-w-0">
        <h3 className="text-lg font-semibold leading-6 tracking-tight sm:text-xl sm:leading-7">
          <ForumLink
            className="focus-ring inline-flex min-h-11 items-center break-words py-1 hover:text-primary [overflow-wrap:anywhere]"
            href={href}
          >
            {thread.title}
          </ForumLink>
        </h3>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 font-mono text-[11px] leading-5 text-muted-foreground">
          <ForumLink
            className="focus-ring inline-flex min-h-11 min-w-11 items-center break-words text-foreground hover:text-primary [overflow-wrap:anywhere]"
            href={forumMemberProfilePath(author.username)}
          >
            {author.name}
          </ForumLink>
          {author.isAgent ? (
            <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              AI
            </span>
          ) : null}
          <span aria-hidden="true">·</span>
          <ForumLink
            className="focus-ring inline-flex min-h-11 min-w-11 items-center break-words hover:text-primary [overflow-wrap:anywhere]"
            href={forumPath(thread.categorySlug)}
          >
            {thread.categoryName}
          </ForumLink>
          {thread.createdAt ? (
            <time dateTime={new Date(thread.createdAt).toISOString()}>
              {formatForumDateTime(thread.createdAt)}
            </time>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 empty:hidden">
          <ForumThreadPrefixBadge thread={thread} />
          <ForumThreadStateBadges thread={thread} />
        </div>
        {thread.excerpt ? (
          <p className="mt-1 line-clamp-3 max-w-prose whitespace-pre-line break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
            {thread.excerpt}
          </p>
        ) : null}
        <ForumLink className={`${actionClass} mt-1 -ml-3`} href={href}>
          <MessageSquare aria-hidden="true" className="size-3.5" />
          {replies > 0
            ? `${replies} ${replies === 1 ? "reply" : "replies"}`
            : "Join the conversation"}
        </ForumLink>
      </div>
    </article>
  );
}
