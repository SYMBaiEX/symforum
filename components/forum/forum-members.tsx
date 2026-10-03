"use client";

import { ForumPageHeader } from "./forum-layout-primitives";

import { asRoute } from "@/lib/typed-route";

import {
  formatForumCount,
  formatForumDateTime,
  forumMemberProfilePath,
  forumRefs,
  type ForumMemberSortKey,
} from "@/components/forum/forum-refs";
import {
  ForumAvatar,
  ForumLink,
  ForumLoading,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const MEMBER_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
type ForumMemberPageSize = (typeof MEMBER_PAGE_SIZE_OPTIONS)[number];
const DEFAULT_MEMBER_PAGE_SIZE: ForumMemberPageSize = 25;
const DEFAULT_MEMBER_SORT_KEY: ForumMemberSortKey = "posts-desc";
const MEMBER_SORT_OPTIONS = [
  { value: "posts-desc", label: "Posts" },
  { value: "threads-desc", label: "Threads" },
  { value: "reputation-desc", label: "Reputation" },
  { value: "joined-desc", label: "Newest" },
  { value: "joined-asc", label: "Oldest" },
  { value: "name-asc", label: "Name" },
  { value: "online-desc", label: "Online" },
] as const satisfies Array<{ value: ForumMemberSortKey; label: string }>;

export function ForumMembers({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Local forum disabled"
        body="Convex is not configured locally, so the member directory cannot load."
        accent="cyan"
      />
    );
  }

  return <LiveForumMembers />;
}

function LiveForumMembers() {
  return (
    <section className="forum-workspace space-y-4">
      <ForumPageHeader
        title="Members"
        description="The people behind the conversations. Find a member or explore their recent activity."
      />
      <ForumMemberTable />
    </section>
  );
}

