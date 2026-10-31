"use client";

import { ForumPageHeader } from "./forum-layout-primitives";

import {
  forumPath,
  forumPostPath,
  forumRefs,
  formatForumDateTime,
  getCategoryTitle,
  type ForumCategoryRecord,
  type ForumSearchRecord,
} from "@/components/forum/forum-refs";
import {
  ForumLink,
  ForumLoading,
  ForumPaginationBar,
  ForumStatusBox,
  ForumThreadPrefixBadge,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConvex } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

const ALL_BOARDS = "all";
const ALL_RESULTS = "all";
const CATEGORY_SELECT_LIMIT = 200;
const DEFAULT_PAGE_SIZE = 12;
const SEARCH_PAGE_SIZES = [12, 24, 30] as const;
type ForumSearchResultType = "all" | "threads" | "replies";
type ForumSearchTarget = "all" | "titles" | "bodies";
type ForumSearchSortKey =
  "relevance" | "newest" | "oldest" | "replies" | "views";
const ALL_DATES = "all";
const SEARCH_TARGET_OPTIONS = [
  { value: "all", label: "Titles + bodies" },
  { value: "titles", label: "Titles only" },
  { value: "bodies", label: "Bodies only" },
] as const satisfies ReadonlyArray<{ value: ForumSearchTarget; label: string }>;
const SEARCH_SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "replies", label: "Replies" },
  { value: "views", label: "Views" },
] as const satisfies ReadonlyArray<{
  value: ForumSearchSortKey;
  label: string;
}>;
const SEARCH_DAY_OPTIONS = [
  { value: ALL_DATES, label: "Any date" },
  { value: "1", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last year" },
] as const;

export function ForumSearchPage({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Local forum disabled"
        body="Convex is not configured locally, so forum search cannot run."
        accent="cyan"
      />
    );
  }

  return <LiveForumSearchPage />;
}

