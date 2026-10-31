"use client";

import { ForumPageHeader } from "./forum-layout-primitives";

import {
  formatForumCount,
  formatForumDateTime,
  forumRefs,
  type ForumRecentThreadMode,
  type ForumRecentThreadsRecord,
  type ForumThreadSummaryRecord,
} from "@/components/forum/forum-refs";
import {
  ForumLoading,
  ForumPaginationBar,
  ForumStatusBox,
  ForumThreadTable,
} from "@/components/forum/forum-primitives";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

const RECENT_THREADS_PAGE_SIZE = 25;
const EMPTY_THREADS: ForumThreadSummaryRecord[] = [];

export function ForumRecentThreadsPage({
  description,
  enabled,
  mode,
  title,
}: {
  description: string;
  enabled: boolean;
  mode: ForumRecentThreadMode;
  title: string;
}) {
  return (
    <div className="space-y-2.5">
      <ForumRecentThreadsHeader
        description={description}
        mode={mode}
        title={title}
      />
      {enabled ? (
        <LiveForumRecentThreadsPage mode={mode} />
      ) : (
        <ForumStatusBox
          title="Local forum disabled"
          body={`${title} cannot load in this environment because Convex is not configured locally.`}
          accent="cyan"
        />
      )}
    </div>
  );
}

function LiveForumRecentThreadsPage({ mode }: { mode: ForumRecentThreadMode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The backend uses only the UTC day; retain the existing mount-time window.
  const [queryNow] = useState(
    () => Math.floor(Date.now() / 86_400_000) * 86_400_000,
  );
  const page = parsePage(searchParams.get("page"));
  const recentThreads = useQuery(forumRefs.listRecentThreads, {
    mode,
    now: queryNow,
    page,
    pageSize: RECENT_THREADS_PAGE_SIZE,
  });

  const buildPageHref = (nextPage: number) =>
    buildRecentThreadsPageHref(pathname, searchParams, nextPage);

  if (recentThreads === undefined) {
    return (
      <ForumLoading
        label={mode === "new" ? "Checking new posts" : "Checking today's posts"}
        variant="index"
      />
    );
  }

  return (
    <ForumRecentThreadsResults
      buildPageHref={buildPageHref}
      mode={mode}
      recentThreads={recentThreads}
    />
  );
}

function ForumRecentThreadsHeader({
  description,
  mode,
  title,
}: {
  description: string;
  mode: ForumRecentThreadMode;
  title: string;
}) {
  return (
    <ForumPageHeader
      title={title}
      description={description}
      actions={
        <span className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          {mode === "new" ? "Unread activity" : "Daily activity"}
        </span>
      }
    />
  );
}

function ForumRecentThreadsResults({
  buildPageHref,
  mode,
  recentThreads,
}: {
  buildPageHref: (page: number) => string;
  mode: ForumRecentThreadMode;
  recentThreads: ForumRecentThreadsRecord;
}) {
  const threads = recentThreads.threads ?? EMPTY_THREADS;
  const hasThreads = threads.length > 0;

  return (
    <div className="space-y-2.5">
      <ForumRecentActivitySummary recentThreads={recentThreads} />

      {recentThreads.limited ? (
        <ForumStatusBox
          title="Newest results shown"
          body="The backend capped this recent-activity result set, so pagination is limited to the newest matching threads."
          accent="canary"
        />
      ) : null}

      {hasThreads ? (
        <ForumThreadTable
          category={null}
          density="compact"
          showFooter={false}
          threads={threads}
        />
      ) : (
        <ForumStatusBox
          title={mode === "new" ? "No new posts" : "No posts today"}
          body={
            mode === "new"
              ? "There are no unread or newly active public threads to show right now."
              : "No public threads have been active today."
          }
        />
      )}

      {recentThreads.pagination.totalPages > 1 ? (
        <ForumPaginationBar
          buildHref={buildPageHref}
          label="Threads"
          pagination={recentThreads.pagination}
        />
      ) : null}
    </div>
  );
}

function ForumRecentActivitySummary({
  recentThreads,
}: {
  recentThreads: ForumRecentThreadsRecord;
}) {
  const matching =
    recentThreads.pagination.actualTotalItems ??
    recentThreads.pagination.totalItems;
  const unread =
    typeof recentThreads.unreadThreadCount === "number"
      ? formatForumCount(recentThreads.unreadThreadCount)
      : "n/a";

  return (
    <section className="flex flex-col gap-1.5 rounded-xl bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="inline-flex items-baseline gap-1.5">
          <dt>Matching</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {formatLimitedCount(
              matching,
              recentThreads.limited || recentThreads.pagination.limited,
            )}
          </dd>
        </div>
        <div className="inline-flex items-baseline gap-1.5">
          <dt>Visible</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {formatForumCount(recentThreads.visibleThreadCount)}
          </dd>
        </div>
        <div className="inline-flex items-baseline gap-1.5">
          <dt>Unread</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {unread}
          </dd>
        </div>
      </dl>
      <p className="text-xs leading-5 text-muted-foreground">
        {recentThreads.label}
        {recentThreads.since
          ? ` / Since ${formatForumDateTime(recentThreads.since)}`
          : ""}
      </p>
    </section>
  );
}

function buildRecentThreadsPageHref(
  pathname: string,
  searchParams: Pick<URLSearchParams, "toString">,
  page: number,
) {
  const params = new URLSearchParams(searchParams.toString());

  if (page <= 1) {
    params.delete("page");
  } else {
    params.set("page", String(page));
  }

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

function formatLimitedCount(value: number, limited?: boolean) {
  const formatted = formatForumCount(value);
  return limited ? `${formatted}+` : formatted;
}

function parsePage(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
}
