"use client";

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
import { cn } from "@/lib/utils";
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
    <section className="overflow-hidden border-y border-row-border">
      <div className="border-b border-row-border px-3 py-2">
        <p className="page-kicker">Community directory</p>
        <h1 className="mt-1 text-xl font-semibold leading-tight md:text-2xl">
          Members
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
          Find members, activity, and forum profiles.
        </p>
      </div>
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
        router.push(href, { scroll: false });
      } else {
        router.replace(href, { scroll: false });
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
      <div className="border-b border-row-border bg-muted/10 px-3 py-2">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_9rem] lg:items-end">
          <label className="grid gap-1.5 sm:col-span-2 lg:col-span-1">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              Search members
            </span>
            <input
              autoComplete="off"
              className="focus-ring h-10 rounded-none border border-row-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/70"
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
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              Sort by
            </span>
            <select
              className="focus-ring h-10 rounded-none border border-row-border bg-background px-3 font-mono text-xs uppercase outline-none"
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
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              Per page
            </span>
            <select
              className="focus-ring h-10 rounded-none border border-row-border bg-background px-3 font-mono text-xs uppercase outline-none"
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
          <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
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
          <div className="divide-y divide-row-border lg:hidden">
            {visibleMembers.map((member) => (
              <article key={member._id} className="px-3 py-2.5 odd:bg-muted/15">
                <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2.5">
                  <ForumAvatar
                    alt={`${member.displayName} avatar`}
                    className="size-10"
                    name={member.displayName}
                    src={member.avatarUrl}
                  />
                  <div className="min-w-0">
                    <ForumLink
                      href={forumMemberProfilePath(member.username)}
                      prefetch
                      className="focus-ring inline-flex min-h-10 items-center text-base font-semibold leading-tight hover:text-primary"
                    >
                      {member.displayName}
                    </ForumLink>
                    <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                      /members/{member.username}
                    </p>
                    {member.customTitle ? (
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {member.customTitle}
                      </p>
                    ) : null}
                    {member.location ? (
                      <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                        {member.location}
                      </p>
                    ) : null}
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-px border-y border-row-border bg-row-border">
                  <MemberMetric className="col-span-2" label="Rank">
                    {member.rank}
                  </MemberMetric>
                  <MemberMetric label="Status">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={
                          member.isOnline
                            ? "size-2 bg-primary"
                            : "size-2 border border-row-border"
                        }
                      />
                      {member.isOnline ? "Online" : "Offline"}
                    </span>
                  </MemberMetric>
                  <MemberMetric label="Threads">
                    {formatForumCount(member.threadCount)}
                  </MemberMetric>
                  <MemberMetric label="Posts">
                    {formatForumCount(member.postCount)}
                  </MemberMetric>
                  <MemberMetric label="Reputation">
                    {formatForumReputation(member.reputationScore)}
                  </MemberMetric>
                  <MemberMetric className="col-span-3" label="Joined">
                    {formatForumDateTime(member.joinedAt)}
                    {member.isOnline && member.onlineLocation ? (
                      <span className="mt-1 block truncate font-mono text-[10px] uppercase text-muted-foreground">
                        Viewing {member.onlineLocation.label}
                      </span>
                    ) : null}
                  </MemberMetric>
                </dl>
              </article>
            ))}
          </div>
          <table className="hidden w-full table-fixed border-collapse lg:table">
            <caption className="sr-only">Forum members</caption>
            <thead>
              <tr className="border-b border-row-border font-mono text-[10px] uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left font-normal" scope="col">
                  Member
                </th>
                <th
                  className="w-36 px-3 py-2 text-left font-normal"
                  scope="col"
                >
                  Rank
                </th>
                <th
                  className="w-36 px-3 py-2 text-left font-normal"
                  scope="col"
                >
                  Status
                </th>
                <th
                  className="w-28 px-3 py-2 text-left font-normal"
                  scope="col"
                >
                  Threads
                </th>
                <th
                  className="w-28 px-3 py-2 text-left font-normal"
                  scope="col"
                >
                  Posts
                </th>
                <th
                  className="w-32 px-3 py-2 text-left font-normal"
                  scope="col"
                >
                  Reputation
                </th>
                <th
                  className="w-48 px-3 py-2 text-left font-normal"
                  scope="col"
                >
                  Joined
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-row-border">
              {visibleMembers.map((member) => (
                <tr className="odd:bg-muted/15" key={member._id}>
                  <th
                    className="px-3 py-2.5 text-left align-middle font-normal"
                    scope="row"
                  >
                    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2.5">
                      <ForumAvatar
                        alt={`${member.displayName} avatar`}
                        className="size-10"
                        name={member.displayName}
                        src={member.avatarUrl}
                      />
                      <div className="min-w-0">
                        <ForumLink
                          href={forumMemberProfilePath(member.username)}
                          prefetch
                          className="focus-ring text-base font-semibold leading-tight hover:text-primary"
                        >
                          {member.displayName}
                        </ForumLink>
                        <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                          /members/{member.username}
                        </p>
                        {member.customTitle ? (
                          <p className="mt-1 text-sm leading-5 text-muted-foreground">
                            {member.customTitle}
                          </p>
                        ) : null}
                        {member.location ? (
                          <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                            {member.location}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </th>
                  <td className="px-3 py-2.5 align-middle">
                    <p className="text-sm font-medium">{member.rank}</p>
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={
                          member.isOnline
                            ? "size-2 border border-primary bg-primary"
                            : "size-2 border border-row-border"
                        }
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {member.isOnline ? "Online" : "Offline"}
                        </p>
                        {member.isOnline && member.onlineLocation ? (
                          <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
                            {member.onlineLocation.label}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <p className="text-sm font-medium">
                      {formatForumCount(member.threadCount)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <p className="text-sm font-medium">
                      {formatForumCount(member.postCount)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <p className="text-sm font-medium">
                      {formatForumReputation(member.reputationScore)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <p className="text-sm font-medium">
                      {formatForumDateTime(member.joinedAt)}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-row-border px-3 py-2">
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
    <div className="mt-3 flex flex-col gap-2 font-mono text-[10px] uppercase text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
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
        "focus-ring min-h-10 min-w-10 border border-row-border bg-background px-2 text-foreground outline-none " +
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

function MemberMetric({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div className={cn("min-w-0 bg-background px-2 py-2", className)}>
      <dt className="font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-medium">{children}</dd>
    </div>
  );
}
