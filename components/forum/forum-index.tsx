"use client";

import { reportAppError } from "@/components/app-error-surface";
import {
  formatForumCount,
  formatForumDateTime,
  forumMemberProfilePath,
  forumPath,
  forumPostPath,
  forumRefs,
  type ForumOnlineSummaryRecord,
  type ForumOverviewRecord,
  type ForumSearchRecord,
} from "@/components/forum/forum-refs";
import {
  ForumAvatar,
  ForumAnnouncementPanel,
  ForumLink,
  ForumIndexTable,
  ForumLoading,
  ForumMetricBar,
  ForumNewestThreads,
  ForumStatusBox,
  ForumThreadPrefixBadge,
} from "@/components/forum/forum-primitives";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { userFacingError } from "@/lib/auth-errors";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";

export function ForumIndex({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Local forum disabled"
        body="Convex is not configured in this checkout, so the public boards are visible only as a disabled shell. Connect the local backend to browse categories, open threads, and post."
        accent="cyan"
      />
    );
  }

  return <LiveForumIndex />;
}

function LiveForumIndex() {
  const overview = useQuery(forumRefs.overview, {});

  if (overview === undefined) {
    return <ForumLoading variant="index" />;
  }

  return <ForumIndexContent overview={overview} />;
}

function ForumIndexContent({ overview }: { overview: ForumOverviewRecord }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [markAllReadPending, setMarkAllReadPending] = useState(false);
  const deferredQuery = useDeferredValue(searchQuery.trim());
  const searchArgs =
    deferredQuery.length >= 2 ? { query: deferredQuery } : "skip";
  const searchResult = useQuery(forumRefs.search, searchArgs);
  const markAllForumsRead = useMutation(forumRefs.markAllForumsRead);
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();

  async function markAllRead() {
    if (!isAuthenticated) {
      toast.error("Sign in to mark all forums read");
      return;
    }

    setMarkAllReadPending(true);
    try {
      const result = await markAllForumsRead({});
      toast.success(
        result.categoryCount === 0
          ? "No visible boards to mark"
          : `Marked ${result.categoryCount} board${
              result.categoryCount === 1 ? "" : "s"
            } read`,
      );
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "forum_mark_all_read_failed",
        component: "ForumIndex",
        action: "forum:markAllForumsRead",
        notify: false,
      });
      toast.error(userFacingError(caught, "Could not mark forums read"));
    } finally {
      setMarkAllReadPending(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="min-w-0">
        <div className="mb-3 flex flex-col gap-3 border-b border-row-border pb-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Board index
            </p>
            <h2 className="mt-2 text-2xl font-semibold md:text-3xl">
              Public categories
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              asChild
              className="rounded-none font-mono text-[10px] uppercase"
              variant="outline"
            >
              <ForumLink href="/forum/control-panel" prefetch>
                User CP
              </ForumLink>
            </Button>
            <Button
              asChild
              className="rounded-none font-mono text-[10px] uppercase"
              variant="outline"
            >
              <ForumLink href="/forum/subscriptions" prefetch>
                Subscriptions
              </ForumLink>
            </Button>
            <Button
              aria-busy={markAllReadPending}
              className="rounded-none font-mono text-[10px] uppercase"
              disabled={authLoading || markAllReadPending}
              type="button"
              variant="outline"
              onClick={markAllRead}
            >
              Mark all read
            </Button>
          </div>
        </div>
        <ForumIndexTable
          categories={overview.categories}
          sections={overview.sections}
        />
      </section>

      <ForumAnnouncementPanel announcements={overview.announcements} />

      <section className="border-y border-row-border py-4">
        <label className="grid gap-2">
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            Search all boards
          </span>
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search thread titles and replies"
            className="rounded-none border-row-border font-mono text-[11px] uppercase"
          />
        </label>
        {deferredQuery.length >= 2 ? (
          <ForumGlobalSearchResults
            query={deferredQuery}
            searchResult={searchResult}
          />
        ) : null}
      </section>

      <ForumMetricBar
        items={[
          { label: "Categories", value: overview.totals.categories },
          { label: "Threads", value: overview.totals.threads },
          { label: "Posts", value: overview.totals.posts },
        ]}
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.85fr)]">
        <ForumNewestThreads threads={overview.newestThreads} />
        <div className="grid content-start gap-5">
          <ForumOnlineNowPanel online={overview.online} />
          <ForumBoardStatisticsPanel
            statistics={overview.statistics}
            totals={overview.totals}
          />
        </div>
      </div>
    </div>
  );
}