function ForumMemberTable() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const sortKey = parseMemberSortKey(searchParams.get("sort"));
  const pageSize = parseMemberPageSize(searchParams.get("perPage"));
  const page = parseMemberPage(searchParams.get("page"));
  const [draftQuery, setDraftQuery] = useState(query);
  const updateMemberParams = useCallback(
    (
      patch: {
        page?: number;
        pageSize?: ForumMemberPageSize;
        query?: string;
        sortKey?: ForumMemberSortKey;
      },
      mode: "push" | "replace" = "replace",
    ) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      const nextQuery = patch.query ?? query;
      const nextSortKey = patch.sortKey ?? sortKey;
      const nextPageSize = patch.pageSize ?? pageSize;
      const nextPage = patch.page ?? page;

      setOptionalMemberParam(nextParams, "q", nextQuery.trim());
      setDefaultedMemberParam(
        nextParams,
        "sort",
        nextSortKey,
        DEFAULT_MEMBER_SORT_KEY,
      );
      setDefaultedMemberParam(
        nextParams,
        "perPage",
        String(nextPageSize),
        String(DEFAULT_MEMBER_PAGE_SIZE),
      );
      setDefaultedMemberParam(nextParams, "page", String(nextPage), "1");

      const queryString = nextParams.toString();
      const href = queryString ? `${pathname}?${queryString}` : pathname;
      if (mode === "push") {
        router.push(asRoute(href), { scroll: false });
      } else {
        router.replace(asRoute(href), { scroll: false });
      }
    },
    [page, pageSize, pathname, query, router, searchParams, sortKey],
  );
  const memberQueryArgs = useMemo(
    () => ({
      page,
      pageSize,
      query: query.trim() || undefined,
      sortKey,
    }),
    [page, pageSize, query, sortKey],
  );
  const result = useQuery(forumRefs.listMembers, memberQueryArgs);
  const visibleMembers = result?.members ?? [];
  const currentPage = result?.pagination.page ?? page;
  const pageCount = result?.pagination.totalPages ?? 1;
  const startItem = result?.pagination.startItem ?? 0;
  const endItem = result?.pagination.endItem ?? 0;
  const matchedCount = result?.pagination.totalItems ?? 0;

  useEffect(() => {
    setDraftQuery(query);
  }, [query]);

  useEffect(() => {
    if (result !== undefined && result.pagination.page !== page) {
      updateMemberParams({ page: result.pagination.page });
    }
  }, [page, result, updateMemberParams]);

  return (
    <div>
      <div className="forum-panel mb-3 p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_9rem] lg:items-end">
          <label className="grid gap-1.5 sm:col-span-2 lg:col-span-1">
            <span className="text-xs text-muted-foreground">
              Search members
            </span>
            <input
              autoComplete="off"
              className="focus-ring h-10 rounded-xl border border-row-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/70"
              onChange={(event) => {
                const nextQuery = event.target.value;
                setDraftQuery(nextQuery);
                updateMemberParams({ page: 1, query: nextQuery });
              }}
              placeholder="Name, handle, rank"
              type="search"
              value={draftQuery}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Sort by</span>
            <select
              className="focus-ring h-10 rounded-xl border border-row-border bg-background px-3 text-xs outline-none"
              onChange={(event) => {
                updateMemberParams({
                  page: 1,
                  sortKey: event.target.value as ForumMemberSortKey,
                });
              }}
              value={sortKey}
            >
              {MEMBER_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Per page</span>
            <select
              className="focus-ring h-10 rounded-xl border border-row-border bg-background px-3 text-xs outline-none"
              onChange={(event) => {
                updateMemberParams({
                  page: 1,
                  pageSize: Number(event.target.value) as ForumMemberPageSize,
                });
              }}
              value={pageSize}
            >
              {MEMBER_PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ForumMemberPager
          currentPage={currentPage}
          endItem={endItem}
          matchedCount={matchedCount}
          onPageChange={(nextPage) =>
            updateMemberParams({ page: nextPage }, "push")
          }
          pageCount={pageCount}
          startItem={startItem}
        />
        {result?.limited ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Directory scan limited. Narrow the search to inspect older matching
            members.
          </p>
        ) : null}
      </div>
      {result === undefined ? (
        <div className="p-3">
          <ForumLoading label="Syncing members" />
        </div>
      ) : null}
      {result !== undefined && visibleMembers.length === 0 ? (
        <div className="p-3">
          <ForumStatusBox
            title={query.trim() ? "No matches" : "Members"}
            body={
              query.trim()
                ? "No forum members match the current search and sort controls."
                : "No forum profiles have posted yet. Members appear here after forum activity or profile setup."
            }
          />
        </div>
      ) : null}
      {visibleMembers.length > 0 ? (
        <>
          <div className="forum-panel overflow-hidden">
            {visibleMembers.map((member) => (
              <article key={member._id} className="forum-list-row p-4">
                <div className="flex items-start gap-3">
                  <ForumAvatar
                    alt={`${member.displayName} avatar`}
                    className="size-11 shrink-0"
                    name={member.displayName}
                    src={member.avatarUrl}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <ForumLink
                        href={forumMemberProfilePath(member.username)}
                        prefetch
                        className="focus-ring text-sm font-semibold leading-6 hover:text-primary"
                      >
                        {member.displayName}
                      </ForumLink>
                      <span className="text-xs text-muted-foreground">
                        @{member.username}
                      </span>
                      {member.isOnline ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan/10 px-2 py-0.5 text-[11px] text-foreground">
                          <span
                            className="size-1.5 rounded-full bg-cyan"
                            aria-hidden="true"
                          />
                          Online
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          Offline
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {member.rank}
                      {member.customTitle ? ` · ${member.customTitle}` : ""}
                      {member.location ? ` · ${member.location}` : ""}
                    </p>
                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <div className="flex gap-1">
                        <dt className="order-2">posts</dt>
                        <dd className="order-1 font-semibold tabular-nums text-foreground">
                          {formatForumCount(member.postCount)}
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt className="order-2">threads</dt>
                        <dd className="order-1 font-semibold tabular-nums text-foreground">
                          {formatForumCount(member.threadCount)}
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt className="order-2">reputation</dt>
                        <dd className="order-1 font-semibold tabular-nums text-foreground">
                          {formatForumReputation(member.reputationScore)}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Joined {formatForumDateTime(member.joinedAt)}
                      {member.isOnline && member.onlineLocation
                        ? ` · ${member.onlineLocation.label}`
                        : ""}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="px-3 py-2">
            <ForumMemberPager
              currentPage={currentPage}
              endItem={endItem}
              matchedCount={matchedCount}
              onPageChange={(nextPage) =>
                updateMemberParams({ page: nextPage }, "push")
              }
              pageCount={pageCount}
              startItem={startItem}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function parseMemberSortKey(value: string | null): ForumMemberSortKey {
  return MEMBER_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as ForumMemberSortKey)
    : DEFAULT_MEMBER_SORT_KEY;
}

function parseMemberPageSize(value: string | null): ForumMemberPageSize {
  const size = Number(value);
  return MEMBER_PAGE_SIZE_OPTIONS.includes(size as ForumMemberPageSize)
    ? (size as ForumMemberPageSize)
    : DEFAULT_MEMBER_PAGE_SIZE;
}

function parseMemberPage(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function setOptionalMemberParam(
  params: URLSearchParams,
  key: string,
  value: string,
) {
  if (value.length > 0) {
    params.set(key, value);
  } else {
    params.delete(key);
  }
}

function setDefaultedMemberParam(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue: string,
) {
  if (value === defaultValue) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
}

function formatForumReputation(value: number) {
  return `${value > 0 ? "+" : ""}${formatForumCount(value)}`;
}

function ForumMemberPager({
  currentPage,
  endItem,
  matchedCount,
  onPageChange,
  pageCount,
  startItem,
}: {
  currentPage: number;
  endItem: number;
  matchedCount: number;
  onPageChange: (page: number) => void;
  pageCount: number;
  startItem: number;
}) {
  const pages = visibleMemberPages(currentPage, pageCount);
  return (
    <div className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p>
        Showing {startItem}-{endItem} of {matchedCount} matched
      </p>
      <div className="grid grid-cols-5 gap-1 sm:flex sm:flex-wrap sm:items-center">
        <ForumMemberPagerButton
          disabled={currentPage === 1}
          onClick={() => onPageChange(1)}
        >
          First
        </ForumMemberPagerButton>
        <ForumMemberPagerButton
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Prev
        </ForumMemberPagerButton>
        {pages.map((pagerPage) => (
          <ForumMemberPagerButton
            ariaCurrent={pagerPage === currentPage}
            disabled={pagerPage === currentPage}
            key={pagerPage}
            onClick={() => onPageChange(pagerPage)}
          >
            {pagerPage}
          </ForumMemberPagerButton>
        ))}
        <ForumMemberPagerButton
          disabled={currentPage === pageCount}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </ForumMemberPagerButton>
        <ForumMemberPagerButton
          disabled={currentPage === pageCount}
          onClick={() => onPageChange(pageCount)}
        >
          Last
        </ForumMemberPagerButton>
      </div>
    </div>
  );
}

function ForumMemberPagerButton({
  ariaCurrent = false,
  children,
  disabled,
  onClick,
}: {
  ariaCurrent?: boolean;
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={ariaCurrent ? "page" : undefined}
      className={
        "forum-action-pill focus-ring min-h-10 min-w-10 bg-card px-2 text-foreground outline-none " +
        "transition-colors duration-100 ease-out hover:border-primary hover:text-primary active:bg-muted/40 " +
        "disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:border-row-border " +
        (ariaCurrent ? "border-primary text-primary " : "")
      }
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function visibleMemberPages(currentPage: number, pageCount: number) {
  const pages = new Set([
    1,
    pageCount,
    currentPage - 1,
    currentPage,
    currentPage + 1,
  ]);
  return Array.from(pages)
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((left, right) => left - right);
}
