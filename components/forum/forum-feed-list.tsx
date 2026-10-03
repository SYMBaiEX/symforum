"use client";

import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, RefreshCw, ArrowUpRight } from "lucide-react";
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
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50";

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
    <div aria-busy="true" role="status" className="space-y-8 py-6">
      <span className="sr-only">Loading discussions</span>
      {[1, 2, 3].map((item) => (
        <div aria-hidden="true" className="space-y-3" key={item}>
          <div className="h-3 w-36 rounded bg-muted" />
          <div className="h-6 w-4/5 rounded bg-muted" />
          <div className="h-4 w-2/3 rounded bg-muted" />
        </div>
      ))}
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
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="sr-only sm:not-sr-only sm:text-sm sm:font-medium sm:text-muted-foreground">
          {communityOnly ? "Community conversations" : "From the forum"}
        </h2>
        <div className="flex items-center gap-1">
          <nav aria-label="Sort discussions" className="flex gap-1">
            {[
              { value: "active", label: "Active" },
              { value: "new", label: "New" },
            ].map((item) => (
              <ForumLink
                aria-current={sort === item.value ? "page" : undefined}
                className={`${actionClass} ${sort === item.value ? "bg-muted text-foreground" : ""}`}
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
      </div>
      {error ? (
        <div
          role="status"
          className="mb-6 flex flex-wrap items-center gap-2 rounded-md bg-muted px-4 py-3 text-sm"
        >
          <span>
            {result
              ? "Could not update the feed. Your loaded discussions are still here."
              : "Discussions could not load."}
          </span>
          <button
            className={actionClass}
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
        <div className="py-8">
          <h3 className="text-xl font-semibold">
            {result.isDone
              ? "No discussions here yet"
              : "More discussions ahead"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {result.isDone
              ? "Choose a board to start a conversation."
              : "This page has no visible discussions. Continue to the next page."}
          </p>
          <ForumLink
            className={`${actionClass} mt-3 -ml-3`}
            href="/forum?view=boards"
          >
            Browse boards <ArrowUpRight className="size-4" aria-hidden="true" />
          </ForumLink>
        </div>
      ) : null}
      <div className="space-y-8">
        {result?.page.map((thread) => (
          <ForumFeedArticle key={thread._id} thread={thread} />
        ))}
      </div>
      {result && !result.isDone ? (
        <button
          className={`${actionClass} mt-8 bg-muted px-5 text-foreground`}
          disabled={Boolean(pending)}
          onClick={() => void load("more")}
          type="button"
        >
          {pending === "more" ? "Loading…" : "Load more discussions"}
        </button>
      ) : null}
    </section>
  );
}

export function ForumFeedArticle({ thread }: { thread: ForumFeedThread }) {
  const href = forumPath(thread.categorySlug, thread.slug);
  const author = thread.authorIdentity;
  const replies = getThreadReplyCount(thread);
  return (
    <article className="group rounded-lg px-3 py-2 -mx-3 transition-colors hover:bg-muted/35 focus-within:bg-muted/35">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ForumAvatar
          alt=""
          className="size-5"
          name={author.name}
          src={author.avatarUrl}
        />
        <ForumLink
          className="focus-ring font-medium text-foreground hover:text-primary"
          href={forumPath(thread.categorySlug)}
        >
          {thread.categoryName}
        </ForumLink>
        <span aria-hidden="true">·</span>
        <ForumLink
          className="focus-ring hover:text-primary"
          href={forumMemberProfilePath(author.username)}
        >
          {author.name}
        </ForumLink>
        {author.isAgent ? (
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
            AI
          </span>
        ) : null}
        {thread.createdAt ? (
          <time dateTime={new Date(thread.createdAt).toISOString()}>
            {formatForumDateTime(thread.createdAt)}
          </time>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ForumThreadPrefixBadge thread={thread} />
        <ForumThreadStateBadges thread={thread} />
      </div>
      <h3 className="text-xl font-semibold leading-7 tracking-tight">
        <ForumLink
          className="focus-ring rounded-sm hover:text-primary"
          href={href}
        >
          {thread.title}
        </ForumLink>
      </h3>
      {thread.excerpt ? (
        <p className="mt-2 line-clamp-3 whitespace-pre-line text-[15px] leading-6 text-muted-foreground">
          {thread.excerpt}
        </p>
      ) : null}
      <ForumLink className={`${actionClass} mt-2 -ml-3`} href={href}>
        <MessageSquare aria-hidden="true" className="size-4" />
        {replies > 0
          ? `${replies} ${replies === 1 ? "reply" : "replies"}`
          : "Join the conversation"}
      </ForumLink>
    </article>
  );
}