function ForumOnlineNowPanel({ online }: { online: ForumOnlineSummaryRecord }) {
  const countLabel = `${formatForumCount(online.registeredCount)}${
    online.registeredCountLimited ? "+" : ""
  }`;

  return (
    <section className="border border-row-border">
      <div className="border-b border-row-border px-4 py-3">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Who&apos;s online
        </p>
        <h2 className="mt-2 text-xl font-semibold">
          {countLabel} registered member
          {online.registeredCount === 1 ? "" : "s"}
        </h2>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Active since {formatForumDateTime(online.activeSince)}
        </p>
      </div>
      {online.members.length > 0 ? (
        <div className="divide-y divide-row-border">
          {online.members.map((member) => (
            <div
              className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 px-4 py-3"
              key={member.userId}
            >
              <ForumAvatar
                alt={`${member.displayName} avatar`}
                className="size-9"
                name={member.displayName}
                src={member.avatarUrl}
              />
              <div className="min-w-0">
                <ForumLink
                  className="focus-ring truncate text-sm font-semibold hover:text-primary"
                  href={forumMemberProfilePath(member.username)}
                  prefetch
                >
                  {member.displayName}
                </ForumLink>
                <p className="mt-1 truncate font-mono text-[10px] uppercase text-muted-foreground">
                  {member.location.href ? (
                    <Link
                      className="focus-ring hover:text-foreground"
                      href={member.location.href}
                      prefetch
                    >
                      {member.location.label}
                    </Link>
                  ) : (
                    member.location.label
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-4 text-sm leading-6 text-muted-foreground">
          No registered members are active in the forum window.
        </p>
      )}
    </section>
  );
}

function ForumBoardStatisticsPanel({
  statistics,
  totals,
}: {
  statistics: ForumOverviewRecord["statistics"];
  totals: ForumOverviewRecord["totals"];
}) {
  const memberCount = `${formatForumCount(statistics.memberCount)}${
    statistics.memberCountLimited ? "+" : ""
  }`;

  return (
    <section className="border border-row-border">
      <div className="border-b border-row-border px-4 py-3">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Board statistics
        </p>
        <h2 className="mt-2 text-xl font-semibold">
          {formatForumCount(totals.threads)} threads /{" "}
          {formatForumCount(totals.posts)} posts
        </h2>
      </div>
      <dl className="divide-y divide-row-border">
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 px-4 py-3">
          <dt className="font-mono text-[10px] uppercase text-muted-foreground">
            Members
          </dt>
          <dd className="text-sm font-semibold">{memberCount}</dd>
        </div>
        <ForumStatisticMemberRow
          label="Newest"
          member={statistics.newestMember}
          value={
            statistics.newestMember
              ? `Joined ${formatForumDateTime(statistics.newestMember.joinedAt)}`
              : undefined
          }
        />
        <ForumStatisticMemberRow
          label="Top poster"
          member={statistics.topPoster}
          value={
            statistics.topPoster
              ? `${formatForumCount(statistics.topPoster.postCount)} posts`
              : undefined
          }
        />
        <ForumStatisticMemberRow
          label="Reputation"
          member={statistics.reputationLeader}
          value={
            statistics.reputationLeader
              ? formatForumSignedCount(
                  statistics.reputationLeader.reputationScore,
                )
              : undefined
          }
        />
      </dl>
    </section>
  );
}

function ForumStatisticMemberRow({
  label,
  member,
  value,
}: {
  label: string;
  member: ForumOverviewRecord["statistics"]["newestMember"];
  value?: string;
}) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 px-4 py-3">
      <dt className="font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0">
        {member ? (
          <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
            <ForumAvatar
              alt={`${member.displayName} avatar`}
              className="size-8"
              name={member.displayName}
              src={member.avatarUrl}
            />
            <div className="min-w-0">
              <ForumLink
                className="focus-ring block truncate text-sm font-semibold hover:text-primary"
                href={forumMemberProfilePath(member.username)}
                prefetch
              >
                {member.displayName}
              </ForumLink>
              {value ? (
                <p className="mt-1 truncate font-mono text-[10px] uppercase text-muted-foreground">
                  {value}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">No members yet.</span>
        )}
      </dd>
    </div>
  );
}

function ForumGlobalSearchResults({
  query,
  searchResult,
}: {
  query: string;
  searchResult: ForumSearchRecord | undefined;
}) {
  if (searchResult === undefined) {
    return <ForumLoading label={`Searching ${query}`} />;
  }

  if (searchResult.threads.length === 0 && searchResult.posts.length === 0) {
    return (
      <div className="mt-4">
        <ForumStatusBox
          title="Search"
          body={`No public matches for "${query}".`}
        />
      </div>
    );
  }

  return (
    <div className="mt-4 border border-row-border">
      <div className="border-b border-row-border px-4 py-3 font-mono text-[10px] uppercase text-muted-foreground">
        Matches for {query}
      </div>
      <div className="divide-y divide-row-border">
        {searchResult.threads.map((thread) => (
          <div
            key={`thread-${thread.threadId ?? thread._id}`}
            className="px-4 py-4"
          >
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Thread / {thread.categorySlug}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ForumThreadPrefixBadge thread={thread} />
              <ForumLink
                href={forumPath(thread.categorySlug, thread.slug)}
                prefetch
                className="focus-ring text-base font-semibold hover:text-primary"
              >
                {thread.title}
              </ForumLink>
            </div>
            {thread.excerpt ? (
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {thread.excerpt}
              </p>
            ) : null}
          </div>
        ))}
        {searchResult.posts.map((post) => (
          <div key={`post-${post.postId ?? post._id}`} className="px-4 py-4">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Reply / {post.categorySlug}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ForumThreadPrefixBadge thread={post} />
              <ForumLink
                href={forumPostPath(
                  post.categorySlug,
                  post.threadSlug,
                  post.postNumber,
                  post.postPage,
                )}
                prefetch
                className="focus-ring text-base font-semibold hover:text-primary"
              >
                {post.threadTitle}
              </ForumLink>
            </div>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
              {post.excerpt ?? post.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatForumSignedCount(value: number) {
  if (value > 0) {
    return `+${formatForumCount(value)}`;
  }
  return formatForumCount(value);
}
