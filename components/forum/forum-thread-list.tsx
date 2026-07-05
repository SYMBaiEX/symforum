"use client";

import { reportAppError } from "@/components/app-error-surface";
import { AuthRequiredDialog } from "@/components/auth-required-dialog";
import {
  ForumAttachmentDraftPanel,
  ForumCompose,
  type ForumAttachmentDraft,
} from "@/components/forum/forum-compose";
import {
  forumPath,
  forumPostPath,
  forumRefs,
  getCategoryDescription,
  getCategoryPostCount,
  getCategoryThreadCount,
  getCategoryTitle,
  type ForumCategoryRecord,
  type ForumSearchRecord,
  type ForumThreadPrefixRecord,
  type ForumThreadSummaryRecord,
} from "@/components/forum/forum-refs";
import {
  ForumAnnouncementPanel,
  ForumBody,
  ForumBreadcrumbs,
  ForumLink,
  ForumLoading,
  ForumMetricBar,
  ForumNewestThreads,
  ForumPaginationBar,
  ForumStatusBox,
  ForumThreadPrefixBadge,
  ForumThreadTable,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isAuthRequiredError, userFacingError } from "@/lib/auth-errors";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";

const THREADS_PER_PAGE = 25;
const PREFIX_FILTER_ALL = "all";
const PREFIX_FILTER_NONE = "none";
const EMPTY_THREADS: ForumThreadSummaryRecord[] = [];
const DEFAULT_THREAD_SORT_KEY = "lastPostAt";
const DEFAULT_THREAD_SORT_ORDER = "desc";
const THREAD_DAY_FILTER_ALL = "all";
const THREAD_SORT_OPTIONS = [
  { value: "lastPostAt", label: "Last post" },
  { value: "createdAt", label: "Started" },
  { value: "replies", label: "Replies" },
  { value: "views", label: "Views" },
  { value: "rating", label: "Rating" },
  { value: "title", label: "Title" },
] as const;
const THREAD_SORT_ORDER_OPTIONS = [
  { value: "desc", label: "Descending" },
  { value: "asc", label: "Ascending" },
] as const;
const THREAD_DAY_FILTER_OPTIONS = [
  { value: THREAD_DAY_FILTER_ALL, label: "All dates" },
  { value: "1", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last year" },
] as const;
type ThreadSortKey = (typeof THREAD_SORT_OPTIONS)[number]["value"];
type ThreadSortOrder = (typeof THREAD_SORT_ORDER_OPTIONS)[number]["value"];

export function ForumThreadList({
  categorySlug,
  enabled,
}: {
  categorySlug: string;
  enabled: boolean;
}) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Local forum disabled"
        body={`The ${categorySlug} board cannot load in this environment because Convex is not configured locally.`}
        accent="cyan"
        action={
          <Button asChild variant="outline">
            <ForumLink href="/forum" prefetch>
              Back to forum shell
            </ForumLink>
          </Button>
        }
      />
    );
  }

  return <LiveForumThreadList categorySlug={categorySlug} />;
}

