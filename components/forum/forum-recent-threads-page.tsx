"use client";

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
  ForumMetricBar,
  ForumPaginationBar,
  ForumStatusBox,
  ForumThreadTable,
} from "@/components/forum/forum-primitives";
import { useQuery } from "convex/react";
import { usePathname, useSearchParams } from "next/navigation";

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
    <div className="space-y-6">
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

function LiveForumRecentThreadsPage({
  mode,
}: {
  mode: ForumRecentThreadMode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = parsePage(searchParams.get("page"));
  const recentThreads = useQuery(forumRefs.listRecentThreads, {
    mode,
    page,
    pageSize: RECENT_THREADS_PAGE_SIZE,
  });

  const buildPageHref = (nextPage: number) =>
    buildRecentThreadsPageHref(pathname, searchParams, nextPage);

  if (recentThreads === undefined) {
    return (
      <ForumLoading
        label={
          mode === "new" ? "Checking new posts" : "Checking today's posts"
        }
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
    <section className="border-y border-row-border py-4">
      <p className="page-kicker">
        {mode === "new" ? "Unread activity" : "Daily activity"}
      </p>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">{title}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
        {description}
      </p>
    </section>
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
    <div className="space-y-5">
      <ForumMetricBar
        className="sm:grid-cols-4"
        items={[
          {
            label: "Matching",
            value: formatLimitedCount(
              recentThreads.pagination.actualTotalItems ??
                recentThreads.pagination.totalItems,
              recentThreads.limited || recentThreads.pagination.limited,
            ),
          },
          { label: "Visible", value: recentThreads.visibleThreadCount },
          {
            label: "Unread",
            value:
              typeof recentThreads.unreadThreadCount === "number"
                ? recentThreads.unreadThreadCount
                : "n/a",
          },
          { label: "Scope", value: recentThreads.label },
        ]}
      />

      {recentThreads.since ? (
        <p className="font-mono text-[10px] uppercase leading-5 text-muted-foreground">
          Since {formatForumDateTime(recentThreads.since)}
        </p>
      ) : null}

      {recentThreads.limited ? (
        <ForumStatusBox
          title="Newest results shown"
          body="The backend capped this recent-activity result set, so pagination is limited to the newest matching threads."
          accent="canary"
        />
      ) : null}

      <ForumPaginationBar
        buildHref={buildPageHref}
        label="Threads"
        pagination={recentThreads.pagination}
      />

      {hasThreads ? (
        <ForumThreadTable category={null} threads={threads} />
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

      <ForumPaginationBar
        buildHref={buildPageHref}
        label="Threads"
        pagination={recentThreads.pagination}
      />
    </div>
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