function LiveForumSearchPage() {
  const router = useRouter();
  const convex = useConvex();
  const searchParams = useSearchParams();
  const submittedQuery = (searchParams.get("q") ?? "").trim();
  const submittedCategory = searchParams.get("board") ?? ALL_BOARDS;
  const submittedResultType = normalizeResultType(searchParams.get("type"));
  const submittedAuthor = (searchParams.get("author") ?? "").trim();
  const submittedTarget = normalizeSearchTarget(searchParams.get("target"));
  const submittedSortKey = normalizeSearchSortKey(searchParams.get("sort"));
  const submittedDays = normalizeSearchDays(searchParams.get("days"));
  const submittedPage = readPositiveInt(searchParams.get("page"), 1);
  const submittedThreadPage = readPositiveInt(
    searchParams.get("threadPage"),
    1,
  );
  const submittedReplyPage = readPositiveInt(searchParams.get("replyPage"), 1);
  const submittedPageSize = normalizePageSize(searchParams.get("size"));
  const canRunSearch =
    submittedQuery.length >= 2 ||
    (submittedQuery.length === 0 && submittedAuthor.length > 0);
  const [query, setQuery] = useState(submittedQuery);
  const [categorySlug, setCategorySlug] = useState(submittedCategory);
  const [resultType, setResultType] =
    useState<ForumSearchResultType>(submittedResultType);
  const [author, setAuthor] = useState(submittedAuthor);
  const [target, setTarget] = useState<ForumSearchTarget>(submittedTarget);
  const [sortKey, setSortKey] = useState<ForumSearchSortKey>(submittedSortKey);
  const [days, setDays] = useState(submittedDays);
  const [pageSize, setPageSize] = useState(String(submittedPageSize));
  const categories = useQuery(forumRefs.listCategoryOptions, {
    limit: CATEGORY_SELECT_LIMIT,
  });
  const searchArgs = useMemo(
    () =>
      canRunSearch
        ? {
            query: submittedQuery,
            ...(submittedCategory === ALL_BOARDS
              ? {}
              : { categorySlug: submittedCategory }),
            ...(submittedResultType === ALL_RESULTS
              ? {
                  threadPage: submittedThreadPage,
                  replyPage: submittedReplyPage,
                }
              : { page: submittedPage }),
            pageSize: submittedPageSize,
            resultType: submittedResultType,
            ...(submittedAuthor.length === 0
              ? {}
              : { author: submittedAuthor }),
            ...(submittedTarget === "all" ? {} : { target: submittedTarget }),
            ...(submittedSortKey === "relevance"
              ? {}
              : { sortKey: submittedSortKey }),
            ...(submittedDays === ALL_DATES
              ? {}
              : { days: Number(submittedDays) }),
          }
        : null,
    [
      canRunSearch,
      submittedAuthor,
      submittedCategory,
      submittedDays,
      submittedPage,
      submittedPageSize,
      submittedQuery,
      submittedReplyPage,
      submittedResultType,
      submittedSortKey,
      submittedTarget,
      submittedThreadPage,
    ],
  );
  const [searchResult, setSearchResult] = useState<
    ForumSearchRecord | undefined
  >(undefined);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRevision, setSearchRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (searchArgs === null) {
      setSearchResult(undefined);
      setSearchError(null);
      return;
    }

    setSearchResult(undefined);
    setSearchError(null);
    void convex.query(forumRefs.search, searchArgs).then(
      (result) => {
        if (!cancelled) setSearchResult(result);
      },
      () => {
        if (!cancelled) {
          setSearchError("Search could not be completed. Please try again.");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [convex, searchArgs, searchRevision]);
  const categoryMaps = useMemo(() => {
    const bySlug = new Map<string, ForumCategoryRecord>();
    const byId = new Map<string, ForumCategoryRecord>();
    for (const category of categories ?? []) {
      bySlug.set(category.slug, category);
      if (typeof category._id === "string") {
        byId.set(category._id, category);
      }
    }
    return { byId, bySlug };
  }, [categories]);
  const boardOptions = useMemo(
    () =>
      (categories ?? []).map((category) => ({
        slug: category.slug,
        label: boardOptionLabel(category, categoryMaps.byId),
      })),
    [categories, categoryMaps.byId],
  );
  const hasCustomFilters =
    query.trim().length > 0 ||
    categorySlug !== ALL_BOARDS ||
    resultType !== ALL_RESULTS ||
    author.trim().length > 0 ||
    target !== "all" ||
    sortKey !== "relevance" ||
    days !== ALL_DATES ||
    Number(pageSize) !== DEFAULT_PAGE_SIZE;

  useEffect(() => {
    setQuery(submittedQuery);
    setCategorySlug(submittedCategory);
    setResultType(submittedResultType);
    setAuthor(submittedAuthor);
    setTarget(submittedTarget);
    setSortKey(submittedSortKey);
    setDays(submittedDays);
    setPageSize(String(submittedPageSize));
  }, [
    submittedAuthor,
    submittedCategory,
    submittedDays,
    submittedPageSize,
    submittedQuery,
    submittedResultType,
    submittedSortKey,
    submittedTarget,
  ]);

  function resetSearchForm() {
    setQuery("");
    setCategorySlug(ALL_BOARDS);
    setResultType(ALL_RESULTS);
    setAuthor("");
    setTarget("all");
    setSortKey("relevance");
    setDays(ALL_DATES);
    setPageSize(String(DEFAULT_PAGE_SIZE));
    router.push("/forum/search");
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = query.trim();
    const params = new URLSearchParams();
    if (nextQuery.length > 0) {
      params.set("q", nextQuery);
    }
    if (categorySlug !== ALL_BOARDS) {
      params.set("board", categorySlug);
    }
    if (resultType !== ALL_RESULTS) {
      params.set("type", resultType);
    }
    const nextAuthor = author.trim();
    if (nextAuthor.length > 0) {
      params.set("author", nextAuthor);
    }
    if (target !== "all") {
      params.set("target", target);
    }
    if (sortKey !== "relevance") {
      params.set("sort", sortKey);
    }
    if (days !== ALL_DATES) {
      params.set("days", days);
    }
    const nextPageSize = Number(pageSize);
    if (nextPageSize !== DEFAULT_PAGE_SIZE) {
      params.set("size", String(nextPageSize));
    }
    if (
      query.trim() === submittedQuery &&
      categorySlug === submittedCategory &&
      resultType === submittedResultType &&
      author.trim() === submittedAuthor &&
      target === submittedTarget &&
      sortKey === submittedSortKey &&
      days === submittedDays &&
      Number(pageSize) === submittedPageSize &&
      submittedPage === 1 &&
      submittedThreadPage === 1 &&
      submittedReplyPage === 1
    ) {
      setSearchRevision((revision) => revision + 1);
      return;
    }
    router.push(
      params.size === 0 ? "/forum/search" : `/forum/search?${params}`,
    );
  }

  return (
    <div className="space-y-3">
      <section className="space-y-3">
        <ForumPageHeader
          title="Search the forum"
          description="Find a discussion, a reply, or a familiar voice."
        />
        <form
          className="forum-panel mt-4 space-y-4 p-4"
          onSubmit={submitSearch}
        >
          <div className="space-y-3">
            <label className="grid min-w-0 gap-2">
              <span className="text-xs text-muted-foreground">Keywords</span>
              <Input
                aria-describedby="forum-search-keywords-help"
                value={query}
                minLength={2}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search titles, bodies, and replies"
                className="rounded-xl border-row-border"
              />
            </label>
            <p
              id="forum-search-keywords-help"
              className="text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]"
            >
              {query.trim().length === 1
                ? "Add at least one more character, or clear Keywords and search by Author under Advanced filters."
                : "Use at least two characters, or leave Keywords blank and enter a member handle in Author under Advanced filters."}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid min-w-0 gap-2">
                <span className="text-xs text-muted-foreground">Board</span>
                <Select value={categorySlug} onValueChange={setCategorySlug}>
                  <SelectTrigger
                    aria-describedby="forum-search-board-help"
                    aria-label="Filter forum search by board"
                    className="rounded-xl border-row-border"
                  >
                    <SelectValue placeholder="All public boards" />
                  </SelectTrigger>
                  <SelectContent className="max-h-96 rounded-xl border-row-border">
                    <SelectItem value={ALL_BOARDS}>
                      All public boards
                    </SelectItem>
                    {categorySlug !== ALL_BOARDS &&
                    !boardOptions.some(
                      (board) => board.slug === categorySlug,
                    ) ? (
                      <SelectItem value={categorySlug}>
                        {boardLabel(categoryMaps.bySlug, categorySlug)}
                      </SelectItem>
                    ) : null}
                    {boardOptions.map((board) => (
                      <SelectItem key={board.slug} value={board.slug}>
                        {board.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid min-w-0 gap-2">
                <span className="text-xs text-muted-foreground">Type</span>
                <Select
                  value={resultType}
                  onValueChange={(value) =>
                    setResultType(normalizeResultType(value))
                  }
                >
                  <SelectTrigger
                    aria-label="Filter forum search by result type"
                    className="rounded-xl border-row-border"
                  >
                    <SelectValue placeholder="All results" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-row-border">
                    <SelectItem value="all">All results</SelectItem>
                    <SelectItem value="threads">Threads</SelectItem>
                    <SelectItem value="replies">Replies</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid min-w-0 gap-2">
                <span className="text-xs text-muted-foreground">Sort</span>
                <Select
                  value={sortKey}
                  onValueChange={(value) =>
                    setSortKey(normalizeSearchSortKey(value))
                  }
                >
                  <SelectTrigger
                    aria-label="Sort forum search results"
                    className="rounded-xl border-row-border"
                  >
                    <SelectValue placeholder="Relevance" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-row-border">
                    {SEARCH_SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </div>
          <details
            className="rounded-xl bg-muted/35 p-3"
            open={
              submittedAuthor.trim().length > 0 ||
              submittedTarget !== "all" ||
              submittedDays !== ALL_DATES ||
              submittedPageSize !== DEFAULT_PAGE_SIZE
            }
          >
            <summary className="focus-ring min-h-8 cursor-pointer text-sm font-medium">
              Advanced filters
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="grid min-w-0 gap-2">
                <span className="text-xs text-muted-foreground">Search in</span>
                <Select
                  value={target}
                  onValueChange={(value) =>
                    setTarget(normalizeSearchTarget(value))
                  }
                >
                  <SelectTrigger
                    aria-label="Choose forum search target"
                    className="rounded-xl border-row-border"
                  >
                    <SelectValue placeholder="Titles + bodies" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-row-border">
                    {SEARCH_TARGET_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid min-w-0 gap-2">
                <span className="text-xs text-muted-foreground">Date</span>
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger
                    aria-label="Filter forum search results by date"
                    className="rounded-xl border-row-border"
                  >
                    <SelectValue placeholder="Any date" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-row-border">
                    {SEARCH_DAY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid min-w-0 gap-2">
                <span className="text-xs text-muted-foreground">Page size</span>
                <Select value={pageSize} onValueChange={setPageSize}>
                  <SelectTrigger
                    aria-label="Set forum search page size"
                    className="rounded-xl border-row-border"
                  >
                    <SelectValue placeholder="12" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-row-border">
                    {SEARCH_PAGE_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid min-w-0 gap-2">
                <span className="text-xs text-muted-foreground">Author</span>
                <Input
                  aria-describedby="forum-search-author-help"
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                  placeholder="optional handle"
                  className="rounded-xl border-row-border"
                />
              </label>
            </div>
          </details>
          <div className="flex flex-col gap-2 pt-2.5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p
                className="text-xs text-muted-foreground"
                id="forum-search-board-help"
              >
                {categories === undefined
                  ? "Loading public boards."
                  : `Searching all ${boardOptions.length} public boards by default.`}
              </p>
              <p
                className="text-xs text-muted-foreground"
                id="forum-search-author-help"
              >
                Leave keywords blank to find every visible thread and reply by a
                member handle.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="rounded-xl [&&]:!min-h-11" type="submit">
                Search
              </Button>
              <Button
                className="rounded-xl [&&]:!min-h-11"
                disabled={!hasCustomFilters}
                onClick={resetSearchForm}
                type="button"
                variant="outline"
              >
                Reset
              </Button>
            </div>
          </div>
        </form>
      </section>
      <ForumSearchResults
        author={submittedAuthor}
        categoryLookup={categoryMaps.bySlug}
        pageSize={submittedPageSize}
        query={submittedQuery}
        result={searchResult}
        error={searchError}
        onRetry={() => setSearchRevision((revision) => revision + 1)}
        searchParams={searchParams}
      />
    </div>
  );
}

export function ForumSearchResults({
  author,
  categoryLookup,
  pageSize,
  query,
  result,
  error,
  onRetry,
  searchParams,
}: {
  author: string;
  categoryLookup: Map<string, ForumCategoryRecord>;
  pageSize: number;
  query: string;
  result: ForumSearchRecord | undefined;
  error: string | null;
  onRetry: () => void;
  searchParams: { toString(): string };
}) {
  const authorLabel = author.trim();
  if (query.length === 0 && authorLabel.length === 0) {
    return (
      <ForumStatusBox
        title="Search"
        body="Enter at least two characters or a member handle to search public thread titles, reply bodies, and author activity."
      />
    );
  }

  if (query.length > 0 && query.length < 2) {
    return (
      <ForumStatusBox
        title="Search"
        body="Search terms need at least two characters."
      />
    );
  }

  if (result === undefined) {
    if (error !== null) {
      return (
        <ForumStatusBox
          title="Search unavailable"
          body={error}
          action={
            <Button
              type="button"
              className="forum-action-pill"
              onClick={onRetry}
            >
              Retry search
            </Button>
          }
        />
      );
    }
    return (
      <ForumLoading
        label={`Searching ${searchResultLabel(query, authorLabel)}`}
      />
    );
  }

  if (result.threads.length === 0 && result.posts.length === 0) {
    return (
      <ForumStatusBox
        title="Search"
        body={`No public matches for ${searchResultLabel(query, result.filters.author ?? authorLabel)}.`}
      />
    );
  }

  const showThreads = result.filters.resultType !== "replies";
  const showPosts = result.filters.resultType !== "threads";

  return (
    <div className="space-y-3">
      {result.limited ? (
        <ForumStatusBox
          title="Search limited"
          body="The search scan reached its safety limit after visibility filtering. Narrow the board, author, or search text for a more complete result set."
          accent="cyan"
        />
      ) : null}
      {showThreads ? (
        <SearchResultSection
          buildHref={(page) =>
            searchPageHref(
              searchParams,
              page,
              pageSize,
              searchPageParam(result, "thread"),
            )
          }
          emptyLabel="No matching threads."
          heading={searchSectionHeading("Thread", query, result.filters.author)}
          label="Thread results"
          pagination={result.threadPagination}
        >
          {result.threads.map((thread) => (
            <SearchRow
              href={forumPath(thread.categorySlug, thread.slug)}
              key={`thread-${thread.threadId ?? thread._id}`}
              label={`Thread / ${boardLabel(categoryLookup, thread.categorySlug)}`}
              thread={thread}
              title={thread.title}
              excerpt={thread.excerpt}
            />
          ))}
        </SearchResultSection>
      ) : null}
      {showPosts ? (
        <SearchResultSection
          buildHref={(page) =>
            searchPageHref(
              searchParams,
              page,
              pageSize,
              searchPageParam(result, "reply"),
            )
          }
          emptyLabel="No matching replies."
          heading={searchSectionHeading("Reply", query, result.filters.author)}
          label="Reply results"
          pagination={result.postPagination}
        >
          {result.posts.map((post) => (
            <SearchRow
              href={forumPostPath(
                post.categorySlug,
                post.threadSlug,
                post.postNumber,
                post.postPage,
              )}
              key={`post-${post.postId ?? post._id}`}
              label={`Reply / ${boardLabel(categoryLookup, post.categorySlug)}`}
              thread={post}
              title={post.threadTitle ?? "Forum reply"}
              excerpt={post.excerpt ?? post.body}
            />
          ))}
        </SearchResultSection>
      ) : null}
    </div>
  );
}

function SearchResultSection({
  buildHref,
  children,
  emptyLabel,
  heading,
  label,
  pagination,
}: {
  buildHref: (page: number) => string;
  children: ReactNode;
  emptyLabel: string;
  heading: string;
  label: string;
  pagination: ForumSearchRecord["pagination"];
}) {
  const hasResults = pagination.totalItems > 0;
  return (
    <section className="forum-panel min-w-0">
      <div className="px-3 py-2 text-xs text-muted-foreground">{heading}</div>
      {hasResults ? (
        <>
          <div className="space-y-1">{children}</div>
          <ForumPaginationBar
            buildHref={buildHref}
            className="border-x-0 border-b-0"
            label={label}
            pagination={pagination}
          />
        </>
      ) : (
        <p className="px-3 py-3 text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </section>
  );
}

function SearchRow({
  excerpt,
  href,
  label,
  thread,
  title,
}: {
  excerpt?: string;
  href: string;
  label: string;
  thread:
    ForumSearchRecord["threads"][number] | ForumSearchRecord["posts"][number];
  title: string;
}) {
  return (
    <article className="px-3 py-2.5 rounded-xl hover:bg-muted/45">
      <p className="text-xs text-muted-foreground">{label}</p>
      <ForumLink
        href={href}
        prefetch
        className="focus-ring mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold hover:text-primary"
      >
        <ForumThreadPrefixBadge thread={thread} />
        {title}
      </ForumLink>
      {excerpt ? (
        <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
          {excerpt}
        </p>
      ) : null}
      <p className="mt-1.5 text-xs text-muted-foreground">
        {searchHitMetadata(thread)}
      </p>
    </article>
  );
}

function searchHitMetadata(
  hit:
    ForumSearchRecord["threads"][number] | ForumSearchRecord["posts"][number],
) {
  if (isSearchPostHit(hit)) {
    const postNumber =
      typeof hit.postNumber === "number" ? ` / #${hit.postNumber}` : "";
    return [
      `By ${hit.author}`,
      `Posted ${formatForumDateTime(hit.createdAt)}`,
      `${hit.threadReplyCount ?? 0} replies`,
      `${hit.threadViewCount ?? 0} views${postNumber}`,
    ].join(" / ");
  }

  return [
    `By ${hit.author}`,
    `Started ${formatForumDateTime(hit.createdAt)}`,
    `Last post ${formatForumDateTime(hit.lastPostAt)}`,
    `${hit.replyCount ?? 0} replies`,
    `${hit.viewCount ?? 0} views`,
  ].join(" / ");
}

function isSearchPostHit(
  hit:
    ForumSearchRecord["threads"][number] | ForumSearchRecord["posts"][number],
): hit is ForumSearchRecord["posts"][number] {
  return "threadSlug" in hit;
}

function boardLabel(
  categoryLookup: Map<string, ForumCategoryRecord>,
  categorySlug?: string,
) {
  if (!categorySlug) {
    return "Forum";
  }
  return getCategoryTitle(
    categoryLookup.get(categorySlug) ?? { slug: categorySlug },
  );
}

function searchResultLabel(query: string, author: string | null) {
  const cleanedQuery = query.trim();
  if (cleanedQuery.length > 0) {
    return `"${cleanedQuery}"`;
  }
  const cleanedAuthor = author?.trim().replace(/^@/, "");
  return cleanedAuthor ? `@${cleanedAuthor}` : "the forum";
}

function searchSectionHeading(
  section: "Thread" | "Reply",
  query: string,
  author: string | null,
) {
  const cleanedQuery = query.trim();
  if (cleanedQuery.length > 0) {
    return `${section} matches for ${cleanedQuery}`;
  }
  const cleanedAuthor = author?.trim().replace(/^@/, "");
  return cleanedAuthor
    ? `${section}s by @${cleanedAuthor}`
    : `${section} matches`;
}

function normalizeResultType(value: string | null): ForumSearchResultType {
  return value === "threads" || value === "replies" ? value : "all";
}

function normalizeSearchTarget(value: string | null): ForumSearchTarget {
  return value === "titles" || value === "bodies" ? value : "all";
}

function normalizeSearchSortKey(value: string | null): ForumSearchSortKey {
  return value === "newest" ||
    value === "oldest" ||
    value === "replies" ||
    value === "views"
    ? value
    : "relevance";
}

function normalizeSearchDays(value: string | null) {
  return SEARCH_DAY_OPTIONS.some((option) => option.value === value)
    ? (value ?? ALL_DATES)
    : ALL_DATES;
}

function readPositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizePageSize(value: string | null) {
  const parsed = readPositiveInt(value, DEFAULT_PAGE_SIZE);
  return SEARCH_PAGE_SIZES.includes(
    parsed as (typeof SEARCH_PAGE_SIZES)[number],
  )
    ? parsed
    : DEFAULT_PAGE_SIZE;
}

function searchPageHref(
  searchParams: { toString(): string },
  page: number,
  pageSize: number,
  pageParam = "page",
) {
  const params = new URLSearchParams(searchParams.toString());
  if (page > 1) {
    params.set(pageParam, String(page));
  } else {
    params.delete(pageParam);
  }
  if (pageSize !== DEFAULT_PAGE_SIZE) {
    params.set("size", String(pageSize));
  } else {
    params.delete("size");
  }
  return params.size === 0 ? "/forum/search" : `/forum/search?${params}`;
}

function searchPageParam(
  result: ForumSearchRecord,
  section: "thread" | "reply",
) {
  if (
    result.filters.resultType === "threads" ||
    result.filters.resultType === "replies"
  ) {
    return "page";
  }
  return section === "thread" ? "threadPage" : "replyPage";
}

function boardOptionLabel(
  category: ForumCategoryRecord,
  categoriesById: Map<string, ForumCategoryRecord>,
) {
  const titles = [getCategoryTitle(category)];
  let parentCategoryId = category.parentCategoryId;

  for (
    let depth = 0;
    depth < 10 && typeof parentCategoryId === "string";
    depth += 1
  ) {
    const parent = categoriesById.get(parentCategoryId);
    if (!parent) {
      break;
    }
    titles.unshift(getCategoryTitle(parent));
    parentCategoryId = parent.parentCategoryId;
  }

  return titles.join(" / ");
}