function LiveForumThreadList({ categorySlug }: { categorySlug: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = parsePage(searchParams.get("page"));
  const prefixParam = searchParams.get("prefix");
  const selectedSortKey = resolveThreadSortKey(searchParams.get("sort"));
  const selectedSortOrder = resolveThreadSortOrder(searchParams.get("order"));
  const selectedDayFilter = resolveThreadDayFilter(searchParams.get("days"));
  const selectedDays =
    selectedDayFilter === THREAD_DAY_FILTER_ALL
      ? undefined
      : Number(selectedDayFilter);
  const threadPrefixes = useQuery(forumRefs.listThreadPrefixes, {
    categorySlug,
  });
  const selectedPrefixFilter = resolveSelectedPrefixFilter(
    prefixParam,
    threadPrefixes,
  );
  const serverPrefixId =
    selectedPrefixFilter === PREFIX_FILTER_ALL
      ? undefined
      : selectedPrefixFilter === PREFIX_FILTER_NONE
        ? null
        : selectedPrefixFilter;
  const listResult = useQuery(forumRefs.listThreads, {
    categorySlug,
    page,
    pageSize: THREADS_PER_PAGE,
    ...(serverPrefixId !== undefined ? { prefixId: serverPrefixId } : {}),
    ...(selectedSortKey !== DEFAULT_THREAD_SORT_KEY
      ? { sortKey: selectedSortKey }
      : {}),
    ...(selectedSortOrder !== DEFAULT_THREAD_SORT_ORDER
      ? { sortOrder: selectedSortOrder }
      : {}),
    ...(selectedDays !== undefined ? { days: selectedDays } : {}),
  });
  const createThread = useMutation(forumRefs.createThread);
  const markCategoryRead = useMutation(forumRefs.markCategoryRead);
  const toggleCategorySubscription = useMutation(
    forumRefs.toggleCategorySubscription,
  );
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [threadPrefixId, setThreadPrefixId] = useState("none");
  const [threadTitle, setThreadTitle] = useState("");
  const [threadBody, setThreadBody] = useState("");
  const [threadAttachments, setThreadAttachments] = useState<
    ForumAttachmentDraft[]
  >([]);
  const [threadPreviewOpen, setThreadPreviewOpen] = useState(false);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [authOpen, setAuthOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [markReadPending, setMarkReadPending] = useState(false);
  const [categorySubscriptionPending, setCategorySubscriptionPending] =
    useState(false);
  const [error, setError] = useState("");
  const [boardActionError, setBoardActionError] = useState("");
  const [authAction, setAuthAction] = useState("post to the forum");
  const deferredQuery = useDeferredValue(searchQuery.trim());
  const searchArgs =
    deferredQuery.length >= 2 ? { query: deferredQuery, categorySlug } : "skip";
  const searchResult = useQuery(forumRefs.search, searchArgs);
  const authRedirectTo = useMemo(
    () =>
      currentForumRedirectTo(pathname, searchParams, forumPath(categorySlug)),
    [categorySlug, pathname, searchParams],
  );
  const currentPageThreads = listResult?.threads ?? EMPTY_THREADS;
  const activePrefixOptions = useMemo(
    () => getActiveThreadPrefixOptions(threadPrefixes ?? []),
    [threadPrefixes],
  );
  const prefixFilterSummary = getPrefixFilterSummary(
    selectedPrefixFilter,
    activePrefixOptions,
  );

  const sortedNewestThreads = useMemo(() => {
    return listResult?.activityThreads ?? currentPageThreads.slice(0, 5);
  }, [currentPageThreads, listResult?.activityThreads]);
  const hasBoardActivity = sortedNewestThreads.length > 0;
  const viewerCanCreatePoll =
    listResult?.category?.viewerCanCreatePoll === true;

  async function submitThread() {
    if (!isAuthenticated) {
      setAuthAction("start a thread");
      setAuthOpen(true);
      return;
    }
    const currentCategory = listResult?.category;
    if (
      currentCategory === null ||
      currentCategory === undefined ||
      currentCategory.viewerCanCreateThread !== true
    ) {
      setError(
        currentCategory
          ? threadCreationUnavailableMessage(currentCategory, true)
          : "This board is not ready for new threads yet.",
      );
      return;
    }
    setBoardActionError("");
    if (threadTitle.trim().length < 4 || threadBody.trim().length < 8) {
      setError("Use a clearer title and enough body copy to start the thread.");
      return;
    }
    const pollPayload = pollEnabled
      ? buildPollPayload(pollQuestion, pollOptions)
      : undefined;
    if (pollEnabled && pollPayload === null) {
      setError("Polls need a question and at least two unique options.");
      return;
    }
    if (pollEnabled && !viewerCanCreatePoll) {
      setError("This board does not allow your account to create polls.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await createThread({
        categorySlug,
        prefixId: threadPrefixId === "none" ? null : threadPrefixId,
        title: threadTitle.trim(),
        body: threadBody.trim(),
        attachments: threadAttachments.map(({ storageId, filename }) => ({
          storageId,
          filename,
        })),
        ...(pollPayload ? { poll: pollPayload } : {}),
      });
      setComposeOpen(false);
      setThreadPrefixId("none");
      setThreadTitle("");
      setThreadBody("");
      setThreadAttachments([]);
      setThreadPreviewOpen(false);
      setPollEnabled(false);
      setPollQuestion("");
      setPollOptions(["", ""]);
      if (result.status === "pending") {
        setBoardActionError(
          "Thread submitted for approval. It will appear after a moderator approves it.",
        );
        return;
      }
      router.push(forumPath(categorySlug, result.threadSlug));
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("start a thread");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "thread_create_failed",
        component: "ForumThreadList",
        action: "forum:createThread",
        metadata: { categorySlug },
        notify: false,
      });
      setError(userFacingError(caught, "Could not create thread"));
    } finally {
      setPending(false);
    }
  }

  async function markBoardRead() {
    if (!isAuthenticated) {
      setAuthAction("mark this board read");
      setAuthOpen(true);
      return;
    }
    setMarkReadPending(true);
    setBoardActionError("");
    try {
      await markCategoryRead({ categorySlug });
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("mark this board read");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "category_mark_read_failed",
        component: "ForumThreadList",
        action: "forum:markCategoryRead",
        metadata: { categorySlug },
        notify: false,
      });
      setBoardActionError(userFacingError(caught, "Could not mark board read"));
    } finally {
      setMarkReadPending(false);
    }
  }

  async function toggleBoardSubscription() {
    if (!isAuthenticated) {
      setAuthAction("subscribe to this board");
      setAuthOpen(true);
      return;
    }
    setCategorySubscriptionPending(true);
    setBoardActionError("");
    try {
      await toggleCategorySubscription({ categorySlug });
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("subscribe to this board");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "category_subscription_failed",
        component: "ForumThreadList",
        action: "forum:toggleCategorySubscription",
        metadata: { categorySlug },
        notify: false,
      });
      setBoardActionError(
        userFacingError(caught, "Could not update board subscription"),
      );
    } finally {
      setCategorySubscriptionPending(false);
    }
  }

  function updatePrefixFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (value === PREFIX_FILTER_ALL) {
      params.delete("prefix");
    } else {
      params.set("prefix", value);
    }
    const query = params.toString();
    router.push(`${forumPath(categorySlug)}${query ? `?${query}` : ""}`);
  }

  function updateBoardListParam(
    key: string,
    value: string,
    defaultValue: string,
  ) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (value === defaultValue) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const query = params.toString();
    router.push(`${forumPath(categorySlug)}${query ? `?${query}` : ""}`);
  }

  if (listResult === undefined) {
    return <ForumLoading label={`Syncing ${categorySlug}`} variant="threads" />;
  }

  const category = listResult.category;

  if (!category) {
    return (
      <ForumStatusBox
        title="Category unavailable"
        body="This board was not returned by the forum backend. Check the category slug or seed data."
        accent="canary"
      />
    );
  }

  const boardPageHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (selectedPrefixFilter !== PREFIX_FILTER_ALL) {
      params.set("prefix", selectedPrefixFilter);
    }
    if (selectedSortKey !== DEFAULT_THREAD_SORT_KEY) {
      params.set("sort", selectedSortKey);
    }
    if (selectedSortOrder !== DEFAULT_THREAD_SORT_ORDER) {
      params.set("order", selectedSortOrder);
    }
    if (selectedDayFilter !== THREAD_DAY_FILTER_ALL) {
      params.set("days", selectedDayFilter);
    }
    if (nextPage > 1) {
      params.set("page", String(nextPage));
    }
    const query = params.toString();
    return `${forumPath(category.slug)}${query ? `?${query}` : ""}`;
  };
  const categorySubscribed = category.viewerSubscribedToCategory === true;
  const viewerCanCreateThread = category.viewerCanCreateThread === true;
  const threadCreationMessage = threadCreationUnavailableMessage(
    category,
    isAuthenticated,
  );

  function toggleThreadComposer() {
    setError("");
    if (composeOpen) {
      setComposeOpen(false);
      return;
    }
    if (!isAuthenticated) {
      setAuthAction("start a thread");
      setAuthOpen(true);
      return;
    }
    if (!viewerCanCreateThread) {
      setBoardActionError(threadCreationMessage);
      return;
    }
    setBoardActionError("");
    setComposeOpen(true);
  }

  return (
    <div className="space-y-8">
      <div className="border-y border-row-border py-4">
        <ForumBreadcrumbs category={category} />
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-end">
          <div>
            <p className="page-kicker">Public board</p>
            <h1 className="mt-2 text-2xl font-semibold md:text-3xl">
              {getCategoryTitle(category)}
            </h1>
            {getCategoryDescription(category) ? (
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
                {getCategoryDescription(category)}
              </p>
            ) : null}
          </div>
          <ForumMetricBar
            items={[
              { label: "Threads", value: getCategoryThreadCount(category) },
              { label: "Posts", value: getCategoryPostCount(category) },
            ]}
            className="sm:grid-cols-2"
          />
        </div>
      </div>

      <ForumAnnouncementPanel announcements={listResult.announcements} />

      <section
        className={`grid gap-8 ${
          hasBoardActivity
            ? "xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.8fr)]"
            : ""
        }`}
      >
        <div className="min-w-0 space-y-6">
          <div className="flex flex-col gap-3 border-y border-row-border py-4 md:flex-row md:items-center md:justify-between">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Search this board</span>
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search threads or post copy in this board"
                className="rounded-none border-row-border font-mono text-[11px] uppercase"
                aria-label="Search this board"
              />
            </label>
            <Button
              className="rounded-none font-mono text-[10px] uppercase"
              type="button"
              disabled={authLoading || pending}
              onClick={toggleThreadComposer}
            >
              {composeOpen ? "Close thread form" : "New thread"}
            </Button>
            <Button
              className="rounded-none font-mono text-[10px] uppercase"
              type="button"
              variant="outline"
              disabled={authLoading || categorySubscriptionPending}
              onClick={toggleBoardSubscription}
            >
              {categorySubscriptionPending
                ? "Saving..."
                : categorySubscribed
                  ? "Unsubscribe board"
                  : "Subscribe board"}
            </Button>
            <Button
              className="rounded-none font-mono text-[10px] uppercase"
              type="button"
              variant="outline"
              disabled={authLoading || markReadPending}
              onClick={markBoardRead}
            >
              {markReadPending ? "Marking..." : "Mark board read"}
            </Button>
          </div>
          {boardActionError ? (
            <p
              className="border border-row-border p-3 text-sm text-muted-foreground"
              role="alert"
            >
              {boardActionError}
            </p>
          ) : null}

          {composeOpen && viewerCanCreateThread ? (
            <ForumCompose
              title={threadTitle}
              onTitleChange={setThreadTitle}
              titlePlaceholder="Short, specific thread title"
              body={threadBody}
              onBodyChange={setThreadBody}
              bodyPlaceholder="Open the discussion. Keep the first post concrete."
              bodyLabel="First post"
              submitLabel="Post thread"
              pending={pending}
              disabled={authLoading || !viewerCanCreateThread}
              error={error}
              footerActions={
                <Button
                  className="rounded-none font-mono text-[10px] uppercase"
                  type="button"
                  variant="outline"
                  disabled={threadBody.trim().length === 0}
                  onClick={() => setThreadPreviewOpen((current) => !current)}
                >
                  {threadPreviewOpen ? "Hide preview" : "Preview"}
                </Button>
              }
              note="Thread creation requires a signed-in SYM handle."
              onSubmit={submitThread}
            >
              <ForumPrefixSelect
                disabled={pending || authLoading}
                prefixes={threadPrefixes ?? []}
                value={threadPrefixId}
                onChange={setThreadPrefixId}
              />
              <ForumPollDraft
                disabled={!viewerCanCreatePoll}
                enabled={pollEnabled}
                onEnabledChange={setPollEnabled}
                question={pollQuestion}
                onQuestionChange={setPollQuestion}
                options={pollOptions}
                onOptionsChange={setPollOptions}
              />
              <ForumAttachmentDraftPanel
                attachments={threadAttachments}
                disabled={pending || authLoading || !viewerCanCreateThread}
                onAttachmentsChange={setThreadAttachments}
              />
              {threadPreviewOpen ? (
                <ThreadPreviewPanel body={threadBody} />
              ) : null}
            </ForumCompose>
          ) : isAuthenticated && !viewerCanCreateThread ? (
            <ForumStatusBox
              title="Thread posting unavailable"
              body={threadCreationMessage}
              accent="canary"
            />
          ) : null}

          {deferredQuery.length >= 2 ? (
            <ForumSearchResults
              categorySlug={category.slug}
              query={deferredQuery}
              searchResult={searchResult}
            />
          ) : null}

          <ForumPaginationBar
            buildHref={boardPageHref}
            label="Threads"
            pagination={listResult.pagination}
          />
          <ForumBoardTools
            activePrefixes={activePrefixOptions}
            filterSummary={prefixFilterSummary}
            dayFilter={selectedDayFilter}
            onPrefixFilterChange={updatePrefixFilter}
            onSortKeyChange={(value) =>
              updateBoardListParam("sort", value, DEFAULT_THREAD_SORT_KEY)
            }
            onSortOrderChange={(value) =>
              updateBoardListParam("order", value, DEFAULT_THREAD_SORT_ORDER)
            }
            onDayFilterChange={(value) =>
              updateBoardListParam("days", value, THREAD_DAY_FILTER_ALL)
            }
            prefixFilter={selectedPrefixFilter}
            sortKey={selectedSortKey}
            sortOrder={selectedSortOrder}
            visibleThreadCount={currentPageThreads.length}
          />
          {currentPageThreads.length === 0 &&
          selectedPrefixFilter !== PREFIX_FILTER_ALL ? (
            <ForumStatusBox
              title="No matching threads"
              body={`No threads in this board match ${prefixFilterSummary}. Switch back to all prefixes or choose another filter.`}
            />
          ) : (
            <ForumThreadTable
              category={category}
              threads={currentPageThreads}
            />
          )}
          <ForumPaginationBar
            buildHref={boardPageHref}
            label="Threads"
            pagination={listResult.pagination}
          />
        </div>

        {hasBoardActivity ? (
          <div className="space-y-6">
            <ForumNewestThreads
              threads={sortedNewestThreads}
              heading={
                selectedPrefixFilter === PREFIX_FILTER_ALL
                  ? "Board activity"
                  : `Board activity: ${prefixFilterSummary}`
              }
            />
          </div>
        ) : null}
      </section>

      <AuthRequiredDialog
        action={authAction}
        open={authOpen}
        redirectTo={authRedirectTo}
        setOpen={setAuthOpen}
      />
    </div>
  );
}

