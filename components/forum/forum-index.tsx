"use client";

import { reportAppError } from "@/components/app-error-surface";
import {
  formatForumCount,
  formatForumDateTime,
  forumMemberProfilePath,
  forumPath,
  forumRefs,
  getThreadAuthor,
  getThreadStartedAt,
  type ForumOnlineSummaryRecord,
  type ForumOverviewRecord,
  type ForumThreadSummaryRecord,
} from "@/components/forum/forum-refs";
import {
  ForumAvatar,
  ForumAnnouncementPanel,
  ForumLink,
  ForumIndexTable,
  ForumLoading,
  ForumStatusBox,
  ForumThreadPrefixBadge,
  ForumThreadStateBadges,
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
    <div className="space-y-3">
      <section className="min-w-0">
        <div className="mb-2 flex flex-col gap-2 border-b border-row-border pb-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Board index
            </p>
            <h2 className="mt-1 text-lg font-semibold md:text-xl">
              Find a useful thread
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

      <ForumIndexPulse overview={overview} />
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
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground">
      {items.map((item) => (
        <div className="inline-flex items-baseline gap-1.5" key={item.label}>
          <dt>{item.label}</dt>
          <dd className="text-foreground">{formatForumCount(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ForumIndexPulse({ overview }: { overview: ForumOverviewRecord }) {
  return (
    <section className="border-y border-row-border py-3">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(19rem,0.8fr)]">
        <ForumIndexThreadPreview threads={overview.newestThreads} />
        <ForumPulseSummary overview={overview} />
      </div>
    </section>
  );
}

function ForumIndexThreadPreview({
  threads,
}: {
  threads: ForumThreadSummaryRecord[];
}) {
  if (threads.length === 0) {
    return (
      <div>
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Newest threads
        </p>
        <h2 className="mt-2 text-2xl font-semibold leading-tight">
          No active threads yet.
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          The first public conversation will land here. Until then, the board
          index above is the clean map of where threads will live.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Newest threads
          </p>
          <h2 className="mt-2 text-xl font-semibold">Recent activity</h2>
        </div>
        <ForumLink
          className="focus-ring font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground"
          href="/forum/new-posts"
          prefetch
        >
          View new posts
        </ForumLink>
      </div>
      <div className="mt-3 divide-y divide-row-border border-t border-row-border">
        {threads.map((thread) => (
          <article
            className="py-3"
            key={`${thread.categorySlug ?? "forum"}-${thread.slug}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <ForumThreadPrefixBadge thread={thread} />
              <ForumLink
                className="focus-ring min-w-0 text-base font-semibold hover:text-primary md:text-lg"
                href={forumPath(thread.categorySlug, thread.slug)}
                prefetch
              >
                {thread.title}
              </ForumLink>
              <ForumThreadStateBadges thread={thread} />
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {thread.categoryName ?? "General"} / {getThreadAuthor(thread)} /{" "}
              {formatForumDateTime(getThreadStartedAt(thread))}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

function ForumPulseSummary({ overview }: { overview: ForumOverviewRecord }) {
  const { online, statistics, totals } = overview;
  const countLabel = `${formatForumCount(online.registeredCount)}${
    online.registeredCountLimited ? "+" : ""
  }`;
  const memberCount = `${formatForumCount(statistics.memberCount)}${
    statistics.memberCountLimited ? "+" : ""
  }`;
  const pulseStats = [
    { label: "Online", value: countLabel },
    { label: "Members", value: memberCount },
    { label: "Threads", value: formatForumCount(totals.threads) },
    { label: "Posts", value: formatForumCount(totals.posts) },
  ];
  const newestMember = statistics.newestMember ?? null;
  const topPoster = statistics.topPoster ?? null;
  const reputationLeader = statistics.reputationLeader ?? null;
  const newestIsOnline =
    newestMember !== null &&
    online.members.some((member) => member.username === newestMember.username);
  const showNewestMember = newestMember !== null && !newestIsOnline;
  const hasMemberHighlights =
    showNewestMember || topPoster !== null || reputationLeader !== null;

  return (
    <aside className="border-t border-row-border pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        Board pulse
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
        {pulseStats.map((item) => (
          <div key={item.label}>
            <dt className="font-mono text-[10px] uppercase text-muted-foreground">
              {item.label}
            </dt>
            <dd className="mt-1 text-lg font-semibold">{item.value}</dd>
          </div>
        ))}
      </dl>

      {online.members.length > 0 ? (
        <div className="mt-5 border-t border-row-border pt-4">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Active since {formatForumDateTime(online.activeSince)}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {online.members.slice(0, 6).map((member) => (
              <ForumOnlineMemberChip key={member.userId} member={member} />
            ))}
          </div>
        </div>
      ) : null}

      {hasMemberHighlights ? (
        <div className="mt-5 border-t border-row-border pt-4">
          {showNewestMember ? (
            <ForumPulseMember
              label="Newest member"
              member={newestMember}
              value={`Joined ${formatForumDateTime(newestMember.joinedAt)}`}
            />
          ) : null}
          <ForumPulseMember
            className={showNewestMember ? "mt-4" : undefined}
            label="Top poster"
            member={topPoster}
            value={
              topPoster
                ? `${formatForumCount(topPoster.postCount)} posts`
                : undefined
            }
          />
          <ForumPulseMember
            className={
              showNewestMember || topPoster !== null ? "mt-4" : undefined
            }
            label="Reputation"
            member={reputationLeader}
            value={
              reputationLeader
                ? formatForumSignedCount(reputationLeader.reputationScore)
                : undefined
            }
          />
        </div>
      ) : null}
    </aside>
  );
}

function ForumOnlineMemberChip({
  member,
}: {
  member: ForumOnlineSummaryRecord["members"][number];
}) {
  return (
    <div className="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] gap-2">
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
  );
}

function ForumPulseMember({
  className,
  label,
  member,
  value,
}: {
  className?: string;
  label: string;
  member: ForumOverviewRecord["statistics"]["newestMember"];
  value?: string;
}) {
  if (!member) {
    return null;
  }

  return (
    <div className={className}>
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2">
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
    </div>
  );
}

function formatForumSignedCount(value: number) {
  if (value > 0) {
    return `+${formatForumCount(value)}`;
  }
  return formatForumCount(value);
}
