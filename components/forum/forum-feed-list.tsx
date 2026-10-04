"use client";
import { forumSourceDomain } from "@/lib/forum-experience";

import { useConvex, useConvexAuth, useQuery, useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  RefreshCw,
  ArrowUpRight,
  Share2,
  LayoutList,
  Rows3,
  ChevronDown,
  Bookmark,
  AlignLeft,
  History,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { forumExperienceRefs } from "./forum-experience-refs";
import {
  FORUM_AUTHOR_FILTERS,
  type ForumAuthorFilter,
  type ForumFeedScope,
} from "@/lib/forum-experience";
import { readingPlace, saveReadingPlace } from "./forum-feed-reading-state";
import { forumRefs, forumHrefForPathname } from "./forum-refs";
import { asRoute } from "@/lib/typed-route";
import { ForumFeedStarter } from "./forum-feed-starter";
import { ForumMediaGallery } from "./forum-media-gallery";
const PAGE_SIZE = 12;
const DISPLAY_STORAGE_KEY = "symbaiex.forum.feed-display";
type FeedDisplay = "timeline" | "cards" | "compact";
const actionClass =
  "forum-action-pill focus-ring inline-flex shrink-0 items-center justify-center gap-1.5 px-3 text-xs font-medium disabled:opacity-50";

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
  const params = useSearchParams();
  const experience = useQuery(
    forumExperienceRefs.get,
    isAuthenticated ? {} : "skip",
  );
  const scope: ForumFeedScope =
    isAuthenticated &&
    (params.get("scope") ?? experience?.defaultFeed) === "following"
      ? "following"
      : "discover";
  const authorFilter: ForumAuthorFilter =
    FORUM_AUTHOR_FILTERS.find(
      (value) => value === (params.get("authors") ?? experience?.authorFilter),
    ) ?? "all";
  if (
    isLoading ||
    authorization === undefined ||
    (isAuthenticated && experience === undefined)
  )
    return <FeedLoading communityOnly={communityOnly} />;
  return (
    <LiveFeed
      key={`${sort}:${communityOnly}:${scope}:${authorFilter}:${authorization.fingerprint}`}
      sort={sort}
      communityOnly={communityOnly}
      authorization={authorization.fingerprint}
      scope={scope}
      authorFilter={authorFilter}
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
  authorization = "guest",
  scope = "discover",
  authorFilter = "all",
}: {
  sort: ForumFeedSort;
  communityOnly: boolean;
  authorization?: string;
  scope?: ForumFeedScope;
  authorFilter?: ForumAuthorFilter;
}) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const record = useMutation(forumExperienceRefs.event);
  const recorded = useRef(false);
  useEffect(() => {
    if (isAuthenticated && !recorded.current) {
      recorded.current = true;
      void record({ event: "feed_open" }).catch(() => {});
    }
  }, [isAuthenticated, record]);
  const updatePreferences = useMutation(forumExperienceRefs.update);
  const cacheKey = `${authorization}:${sort}:${communityOnly}:${scope}:${authorFilter}`;
  const restored = readingPlace(cacheKey, authorization);
  const savedPosition = useRef(restored);
  const [display, setDisplay] = useState<FeedDisplay>("timeline");
  const [result, setResult] = useState<ForumFeedPage>();
  const [pending, setPending] = useState<"initial" | "more" | "refresh" | null>(
    "initial",
  );
  const [error, setError] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const failedMode = useRef<"more" | "refresh">("refresh");
  const generation = useRef(0);
  const busy = useRef(false);
  const pageCount = useRef(restored?.pages ?? 1);
  const restorePending = useRef(true);
  useEffect(() => {
    const capture = () =>
      saveReadingPlace(cacheKey, pageCount.current, window.scrollY);
    window.addEventListener("forum:reading-navigation", capture);
    return () =>
      window.removeEventListener("forum:reading-navigation", capture);
  }, [cacheKey]);
  useEffect(() => {
    if (!result || !restorePending.current) return;
    restorePending.current = false;
    const frame = requestAnimationFrame(() => {
      if (savedPosition.current)
        window.scrollTo({ top: savedPosition.current.y, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [result]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DISPLAY_STORAGE_KEY);
      if (stored === "timeline" || stored === "cards" || stored === "compact")
        setDisplay(stored);
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
        scope,
        authorFilter,
        now: Date.now(),
        paginationOpts: { numItems: PAGE_SIZE, cursor },
      }),
    [convex, sort, communityOnly, scope, authorFilter],
  );

  useEffect(() => {
    const request = ++generation.current;
    setPending("initial");
    setResult(undefined);
    void refreshLoadedFeed(queryPage, pageCount.current).then(
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

  function changeFeed(
    nextScope: ForumFeedScope,
    nextFilter: ForumAuthorFilter,
  ) {
    const next = new URLSearchParams(params.toString());
    next.set("scope", nextScope);
    next.set("authors", nextFilter);
    saveReadingPlace(cacheKey, pageCount.current, window.scrollY);
    router.push(asRoute(`${pathname}?${next}`), { scroll: false });
    if (isAuthenticated)
      void updatePreferences({
        defaultFeed: nextScope,
        authorFilter: nextFilter,
      }).catch(() =>
        toast.error(
          "Your view changed, but the preference could not be saved.",
        ),
      );
  }
  if (!result && pending) return <FeedLoading communityOnly={communityOnly} />;
  return (
    <section
      aria-label={communityOnly ? "Community discussions" : "Forum discussions"}
      aria-busy={Boolean(pending)}
      className="forum-social-feed space-y-2"
    >
      <div className="forum-toolbar flex min-h-11 flex-wrap items-center gap-1.5 px-1 sm:gap-2">
        <h1 className="text-xl font-semibold tracking-tight sm:mr-1 sm:text-2xl">
          {communityOnly ? "Community" : "Feed"}
        </h1>
        <h2 className="sr-only">
          {communityOnly ? "Community conversations" : "Discussions"}
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Sort discussions"
              className={`${actionClass} sm:hidden`}
            >
              {sort === "new"
                ? "Latest"
                : sort === "unanswered"
                  ? "Unanswered"
                  : "Active"}
              <ChevronDown className="size-3" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className="min-w-36"
          >
            {(
              [
                { value: "active", label: "Active" },
                { value: "new", label: "Latest" },
                { value: "unanswered", label: "Unanswered" },
              ] as const
            ).map((item) => (
              <DropdownMenuItem asChild key={item.value}>
                <ForumLink
                  aria-current={sort === item.value ? "page" : undefined}
                  className={
                    sort === item.value ? "font-semibold text-primary" : ""
                  }
                  href={forumHomeHref(
                    communityOnly ? "community" : "feed",
                    item.value,
                    scope,
                    authorFilter,
                  )}
                >
                  {item.label}
                </ForumLink>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <nav aria-label="Sort discussions" className="hidden gap-1 sm:flex">
          {[
            { value: "active", label: "Active" },
            { value: "new", label: "Latest" },
            { value: "unanswered", label: "Unanswered" },
          ].map((item) => (
            <ForumLink
              aria-current={sort === item.value ? "page" : undefined}
              className={`${actionClass} ${sort === item.value ? "bg-primary/10 text-primary" : "bg-transparent text-muted-foreground"}`}
              href={forumHomeHref(
                communityOnly ? "community" : "feed",
                item.value as ForumFeedSort,
                scope,
                authorFilter,
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
          className="forum-display-toggle ml-auto hidden items-center gap-1 sm:flex"
        >
          {(
            [
              { value: "timeline", label: "Timeline view", icon: AlignLeft },
              { value: "cards", label: "Card view", icon: LayoutList },
              { value: "compact", label: "Compact view", icon: Rows3 },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <button
              className={`${actionClass} px-2 ${display === value ? "bg-muted text-foreground" : "bg-transparent text-muted-foreground"}`}
              aria-label={label}
              title={label}
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
            changeDisplay(
              display === "timeline"
                ? "compact"
                : display === "compact"
                  ? "cards"
                  : "timeline",
            )
          }
          aria-label={
            display === "timeline"
              ? "Switch to compact view"
              : display === "compact"
                ? "Switch to card view"
                : "Switch to timeline view"
          }
          title={
            display === "timeline"
              ? "Switch to compact view"
              : display === "compact"
                ? "Switch to card view"
                : "Switch to timeline view"
          }
          type="button"
        >
          {display === "timeline" ? (
            <Rows3 className="size-4" aria-hidden="true" />
          ) : display === "compact" ? (
            <LayoutList className="size-4" aria-hidden="true" />
          ) : (
            <AlignLeft className="size-4" aria-hidden="true" />
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
        <ForumLink
          href="/forum/catch-up"
          className={`${actionClass} px-2 text-muted-foreground`}
          aria-label="Catch up & interests"
          title="Catch up & interests"
        >
          <History className="size-4" aria-hidden="true" />
        </ForumLink>
      </div>
      <div className="forum-feed-filters flex flex-wrap items-center gap-2">
        <nav
          aria-label="Feed source"
          className="forum-segmented-control flex gap-1 p-1"
        >
          {(["discover", "following"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`${actionClass} ${scope === value ? "bg-card text-primary" : "text-muted-foreground"}`}
              aria-pressed={scope === value}
              disabled={value === "following" && !isAuthenticated}
              onClick={() => changeFeed(value, authorFilter)}
            >
              {value === "discover" ? "Discover" : "Following"}
            </button>
          ))}
        </nav>
        <label className="forum-author-filter ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden min-[400px]:inline">Authors</span>
          <select
            aria-label="Authors"
            className="forum-select focus-ring bg-card text-foreground"
            value={authorFilter}
            onChange={(e) =>
              changeFeed(scope, e.target.value as ForumAuthorFilter)
            }
          >
            <option value="all">Everyone</option>
            <option value="humans">Humans</option>
            <option value="agents">Agents</option>
          </select>
        </label>
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
      <ForumFeedStarter />
      <ul className={display === "timeline" ? "forum-timeline" : "space-y-2"}>
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
  display = "timeline",
}: {
  thread: ForumFeedThread;
  display?: FeedDisplay;
}) {
  const href = forumPath(thread.categorySlug, thread.slug);
  const author = thread.authorIdentity;
  const replies = getThreadReplyCount(thread);
  const { isAuthenticated } = useConvexAuth();
  const save = useMutation(forumRefs.setThreadBookmark);
  const [saved, setSaved] = useState(thread.viewerBookmarked === true);
  const [saving, setSaving] = useState(false);
  useEffect(
    () => setSaved(thread.viewerBookmarked === true),
    [thread.viewerBookmarked],
  );
  async function saveThread() {
    if (!isAuthenticated) {
      toast.info("Sign in to save discussions to your reading list.");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const receipt = await save({ threadId: thread._id, saved: !saved });
      setSaved(receipt.saved);
    } catch {
      toast.error("Could not update your reading list.");
    } finally {
      setSaving(false);
    }
  }
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
      className={`forum-post-card min-w-0 ${display === "timeline" ? "forum-timeline-post" : display === "compact" ? "p-3" : "p-4"}`}
    >
      {display === "timeline" ? (
        <ForumLink
          href={forumMemberProfilePath(author.username)}
          className="focus-ring forum-timeline-avatar"
          aria-label={`View ${author.name}'s profile`}
        >
          <ForumAvatar
            alt=""
            className="size-9 rounded-full"
            name={author.name}
            src={author.avatarUrl}
          />
        </ForumLink>
      ) : null}
      <div className="forum-post-content min-w-0">
        <div className="forum-post-byline flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {display !== "timeline" ? (
            <ForumAvatar
              alt=""
              className="size-7 shrink-0 rounded-full"
              name={author.name}
              src={author.avatarUrl}
            />
          ) : null}
          <ForumLink
            className="focus-ring min-w-0 max-w-[55%] truncate font-semibold text-foreground hover:text-primary"
            href={forumMemberProfilePath(author.username)}
            title={author.name}
          >
            {author.name}
          </ForumLink>
          {display === "timeline" ? (
            <span
              className="forum-post-handle min-w-0 truncate"
              title={`@${author.username}`}
            >
              @{author.username}
            </span>
          ) : null}
          {author.isAgent ? (
            <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
              AI
            </span>
          ) : null}
          <ForumLink
            className="focus-ring forum-post-board inline-flex items-center text-[11px] text-muted-foreground hover:text-primary"
            href={forumPath(thread.categorySlug)}
            title={thread.categoryName}
          >
            {thread.categoryName}
          </ForumLink>
          {posted ? (
            <time
              className="ml-auto shrink-0 whitespace-nowrap text-[11px]"
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
        <h3
          className={`font-semibold leading-6 tracking-tight ${display === "cards" ? "text-lg sm:text-[19px] sm:leading-7" : "text-base sm:text-[17px]"}`}
        >
          <ForumLink
            className="focus-ring inline-flex max-w-full items-center py-1 hover:text-primary [overflow-wrap:anywhere]"
            href={href}
          >
            {thread.title}
          </ForumLink>
        </h3>
        <div className="flex flex-wrap items-center gap-2 empty:hidden">
          <ForumThreadPrefixBadge thread={thread} />
          <ForumThreadStateBadges thread={thread} />
        </div>
        {thread.sourceUrl ? (
          <a
            className="focus-ring inline-flex min-h-11 max-w-full items-center gap-1 text-xs text-accent"
            href={thread.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {forumSourceDomain(thread.sourceUrl)}{" "}
            <ArrowUpRight className="size-3" aria-hidden="true" />
            <span className="sr-only">Open source article</span>
          </a>
        ) : null}
        {thread.kind === "question" ? (
          <span className="text-xs text-accent">Question</span>
        ) : thread.kind === "showcase" ? (
          <span className="text-xs text-accent">Showcase</span>
        ) : null}
        {thread.excerpt ? (
          <p
            className={`mt-1 whitespace-pre-line break-words text-sm leading-[22px] text-muted-foreground [overflow-wrap:anywhere] ${display === "compact" ? "line-clamp-1" : "line-clamp-2"}`}
          >
            {thread.excerpt}
          </p>
        ) : null}
        <ForumMediaGallery
          attachments={thread.attachments}
          compact={display === "compact"}
        />
        <div className="forum-post-actions mt-1 flex flex-wrap items-center gap-1">
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
          <button
            className={actionClass}
            type="button"
            disabled={saving}
            aria-pressed={saved}
            aria-label={`${saved ? "Unsave" : "Save"} ${thread.title}`}
            onClick={() => void saveThread()}
          >
            <Bookmark
              className={`size-4 ${saved ? "fill-current text-primary" : ""}`}
              aria-hidden="true"
            />
            {saved ? "Saved" : "Save"}
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
      </div>
    </article>
  );
}
