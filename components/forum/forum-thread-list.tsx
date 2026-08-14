"use client";

import { asRoute } from "@/lib/typed-route";

import { reportAppError } from "@/components/app-error-surface";
import { AuthRequiredDialog } from "@/components/auth-required-dialog";
import type { ForumAttachmentDraft } from "@/components/forum/forum-compose";
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
  ForumPaginationBar,
  ForumStatusBox,
  ForumThreadPrefixBadge,
  ForumThreadTable,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isAuthRequiredError, userFacingError } from "@/lib/auth-errors";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useConvexAuth, useMutation } from "convex/react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const ForumCompose = dynamic(
  () =>
    import("@/components/forum/forum-compose").then(
      (module) => module.ForumCompose,
    ),
  {
    loading: () => (
      <p className="border-y border-row-border py-3 font-mono text-[10px] uppercase text-muted-foreground">
        Loading editor
      </p>
    ),
    ssr: false,
  },
);
const ForumAttachmentDraftPanel = dynamic(
  () =>
    import("@/components/forum/forum-compose").then(
      (module) => module.ForumAttachmentDraftPanel,
    ),
  { ssr: false },
);

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
  const isNewestFirstOrder =
    selectedSortKey === DEFAULT_THREAD_SORT_KEY && selectedSortOrder !== "asc";
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
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedSearchQuery(searchQuery.trim()),
      450,
    );
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);
  const searchArgs =
    debouncedSearchQuery.length >= 3
      ? {
          query: debouncedSearchQuery,
          categorySlug,
          resultType: "threads" as const,
          pageSize: 12,
        }
      : "skip";
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
      router.push(asRoute(`${forumPath(categorySlug)}${query ? `?${query}` : ""}`));
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
      router.push(asRoute(`${forumPath(categorySlug)}${query ? `?${query}` : ""}`));
  }

  function resetBoardView() {
    router.push(forumPath(categorySlug));
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
  const boardFiltersActive =
    selectedPrefixFilter !== PREFIX_FILTER_ALL ||
    selectedSortKey !== DEFAULT_THREAD_SORT_KEY ||
    selectedSortOrder !== DEFAULT_THREAD_SORT_ORDER ||
    selectedDayFilter !== THREAD_DAY_FILTER_ALL;
  const showBoardTools = currentPageThreads.length > 0 || boardFiltersActive;
  const showPagination = listResult.pagination.totalPages > 1;
  const boardIsEmpty = currentPageThreads.length === 0 && !boardFiltersActive;
  const hasSubboards = (category.children?.length ?? 0) > 0;

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
    <div className="space-y-3">
      <div className="border-y border-row-border py-2">
        <ForumBreadcrumbs category={category} />
        <div className="mt-2">
          <p className="page-kicker">Public board</p>
          <h2 className="mt-1 text-xl font-semibold md:text-2xl">
            {getCategoryTitle(category)}
          </h2>
          {getCategoryDescription(category) ? (
            <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">
              {getCategoryDescription(category)}
            </p>
          ) : null}
          <dl className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground">
            <div className="inline-flex items-baseline gap-1.5">
              <dt>Threads</dt>
              <dd className="font-semibold tabular-nums text-foreground">
                {getCategoryThreadCount(category)}
              </dd>
            </div>
            {hasSubboards ? (
              <div className="text-muted-foreground">
                <dt className="sr-only">Scope</dt>
                <dd>Includes {category.children?.length ?? 0} sub-boards</dd>
              </div>
            ) : null}
            <div className="inline-flex items-baseline gap-1.5">
              <dt>Posts</dt>
              <dd className="font-semibold tabular-nums text-foreground">
                {getCategoryPostCount(category)}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <ForumSubboardSelector
        boards={category.children ?? []}
        parentTitle={getCategoryTitle(category)}
      />

      <ForumAnnouncementPanel announcements={listResult.announcements} />

      <section>
        <div className="min-w-0 space-y-3">
          <div className="grid gap-2 border-y border-row-border py-2 md:grid-cols-[minmax(12rem,1fr)_auto] md:items-center">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Search this board</span>
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search this board"
                className="h-10 rounded-none border-row-border font-mono text-xs uppercase lg:h-8"
                aria-label="Search this board"
              />
            </label>
            <div className="grid min-w-0 grid-cols-2 gap-1 sm:flex sm:flex-wrap md:justify-end">
              <Button
                className="min-h-10 rounded-none font-mono text-[10px] uppercase lg:min-h-8"
                type="button"
                disabled={authLoading || pending}
                onClick={toggleThreadComposer}
              >
                {composeOpen ? "Close thread form" : "New thread"}
              </Button>
              <Button
                className="min-h-10 rounded-none font-mono text-[10px] uppercase lg:min-h-8"
                type="button"
                variant="outline"
                disabled={authLoading || categorySubscriptionPending}
                onClick={toggleBoardSubscription}
              >
                {categorySubscriptionPending
                  ? "Saving..."
                  : categorySubscribed
                    ? "Unsubscribe"
                    : "Subscribe"}
              </Button>
              <Button
                className="min-h-10 rounded-none font-mono text-[10px] uppercase lg:min-h-8"
                type="button"
                variant="outline"
                disabled={authLoading || markReadPending}
                onClick={markBoardRead}
              >
                {markReadPending ? "Marking..." : "Mark read"}
              </Button>
            </div>
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
              draftKey={`symbaiex:forum:draft:thread:${categorySlug}`}
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
              note="Thread creation requires a signed-in SYM handle. Mention a member with @handle to send an in-app alert."
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

          {debouncedSearchQuery.length >= 3 ? (
            <ForumSearchResults
              categorySlug={category.slug}
              query={debouncedSearchQuery}
              searchResult={searchResult}
            />
          ) : null}

          {showBoardTools ? (
            <ForumBoardTools
              activePrefixes={activePrefixOptions}
              dayFilter={selectedDayFilter}
              filterSummary={prefixFilterSummary}
              filtersActive={boardFiltersActive}
              onDayFilterChange={(value) =>
                updateBoardListParam("days", value, THREAD_DAY_FILTER_ALL)
              }
              onPrefixFilterChange={updatePrefixFilter}
              onSortKeyChange={(value) =>
                updateBoardListParam("sort", value, DEFAULT_THREAD_SORT_KEY)
              }
              onSortOrderChange={(value) =>
                updateBoardListParam("order", value, DEFAULT_THREAD_SORT_ORDER)
              }
              prefixFilter={selectedPrefixFilter}
              sortKey={selectedSortKey}
              sortOrder={selectedSortOrder}
              visibleThreadCount={currentPageThreads.length}
            />
          ) : null}
          {showPagination ? (
            <ForumPaginationBar
              buildHref={boardPageHref}
              label="Threads"
              nextLabel={isNewestFirstOrder ? undefined : "Next"}
              pagination={listResult.pagination}
              previousLabel={isNewestFirstOrder ? undefined : "Prev"}
            />
          ) : null}
          {boardIsEmpty ? (
            <ForumStatusBox
              title={
                hasSubboards
                  ? `No direct threads in ${getCategoryTitle(category)}`
                  : `No threads in ${getCategoryTitle(category)}`
              }
              body={
                !isAuthenticated || viewerCanCreateThread
                  ? hasSubboards
                    ? "Start a broad discussion here, or choose a focused sub-board above."
                    : "Start the first useful discussion for this board."
                  : threadCreationMessage
              }
              action={
                !isAuthenticated || viewerCanCreateThread ? (
                  <Button
                    className="min-h-10 rounded-none font-mono text-xs uppercase"
                    type="button"
                    onClick={toggleThreadComposer}
                  >
                    {hasSubboards
                      ? "Start a thread here"
                      : "Start the first thread"}
                  </Button>
                ) : undefined
              }
            />
          ) : currentPageThreads.length === 0 ? (
            <ForumStatusBox
              title="No matching threads"
              body={`No threads match ${prefixFilterSummary} with the current board filters.`}
              action={
                <Button
                  className="min-h-10 rounded-none font-mono text-xs uppercase"
                  type="button"
                  variant="outline"
                  onClick={resetBoardView}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ForumThreadTable
              category={category}
              showFooter={false}
              threads={currentPageThreads}
            />
          )}
          {showPagination ? (
            <ForumPaginationBar
              buildHref={boardPageHref}
              label="Threads"
              nextLabel={isNewestFirstOrder ? undefined : "Next"}
              pagination={listResult.pagination}
              previousLabel={isNewestFirstOrder ? undefined : "Prev"}
            />
          ) : null}
        </div>
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

function ForumSubboardSelector({
  boards,
  parentTitle,
}: {
  boards: ForumCategoryRecord[];
  parentTitle: string;
}) {
  if (boards.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label={`${parentTitle} sub-boards`}
      className="border-y border-row-border"
    >
      <div className="flex min-h-10 items-baseline justify-between gap-3 border-b border-row-border px-3 py-2">
        <h2 className="font-mono text-xs uppercase text-primary">Sub-boards</h2>
        <p className="font-mono text-xs uppercase text-muted-foreground">
          {boards.length}
        </p>
      </div>
      <div
        className={`grid grid-cols-2 gap-px bg-row-border ${
          boards.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3"
        } xl:grid-cols-6`}
      >
        {boards.map((board) => (
          <ForumLink
            className="focus-ring group flex min-h-16 min-w-0 flex-col justify-between bg-background px-2.5 py-2 hover:bg-muted/30 md:px-3"
            href={forumPath(board.slug)}
            key={board.slug}
            prefetch
          >
            <span>
              <span className="block text-sm font-semibold leading-tight group-hover:text-primary md:text-base">
                {getCategoryTitle(board)}
              </span>
              {getCategoryDescription(board) ? (
                <span className="mt-1 hidden line-clamp-1 text-xs leading-5 text-muted-foreground md:block">
                  {getCategoryDescription(board)}
                </span>
              ) : null}
            </span>
            <span className="mt-2 flex items-center justify-between gap-2 font-mono text-xs uppercase text-muted-foreground">
              <span className="truncate">
                {forumItemCount(getCategoryThreadCount(board), "thread")}
                <span className="hidden sm:inline">
                  {" "}
                  · {forumItemCount(getCategoryPostCount(board), "post")}
                </span>
              </span>
              <span aria-hidden="true" className="text-primary">
                →
              </span>
            </span>
          </ForumLink>
        ))}
      </div>
    </nav>
  );
}

function forumItemCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
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
  filtersActive,
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
  filtersActive: boolean;
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
    <details
      className="group border-y border-row-border"
      open={filtersActive || undefined}
    >
      <summary className="focus-ring flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-mono text-xs uppercase text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">
          <span className="text-foreground">Filter & sort</span>
          <span className="px-2">/</span>
          {filterSummary} · {sortLabel} · {orderLabel} · {dayLabel}
        </span>
        <span className="shrink-0 text-primary">
          <span className="group-open:hidden">Open</span>
          <span className="hidden group-open:inline">Close</span>
        </span>
      </summary>
      <div className="grid gap-px border-t border-row-border bg-row-border font-mono text-xs uppercase text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 bg-background px-3 py-2">
          <span>Prefix</span>
          <select
            aria-label="Filter board by thread prefix"
            className="min-h-10 rounded-none border border-row-border bg-background px-2 font-mono text-xs uppercase text-foreground"
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
            className="min-h-10 rounded-none border border-row-border bg-background px-2 font-mono text-xs uppercase text-foreground"
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
            className="min-h-10 rounded-none border border-row-border bg-background px-2 font-mono text-xs uppercase text-foreground"
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
            className="min-h-10 rounded-none border border-row-border bg-background px-2 font-mono text-xs uppercase text-foreground"
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
      </div>
      <p className="border-t border-row-border px-3 py-2 font-mono text-xs uppercase text-muted-foreground">
        Showing {visibleThreadCount} loaded{" "}
        {visibleThreadCount === 1 ? "thread" : "threads"}.
      </p>
    </details>
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
        <div className="mt-3 grid gap-3">
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
          <div key={`thread-${thread._id}`} className="px-3 py-2.5">
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
          <div key={`post-${post._id}`} className="px-3 py-2.5">
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
