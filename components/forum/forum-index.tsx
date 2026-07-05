"use client";

import { reportAppError } from "@/components/app-error-surface";
import {
  formatForumCount,
  formatForumDateTime,
  forumMemberProfilePath,
  forumRefs,
  type ForumOnlineSummaryRecord,
  type ForumOverviewRecord,
} from "@/components/forum/forum-refs";
import {
  ForumAvatar,
  ForumAnnouncementPanel,
  ForumLink,
  ForumIndexTable,
  ForumLoading,
  ForumNewestThreads,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { userFacingError } from "@/lib/auth-errors";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
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
  const [markAllReadPending, setMarkAllReadPending] = useState(false);
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
    <div className="space-y-6">
      <section className="min-w-0">
        <div className="mb-4 flex flex-col gap-4 border-b border-row-border pb-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Board index
            </p>
            <h2 className="mt-2 text-2xl font-semibold md:text-3xl">
              Public categories
            </h2>
            <ForumIndexSnapshot overview={overview} />
          </div>
          <div className="flex flex-wrap gap-2 xl:justify-end">
            <Button
              aria-busy={markAllReadPending}
              className="h-8 rounded-none px-3 font-mono text-[10px] uppercase"
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.85fr)]">
        <div className="min-w-0">
          {overview.newestThreads.length > 0 ? (
            <ForumNewestThreads threads={overview.newestThreads} />
          ) : (
            <ForumQuietStatus label="Newest threads">
              No active threads yet.
            </ForumQuietStatus>
          )}
        </div>
        <div className="grid content-start gap-4">
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

function ForumIndexSnapshot({ overview }: { overview: ForumOverviewRecord }) {
  const items = [
    { label: "Categories", value: overview.totals.categories },
    { label: "Threads", value: overview.totals.threads },
    { label: "Posts", value: overview.totals.posts },
  ];

  return (
    <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground">
      {items.map((item) => (
        <div className="inline-flex items-baseline gap-1.5" key={item.label}>
          <dt>{item.label}</dt>
          <dd className="text-foreground">{formatForumCount(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ForumQuietStatus({
  children,
  label,
}: {
  children: string;
  label: string;
}) {
  return (
    <section className="border-y border-row-border py-4">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </section>
  );
}

function ForumOnlineNowPanel({ online }: { online: ForumOnlineSummaryRecord }) {
  const countLabel = `${formatForumCount(online.registeredCount)}${
    online.registeredCountLimited ? "+" : ""
  }`;

  return (
    <section className="border-y border-row-border py-4">
      <div>
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Who&apos;s online
        </p>
        <h2 className="mt-2 text-lg font-semibold">
          {countLabel} registered member
          {online.registeredCount === 1 ? "" : "s"}
        </h2>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Active since {formatForumDateTime(online.activeSince)}
        </p>
      </div>
      {online.members.length > 0 ? (
        <div className="mt-3 divide-y divide-row-border border-t border-row-border">
          {online.members.map((member) => (
            <div
              className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 py-3"
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
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
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
    <section className="border-y border-row-border py-4">
      <div>
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Board statistics
        </p>
        <h2 className="mt-2 text-lg font-semibold">
          {formatForumCount(totals.threads)} threads /{" "}
          {formatForumCount(totals.posts)} posts
        </h2>
      </div>
      <dl className="mt-3 divide-y divide-row-border border-t border-row-border">
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3">
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
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3">
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

function formatForumSignedCount(value: number) {
  if (value > 0) {
    return `+${formatForumCount(value)}`;
  }
  return formatForumCount(value);
}
