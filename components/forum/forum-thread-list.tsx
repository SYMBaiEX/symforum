"use client";
import { forumExperienceRefs } from "./forum-experience-refs";
import {
  FORUM_POST_KINDS,
  FORUM_CONVERSATION_PROMPTS,
  type ForumPostKind,
} from "@/lib/forum-experience";
import { convexRefs } from "@/lib/convex-refs";

import { ChevronDown, MessageSquare, Plus, Search } from "lucide-react";
import {
  ForumBodyGrid,
  ForumPageHeader,
  ForumSectionHeader,
} from "./forum-layout-primitives";

import { asRoute } from "@/lib/typed-route";

import { reportAppError } from "@/components/app-error-surface";
import { AuthRequiredDialog } from "@/components/auth-required-dialog";
import type { ForumAttachmentDraft } from "@/components/forum/forum-compose";
import {
  formatForumCount,
  formatForumDateTime,
  getCategoryLatestThread,
  getThreadLastAuthor,
  getThreadLastActivityAt,
  getThreadLastPostHref,
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
  handleForumDisclosureKeyDown,
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
import { useConvex, useConvexAuth, useMutation } from "convex/react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

const ForumCompose = dynamic(
  () =>
    import("@/components/forum/forum-compose").then(
      (module) => module.ForumCompose,
    ),
  {
    loading: () => (
      <p className="py-3 text-sm text-muted-foreground">Loading editor</p>
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
  showHeading = true,
}: {
  categorySlug: string;
  enabled: boolean;
  showHeading?: boolean;
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

  return (
    <LiveForumThreadList
      key={categorySlug}
      categorySlug={categorySlug}
      showHeading={showHeading}
    />
  );
}

function LiveForumThreadList({
  categorySlug,
  showHeading,
}: {
  categorySlug: string;
  showHeading: boolean;
}) {
  const convex = useConvex();
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
  const composeRequest = `${categorySlug}:${searchParams.get("compose") ?? ""}`;
  const [previousComposeRequest, setPreviousComposeRequest] =
    useState(composeRequest);
  const [composeOpen, setComposeOpen] = useState(
    () => searchParams.get("compose") === "1",
  );
  if (previousComposeRequest !== composeRequest) {
    setPreviousComposeRequest(composeRequest);
    if (searchParams.get("compose") === "1") setComposeOpen(true);
  }
  const record = useMutation(forumExperienceRefs.event);
  const [lastRecordedCompose, setLastRecordedCompose] = useState(false);
  useEffect(() => {
    if (composeOpen && isAuthenticated && !lastRecordedCompose) {
      setLastRecordedCompose(true);
      void record({ event: "composer_open" }).catch(() => {});
    } else if (!composeOpen && lastRecordedCompose)
      setLastRecordedCompose(false);
  }, [composeOpen, isAuthenticated, lastRecordedCompose, record]);
  const [threadPrefixId, setThreadPrefixId] = useState("none");
  const viewer = useQuery(
    convexRefs.users.maybeViewer,
    isAuthenticated ? {} : "skip",
  );
  const prompt = FORUM_CONVERSATION_PROMPTS.find(
    (p) => p.id === searchParams.get("template"),
  );
  const [threadKind, setThreadKind] = useState<ForumPostKind>(
    prompt?.kind ??
      FORUM_POST_KINDS.find((kind) => kind === searchParams.get("kind")) ??
      "discussion",
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [threadTitle, setThreadTitle] = useState("");
  const [threadBody, setThreadBody] = useState(prompt?.body ?? "");
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
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [submittedSearchScope, setSubmittedSearchScope] = useState("");
  const [searchResult, setSearchResult] = useState<ForumSearchRecord>();
  const [searchPending, setSearchPending] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchRequestId = useRef(0);
  const searchScope = `${categorySlug}:${isAuthenticated ? "signed-in" : "guest"}`;
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

  async function submitBoardSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 3) {
      setSearchError("Use at least three characters to search this board.");
      return;
    }
    const requestId = searchRequestId.current + 1;
    searchRequestId.current = requestId;
    setSubmittedSearchQuery(query);
    setSubmittedSearchScope(searchScope);
    setSearchResult(undefined);
    setSearchPending(true);
    setSearchError("");
    try {
      const result = await convex.query(forumRefs.search, {
        query,
        categorySlug,
        resultType: "threads",
        pageSize: 12,
      });
      if (searchRequestId.current === requestId) {
        setSearchResult(result);
      }
    } catch (caught) {
      if (searchRequestId.current !== requestId) return;
      reportAppError(caught, {
        scope: "forum",
        eventType: "category_search_failed",
        component: "ForumThreadList",
        action: "forum:search",
        metadata: { categorySlug },
        notify: false,
      });
      setSearchError(userFacingError(caught, "Could not search this board"));
    } finally {
      if (searchRequestId.current === requestId) {
        setSearchPending(false);
      }
    }
  }

  function clearBoardSearch() {
    searchRequestId.current += 1;
    setSearchQuery("");
    setSubmittedSearchQuery("");
    setSubmittedSearchScope("");
    setSearchResult(undefined);
    setSearchPending(false);
    setSearchError("");
  }

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
        kind: threadKind,
        ...(threadKind === "link" ? { sourceUrl: sourceUrl.trim() } : {}),
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
      setThreadKind("discussion");
      setSourceUrl("");
      setThreadTitle("");
      setThreadBody("");
      setThreadAttachments([]);
      setThreadPreviewOpen(false);
      setPollEnabled(false);
      setPollQuestion("");
      setPollOptions(["", ""]);
      if (result.status === "pending") {
        setBoardActionError(
          "Awaiting moderator review. Find and manage your submission in Account & preferences → Pending content.",
        );
        return true;
      }
      router.push(forumPath(categorySlug, result.threadSlug));
      return true;
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
    router.push(
      asRoute(`${forumPath(categorySlug)}${query ? `?${query}` : ""}`),
    );
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
    router.push(
      asRoute(`${forumPath(categorySlug)}${query ? `?${query}` : ""}`),
    );
  }

  function resetBoardView() {
    router.push(forumPath(categorySlug));
  }

  if (listResult === undefined) {
    return <ForumLoading label="Loading discussions" variant="threads" />;
  }

  const category = listResult.category;

  if (!category) {
    return (
      <ForumStatusBox
        title="Board unavailable"
        body="This board may have been removed or restricted. Browse the boards to find another discussion."
        accent="canary"
        action={
          <Button asChild className="rounded-full">
            <ForumLink href="/forum?view=boards">Back to boards</ForumLink>
          </Button>
        }
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
    if (composeOpen && isAuthenticated && viewerCanCreateThread) {
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

  const boardActions = (
    <div className="flex min-w-0 items-start gap-2">
      <Button
        className="min-h-11 rounded-full px-4 text-sm font-semibold"
        type="button"
        disabled={authLoading || pending}
        onClick={toggleThreadComposer}
      >
        <Plus className="size-4" aria-hidden="true" />
        {composeOpen && isAuthenticated && viewerCanCreateThread
          ? "Close thread form"
          : "New thread"}
      </Button>
      <details
        className="group relative"
        onKeyDown={handleForumDisclosureKeyDown}
      >
        <summary className="forum-action-pill focus-ring inline-flex min-h-11 cursor-pointer items-center gap-2 px-3 text-xs text-muted-foreground hover:text-foreground">
          Board tools <ChevronDown className="size-3.5" aria-hidden="true" />
        </summary>
        <div className="forum-inline-menu absolute right-0 z-20 mt-1 grid min-w-40 gap-1 rounded-xl bg-card p-2 shadow-lg">
          <Button
            className="forum-action-pill min-h-11 rounded-full px-4 text-xs"
            type="button"
            variant="ghost"
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
            className="forum-action-pill min-h-11 rounded-full px-4 text-xs"
            type="button"
            variant="outline"
            disabled={authLoading || markReadPending}
            onClick={markBoardRead}
          >
            {markReadPending ? "Marking..." : "Mark read"}
          </Button>
        </div>
      </details>
    </div>
  );

  return (
    <div className="space-y-5">
      {showHeading ? (
        <ForumPageHeader
          title={getCategoryTitle(category)}
          description={getCategoryDescription(category)}
          actions={boardActions}
          breadcrumbs={<ForumBreadcrumbs category={category} />}
          view="boards"
          nested
        />
      ) : (
        <div className="space-y-2">
          <ForumBreadcrumbs category={category} />
          <div className="forum-toolbar flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {formatForumCount(getCategoryThreadCount(category))} threads ·{" "}
              {formatForumCount(getCategoryPostCount(category))} posts
            </p>
            {boardActions}
          </div>
        </div>
      )}
      <ForumBodyGrid
        sidebar={
          <aside aria-label="Board information" className="min-w-0 space-y-5">
            <section className="forum-panel overflow-hidden !p-0">
              <ForumSectionHeader title="About this board" />
              <div className="space-y-4 p-4">
                <dl className="grid grid-cols-2 gap-4 font-mono text-xs text-muted-foreground">
                  <div>
                    <dt>Threads</dt>
                    <dd className="mt-1 text-lg tabular-nums text-foreground">
                      {formatForumCount(getCategoryThreadCount(category))}
                    </dd>
                  </div>
                  <div>
                    <dt>Posts</dt>
                    <dd className="mt-1 text-lg tabular-nums text-foreground">
                      {formatForumCount(getCategoryPostCount(category))}
                    </dd>
                  </div>
                </dl>
                {hasSubboards ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    Includes {category.children?.length ?? 0} sub-boards
                  </p>
                ) : null}
                <p className="text-xs leading-5 text-muted-foreground">
                  {viewerCanCreateThread
                    ? "You can start a discussion in this board."
                    : threadCreationMessage}
                </p>
                <ForumLink
                  className="focus-ring inline-flex min-h-11 items-center text-sm text-primary hover:underline"
                  href="/forum#forum-chat"
                >
                  Open the Lounge →
                </ForumLink>
              </div>
            </section>
            {listResult.rules ? (
              <section
                className="forum-panel overflow-hidden !p-0"
                aria-label="Board rules"
              >
                <ForumSectionHeader
                  title={listResult.rules.title || "Board rules"}
                />
                <div className="p-4 text-sm">
                  <ForumBody body={listResult.rules.body} />
                </div>
              </section>
            ) : null}
          </aside>
        }
      >
        <ForumSubboardSelector
          boards={category.children ?? []}
          parentTitle={getCategoryTitle(category)}
        />

        <section className="min-w-0" aria-label="Board discussions">
          <div className="flex items-center justify-between gap-3 py-1">
            <h2 className="text-sm font-semibold">Discussions</h2>
            <span className="text-[11px] text-muted-foreground">
              {listResult.pagination.totalItems}{" "}
              {listResult.pagination.totalItems === 1 ? "thread" : "threads"}
            </span>
          </div>
          <div className="min-w-0 space-y-3">
            <div className="forum-toolbar flex min-w-0 items-center gap-2 py-2">
              <form
                className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto]"
                onSubmit={submitBoardSearch}
                role="search"
              >
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Search this board</span>
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search this board"
                    className="min-h-11 rounded-l-full rounded-r-none border-0 bg-muted/45 text-base md:text-sm"
                    aria-label="Search this board"
                  />
                </label>
                <Button
                  className="min-h-11 rounded-l-none rounded-r-full border-0 bg-muted/45 text-xs"
                  type="submit"
                  aria-label="Submit board search"
                  variant="outline"
                  disabled={
                    (searchPending && submittedSearchScope === searchScope) ||
                    searchQuery.trim().length < 3
                  }
                >
                  {searchPending && submittedSearchScope === searchScope ? (
                    <span className="text-xs">…</span>
                  ) : (
                    <Search className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </form>
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
                    updateBoardListParam(
                      "order",
                      value,
                      DEFAULT_THREAD_SORT_ORDER,
                    )
                  }
                  prefixFilter={selectedPrefixFilter}
                  sortKey={selectedSortKey}
                  sortOrder={selectedSortOrder}
                  visibleThreadCount={currentPageThreads.length}
                />
              ) : null}
            </div>
            {boardFiltersActive ? (
              <div
                className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground"
                aria-label="Active board filters"
              >
                {selectedPrefixFilter !== PREFIX_FILTER_ALL ? (
                  <span className="rounded-full bg-muted/50 px-3 py-2">
                    {prefixFilterSummary}
                  </span>
                ) : null}
                {selectedDayFilter !== THREAD_DAY_FILTER_ALL ? (
                  <span className="rounded-full bg-muted/50 px-3 py-2">
                    {getThreadDayFilterLabel(selectedDayFilter)}
                  </span>
                ) : null}
                {selectedSortKey !== DEFAULT_THREAD_SORT_KEY ||
                selectedSortOrder !== DEFAULT_THREAD_SORT_ORDER ? (
                  <span className="rounded-full bg-muted/50 px-3 py-2">
                    {getThreadSortLabel(selectedSortKey)} ·{" "}
                    {getThreadSortOrderLabel(selectedSortOrder)}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 rounded-full px-3 text-xs"
                  onClick={resetBoardView}
                >
                  Clear filters
                </Button>
              </div>
            ) : null}
            {boardActionError ? (
              <p
                className="border border-row-border p-3 text-sm text-muted-foreground"
                role="alert"
              >
                {boardActionError}
              </p>
            ) : null}

            {composeOpen && isAuthenticated && viewerCanCreateThread ? (
              <ForumCompose
                title={threadTitle}
                draftKey={
                  viewer
                    ? `symbaiex:forum:draft:thread:${viewer._id}:${categorySlug}`
                    : undefined
                }
                draftData={{ kind: threadKind, sourceUrl }}
                onDraftDataChange={(data) => {
                  if (FORUM_POST_KINDS.some((kind) => kind === data.kind))
                    setThreadKind(data.kind as ForumPostKind);
                  setSourceUrl(data.sourceUrl ?? "");
                }}
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
                    className="rounded-none text-xs"
                    type="button"
                    variant="outline"
                    disabled={threadBody.trim().length === 0}
                    onClick={() => setThreadPreviewOpen((current) => !current)}
                  >
                    {threadPreviewOpen ? "Hide preview" : "Preview"}
                  </Button>
                }
                note="Mention @handle to notify a member. Your draft stays here if posting fails."
                onSubmit={submitThread}
              >
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">
                    What are you sharing?
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {FORUM_POST_KINDS.map((kind) => (
                      <button
                        type="button"
                        key={kind}
                        aria-pressed={!pollEnabled && threadKind === kind}
                        disabled={pending}
                        className={`forum-action-pill focus-ring min-h-11 px-3 text-sm ${!pollEnabled && threadKind === kind ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                        onClick={() => {
                          setThreadKind(kind);
                          setPollEnabled(false);
                        }}
                      >
                        {kind[0].toUpperCase() + kind.slice(1)}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-pressed={pollEnabled}
                      disabled={pending || !viewerCanCreatePoll}
                      className={`forum-action-pill focus-ring min-h-11 px-3 text-sm ${pollEnabled ? "text-primary" : "text-muted-foreground"}`}
                      onClick={() => {
                        setPollEnabled(true);
                        setThreadKind("discussion");
                      }}
                    >
                      Poll
                    </button>
                  </div>
                </fieldset>
                {threadKind === "link" ? (
                  <label className="block text-sm font-medium">
                    Source link
                    <input
                      type="url"
                      inputMode="url"
                      className="focus-ring mt-2 min-h-11 w-full rounded-xl bg-muted/50 px-3 text-base"
                      placeholder="https://"
                      value={sourceUrl}
                      disabled={pending}
                      onChange={(e) => setSourceUrl(e.target.value)}
                    />
                  </label>
                ) : null}
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

            {searchError && submittedSearchScope === searchScope ? (
              <ForumStatusBox title="Search unavailable" body={searchError} />
            ) : null}

            {submittedSearchScope === searchScope &&
            submittedSearchQuery.length >= 3 &&
            !searchError ? (
              <ForumSearchResults
                categorySlug={category.slug}
                query={submittedSearchQuery}
                searchResult={searchResult}
                pending={searchPending}
                onClear={clearBoardSearch}
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
                      className="min-h-11 rounded-none text-sm"
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
                    className="min-h-11 rounded-none text-sm"
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
                variant="grouped"
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
        {listResult.announcements.length > 0 ? (
          <details className="group rounded-xl bg-card px-4">
            <summary className="focus-ring flex min-h-11 cursor-pointer items-center justify-between text-xs text-muted-foreground">
              Board announcements{" "}
              <ChevronDown className="size-4" aria-hidden="true" />
            </summary>
            <ForumAnnouncementPanel announcements={listResult.announcements} />
          </details>
        ) : null}
      </ForumBodyGrid>

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
  if (boards.length === 0) return null;
  return (
    <nav
      aria-label={`${parentTitle} sub-boards`}
      className="forum-panel min-w-0 !p-0"
    >
      <details className="group" aria-label="Sub-board selector">
        <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 marker:content-none [&::-webkit-details-marker]:hidden">
          <MessageSquare
            className="size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {boards.length} {boards.length === 1 ? "sub-board" : "sub-boards"}
            </span>
            <span className="block truncate text-xs leading-5 text-muted-foreground">
              {boards.map(getCategoryTitle).join(", ")}
            </span>
          </span>
          <ChevronDown
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <ul className="px-2 sm:px-4">
          {boards.map((board) => {
            const latest = getCategoryLatestThread(board);
            return (
              <li key={board.slug}>
                <article className="forum-subboard-row grid min-w-0 grid-cols-[36px_minmax(0,1fr)] gap-x-3 py-3 sm:grid-cols-[36px_minmax(0,1fr)_180px]">
                  <span
                    role="img"
                    aria-label={
                      board.viewerUnread === undefined
                        ? "Sub-board"
                        : board.viewerUnread
                          ? "Unread board"
                          : "Read board"
                    }
                    className={`mt-2 flex size-9 items-center justify-center rounded-sm ${board.viewerUnread ? "bg-primary/10 text-primary" : "bg-muted/50 text-muted-foreground"}`}
                  >
                    <MessageSquare className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h3>
                      <ForumLink
                        className="focus-ring flex min-h-11 items-center text-[15px] font-semibold leading-5 hover:text-primary [overflow-wrap:anywhere]"
                        href={forumPath(board.slug)}
                        prefetch
                      >
                        {getCategoryTitle(board)}
                      </ForumLink>
                    </h3>
                    {getCategoryDescription(board) ? (
                      <p className="line-clamp-1 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                        {getCategoryDescription(board)}
                      </p>
                    ) : null}
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {forumItemCount(getCategoryThreadCount(board), "thread")}{" "}
                      · {forumItemCount(getCategoryPostCount(board), "post")}
                    </p>
                    {board.children?.length ? (
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                        {board.children.map((child) => (
                          <ForumLink
                            className="focus-ring inline-flex min-h-11 items-center text-muted-foreground hover:text-primary"
                            href={forumPath(child.slug)}
                            key={child.slug}
                          >
                            {getCategoryTitle(child)} →
                          </ForumLink>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {latest ? (
                    <div className="col-start-2 min-w-0 sm:col-start-auto sm:pt-2 sm:text-right">
                      <ForumLink
                        className="focus-ring flex min-h-11 items-center text-xs font-medium leading-5 hover:text-primary [overflow-wrap:anywhere] sm:justify-end"
                        href={getThreadLastPostHref(latest, board.slug)}
                      >
                        {latest.title}
                      </ForumLink>
                      <p className="text-[11px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                        {getThreadLastAuthor(latest)} ·{" "}
                        {formatForumDateTime(getThreadLastActivityAt(latest))}
                      </p>
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      </details>
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
      className="group relative shrink-0"
      onKeyDown={handleForumDisclosureKeyDown}
      aria-label="Board filter controls"
    >
      <summary className="forum-action-pill focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full px-3 py-2 text-xs text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="text-foreground">Filter</span>
        {filtersActive ? (
          <span
            className="size-1.5 rounded-full bg-primary"
            aria-label="Filters applied"
          />
        ) : null}
        <ChevronDown
          className="size-3.5 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="forum-inline-menu absolute right-0 top-full z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl bg-card p-3 shadow-lg">
        <p className="mb-2 text-xs leading-5 text-muted-foreground">
          {filterSummary} · {sortLabel} · {orderLabel} · {dayLabel}
        </p>
        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 px-1 py-2">
            <span>Prefix</span>
            <select
              aria-label="Filter board by thread prefix"
              className="focus-ring min-h-11 min-w-0 w-full rounded-xl border border-input bg-background px-3 text-base text-foreground md:text-sm"
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
          <label className="grid min-w-0 gap-1 px-1 py-2">
            <span>Sort by</span>
            <select
              aria-label="Sort board threads"
              className="focus-ring min-h-11 min-w-0 w-full rounded-xl border border-input bg-background px-3 text-base text-foreground md:text-sm"
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
          <label className="grid min-w-0 gap-1 px-1 py-2">
            <span>Order</span>
            <select
              aria-label="Set board thread sort order"
              className="focus-ring min-h-11 min-w-0 w-full rounded-xl border border-input bg-background px-3 text-base text-foreground md:text-sm"
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
          <label className="grid min-w-0 gap-1 px-1 py-2">
            <span>Date window</span>
            <select
              aria-label="Limit board threads by recent activity"
              className="focus-ring min-h-11 min-w-0 w-full rounded-xl border border-input bg-background px-3 text-base text-foreground md:text-sm"
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
        <p className="py-2 text-xs text-muted-foreground">
          Showing {visibleThreadCount} loaded{" "}
          {visibleThreadCount === 1 ? "thread" : "threads"}.
        </p>
      </div>
    </details>
  );
}

function ThreadPreviewPanel({ body }: { body: string }) {
  return (
    <div className="border border-row-border p-3">
      <p className="mb-3 text-xs text-muted-foreground">Preview</p>
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
      <span className="text-xs text-muted-foreground">Prefix</span>
      <select
        className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
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
    <fieldset className="rounded-xl bg-muted/30 p-3">
      <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
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
            <span className="text-xs text-muted-foreground">Question</span>
            <Input
              disabled={disabled}
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              placeholder="What should the board vote on?"
              className="rounded-none border-row-border"
            />
          </label>
          <div className="grid gap-2">
            <span className="text-xs text-muted-foreground">Options</span>
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
                    className="rounded-none text-xs"
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
                className="justify-self-start rounded-none text-xs"
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
  pending,
  onClear,
}: {
  categorySlug: string;
  query: string;
  searchResult: ForumSearchRecord | undefined;
  pending: boolean;
  onClear: () => void;
}) {
  if (pending || searchResult === undefined) {
    return <ForumLoading label={`Searching ${query}`} />;
  }

  const { threads, posts } = searchResult;

  if (threads.length === 0 && posts.length === 0) {
    return (
      <ForumStatusBox
        title="Search"
        body={`No visible matches for “${query}” in this board.`}
        action={
          <Button type="button" variant="outline" onClick={onClear}>
            Clear search
          </Button>
        }
      />
    );
  }

  return (
    <section className="space-y-7">
      <div className="py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Search</p>
          <Button
            className="min-h-11 rounded-none text-xs"
            onClick={onClear}
            type="button"
            variant="ghost"
          >
            Clear
          </Button>
        </div>
        <h2 className="mt-2 text-xl font-semibold">Matches for “{query}”</h2>
      </div>
      <div className="space-y-7">
        {threads.map((thread) => (
          <div key={`thread-${thread._id}`} className="py-2">
            <p className="text-xs text-muted-foreground">Thread</p>
            <ForumLink
              href={forumPath(categorySlug, thread.slug)}
              prefetch
              className="focus-ring mt-2 flex min-h-11 flex-wrap items-center gap-2 text-xl font-semibold leading-7 hover:text-primary"
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
          <div key={`post-${post._id}`} className="py-2">
            <p className="text-xs text-muted-foreground">Post</p>
            <ForumLink
              href={forumPostPath(
                categorySlug,
                post.threadSlug,
                post.postNumber,
                post.postPage,
              )}
              prefetch
              className="focus-ring mt-2 inline-flex min-h-11 items-center text-sm font-semibold hover:text-primary"
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