function threadCreationUnavailableMessage(
  category: ForumCategoryRecord,
  isAuthenticated: boolean,
) {
  if (!isAuthenticated) {
    return "Sign in with a SYM handle to start threads on this board.";
  }
  if (category.threadAccess === "closed") {
    return "This board is read-only. New threads are closed here.";
  }
  if (category.threadAccess === "staff") {
    return "Only forum staff can start threads on this board.";
  }
  if (category.threadAccess === "trusted") {
    return "A moderator needs to approve your forum access before you can start threads here.";
  }
  return "Your account cannot start threads on this board right now.";
}

function ForumBoardTools({
  activePrefixes,
  dayFilter,
  filterSummary,
  onDayFilterChange,
  onPrefixFilterChange,
  onSortKeyChange,
  onSortOrderChange,
  prefixFilter,
  sortKey,
  sortOrder,
  visibleThreadCount,
}: {
  activePrefixes: ForumThreadPrefixOption[];
  dayFilter: string;
  filterSummary: string;
  onDayFilterChange: (value: string) => void;
  onPrefixFilterChange: (value: string) => void;
  onSortKeyChange: (value: ThreadSortKey) => void;
  onSortOrderChange: (value: ThreadSortOrder) => void;
  prefixFilter: string;
  sortKey: ThreadSortKey;
  sortOrder: ThreadSortOrder;
  visibleThreadCount: number;
}) {
  const sortLabel = getThreadSortLabel(sortKey);
  const orderLabel = getThreadSortOrderLabel(sortOrder);
  const dayLabel = getThreadDayFilterLabel(dayFilter);

  return (
    <section className="grid gap-px border border-row-border bg-row-border font-mono text-[10px] uppercase text-muted-foreground md:grid-cols-2 xl:grid-cols-[7rem_repeat(4,minmax(8rem,1fr))_minmax(12rem,1.2fr)]">
      <div className="bg-background px-3 py-2 text-foreground">Board tools</div>
      <label className="grid gap-1 bg-background px-3 py-2">
        <span>Prefix filter</span>
        <select
          aria-label="Filter board by thread prefix"
          className="min-h-8 rounded-none border border-row-border bg-background px-2 font-mono text-[10px] uppercase text-foreground"
          value={prefixFilter}
          onChange={(event) => onPrefixFilterChange(event.target.value)}
        >
          <option value={PREFIX_FILTER_ALL}>All prefixes</option>
          <option value={PREFIX_FILTER_NONE}>No prefix</option>
          {activePrefixes.length > 0 ? (
            <optgroup label="Board prefixes">
              {activePrefixes.map((option) => (
                <option key={option.value} value={option.value}>
                  [{option.prefix.label}]
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>
      <label className="grid gap-1 bg-background px-3 py-2">
        <span>Sort by</span>
        <select
          aria-label="Sort board threads"
          className="min-h-8 rounded-none border border-row-border bg-background px-2 font-mono text-[10px] uppercase text-foreground"
          value={sortKey}
          onChange={(event) =>
            onSortKeyChange(event.target.value as ThreadSortKey)
          }
        >
          {THREAD_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 bg-background px-3 py-2">
        <span>Order</span>
        <select
          aria-label="Set board thread sort order"
          className="min-h-8 rounded-none border border-row-border bg-background px-2 font-mono text-[10px] uppercase text-foreground"
          value={sortOrder}
          onChange={(event) =>
            onSortOrderChange(event.target.value as ThreadSortOrder)
          }
        >
          {THREAD_SORT_ORDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 bg-background px-3 py-2">
        <span>Date window</span>
        <select
          aria-label="Limit board threads by recent activity"
          className="min-h-8 rounded-none border border-row-border bg-background px-2 font-mono text-[10px] uppercase text-foreground"
          value={dayFilter}
          onChange={(event) => onDayFilterChange(event.target.value)}
        >
          {THREAD_DAY_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="bg-background px-3 py-2">
        <p className="text-foreground">{filterSummary}</p>
        <p className="mt-1">
          {sortLabel} / {orderLabel} / {dayLabel} / showing {visibleThreadCount}{" "}
          loaded {visibleThreadCount === 1 ? "thread" : "threads"}.
        </p>
      </div>
    </section>
  );
}

function ThreadPreviewPanel({ body }: { body: string }) {
  return (
    <div className="border border-row-border p-3">
      <p className="mb-3 font-mono text-[10px] uppercase text-muted-foreground">
        Preview
      </p>
      <ForumBody body={body} />
    </div>
  );
}

function currentForumRedirectTo(
  pathname: string | null,
  searchParams: Pick<URLSearchParams, "toString">,
  fallback: string,
) {
  const query = searchParams.toString();
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  return `${pathname ?? fallback}${query ? `?${query}` : ""}${hash}`;
}

type ForumThreadPrefixOption = {
  prefix: ForumThreadPrefixRecord;
  value: string;
};

function getActiveThreadPrefixOptions(
  availablePrefixes: ForumThreadPrefixRecord[],
): ForumThreadPrefixOption[] {
  const options: ForumThreadPrefixOption[] = [];
  const seen = new Set<string>();

  availablePrefixes.forEach((prefix) => {
    const value = getPrefixFilterValue(prefix);
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    options.push({ prefix, value });
  });

  return options;
}

function getPrefixFilterValue(prefix: ForumThreadPrefixRecord) {
  return prefix._id ?? prefix.slug;
}

function resolveSelectedPrefixFilter(
  prefixParam: string | null,
  prefixes: ForumThreadPrefixRecord[] | undefined,
) {
  if (prefixParam === PREFIX_FILTER_NONE) {
    return PREFIX_FILTER_NONE;
  }
  if (!prefixParam || prefixParam === PREFIX_FILTER_ALL) {
    return PREFIX_FILTER_ALL;
  }
  if (
    prefixes?.some((prefix) => getPrefixFilterValue(prefix) === prefixParam)
  ) {
    return prefixParam;
  }
  return PREFIX_FILTER_ALL;
}

function resolveThreadSortKey(value: string | null): ThreadSortKey {
  return THREAD_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as ThreadSortKey)
    : DEFAULT_THREAD_SORT_KEY;
}

function resolveThreadSortOrder(value: string | null): ThreadSortOrder {
  return THREAD_SORT_ORDER_OPTIONS.some((option) => option.value === value)
    ? (value as ThreadSortOrder)
    : DEFAULT_THREAD_SORT_ORDER;
}

function resolveThreadDayFilter(value: string | null) {
  return THREAD_DAY_FILTER_OPTIONS.some((option) => option.value === value)
    ? (value ?? THREAD_DAY_FILTER_ALL)
    : THREAD_DAY_FILTER_ALL;
}

function getThreadSortLabel(value: ThreadSortKey) {
  return (
    THREAD_SORT_OPTIONS.find((option) => option.value === value)?.label ??
    "Last post"
  );
}

function getThreadSortOrderLabel(value: ThreadSortOrder) {
  return (
    THREAD_SORT_ORDER_OPTIONS.find((option) => option.value === value)?.label ??
    "Descending"
  );
}

function getThreadDayFilterLabel(value: string) {
  return (
    THREAD_DAY_FILTER_OPTIONS.find((option) => option.value === value)?.label ??
    "All dates"
  );
}

function getPrefixFilterSummary(
  prefixFilter: string,
  activePrefixes: ForumThreadPrefixOption[],
) {
  if (prefixFilter === PREFIX_FILTER_NONE) {
    return "No prefix";
  }
  const activePrefix = activePrefixes.find(
    (option) => option.value === prefixFilter,
  );
  if (activePrefix) {
    return `[${activePrefix.prefix.label}]`;
  }
  return "All prefixes";
}

function buildPollPayload(question: string, options: string[]) {
  const cleanedQuestion = question.trim();
  const cleanedOptions = options.map((option) => option.trim()).filter(Boolean);
  const distinctOptions = new Set(
    cleanedOptions.map((option) => option.toLowerCase()),
  );
  if (
    cleanedQuestion.length < 4 ||
    cleanedOptions.length < 2 ||
    cleanedOptions.length > 8 ||
    distinctOptions.size !== cleanedOptions.length
  ) {
    return null;
  }
  return { question: cleanedQuestion, options: cleanedOptions };
}

function ForumPrefixSelect({
  disabled,
  prefixes,
  value,
  onChange,
}: {
  disabled: boolean;
  prefixes: ForumThreadPrefixRecord[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (prefixes.length === 0) {
    return null;
  }

  return (
    <label className="grid gap-2">
      <span className="font-mono text-[10px] uppercase text-muted-foreground">
        Prefix
      </span>
      <select
        className="min-h-10 rounded-none border border-row-border bg-background px-3 font-mono text-[11px] uppercase text-foreground"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="none">No prefix</option>
        {prefixes.map((prefix) => (
          <option
            key={prefix._id ?? prefix.slug}
            value={prefix._id ?? prefix.slug}
          >
            {prefix.categoryName ? `${prefix.categoryName}: ` : ""}[
            {prefix.label}]
          </option>
        ))}
      </select>
    </label>
  );
}

function ForumPollDraft({
  disabled,
  enabled,
  onEnabledChange,
  question,
  onQuestionChange,
  options,
  onOptionsChange,
}: {
  disabled: boolean;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  question: string;
  onQuestionChange: (question: string) => void;
  options: string[];
  onOptionsChange: (options: string[]) => void;
}) {
  function updateOption(index: number, value: string) {
    onOptionsChange(
      options.map((option, optionIndex) =>
        optionIndex === index ? value : option,
      ),
    );
  }

  function addOption() {
    onOptionsChange([...options, ""]);
  }

  function removeOption(index: number) {
    onOptionsChange(options.filter((_, optionIndex) => optionIndex !== index));
  }

  return (
    <fieldset className="border border-row-border p-3">
      <label className="flex items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
        <input
          type="checkbox"
          disabled={disabled}
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        Add poll
      </label>
      {disabled ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Poll creation is not available for your account on this board.
        </p>
      ) : null}
      {enabled ? (
        <div className="mt-4 grid gap-3">
          <label className="grid gap-2">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              Question
            </span>
            <Input
              disabled={disabled}
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              placeholder="What should the board vote on?"
              className="rounded-none border-row-border"
            />
          </label>
          <div className="grid gap-2">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              Options
            </span>
            {options.map((option, index) => (
              <div key={`poll-option-${index}`} className="flex gap-2">
                <Input
                  aria-label={`Poll option ${index + 1}`}
                  disabled={disabled}
                  value={option}
                  onChange={(event) => updateOption(index, event.target.value)}
                  placeholder={`Option ${index + 1}`}
                  className="rounded-none border-row-border"
                />
                {options.length > 2 ? (
                  <Button
                    className="rounded-none font-mono text-[10px] uppercase"
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => removeOption(index)}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
            {options.length < 8 ? (
              <Button
                className="justify-self-start rounded-none font-mono text-[10px] uppercase"
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={addOption}
              >
                Add option
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

function ForumSearchResults({
  categorySlug,
  query,
  searchResult,
}: {
  categorySlug: string;
  query: string;
  searchResult: ForumSearchRecord | undefined;
}) {
  if (searchResult === undefined) {
    return <ForumLoading label={`Searching ${query}`} />;
  }

  const { threads, posts } = searchResult;

  if (threads.length === 0 && posts.length === 0) {
    return (
      <ForumStatusBox
        title="Search"
        body={`No public matches for “${query}” in this board.`}
      />
    );
  }

  return (
    <section className="border border-row-border">
      <div className="border-b border-row-border px-4 py-3">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Search
        </p>
        <h2 className="mt-2 text-xl font-semibold">Matches for “{query}”</h2>
      </div>
      <div className="divide-y divide-row-border">
        {threads.map((thread) => (
          <div key={`thread-${thread._id}`} className="px-4 py-4">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Thread
            </p>
            <ForumLink
              href={forumPath(categorySlug, thread.slug)}
              prefetch
              className="focus-ring mt-2 flex flex-wrap items-center gap-2 text-base font-semibold hover:text-primary"
            >
              <ForumThreadPrefixBadge thread={thread} />
              {thread.title}
            </ForumLink>
            {thread.excerpt ? (
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {thread.excerpt}
              </p>
            ) : null}
          </div>
        ))}
        {posts.map((post) => (
          <div key={`post-${post._id}`} className="px-4 py-4">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Post
            </p>
            <ForumLink
              href={forumPostPath(
                categorySlug,
                post.threadSlug,
                post.postNumber,
                post.postPage,
              )}
              prefetch
              className="focus-ring mt-2 block text-sm font-semibold hover:text-primary"
            >
              {post.authorUsername ??
                post.authorName ??
                post.author ??
                "SYM-UNKNOWN"}
            </ForumLink>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
              {post.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function parsePage(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
}
