"use client";

import { asRoute } from "@/lib/typed-route";

import { reportAppError } from "@/components/app-error-surface";
import {
  formatForumCount,
  formatForumDateTime,
  forumMemberProfilePath,
  forumPath,
  forumRefs,
  getThreadAuthor,
  getThreadStartedAt,
  humanizeSlug,
  type ForumOnlineSummaryRecord,
  type ForumOverviewRecord,
  type ForumThreadSummaryRecord,
} from "@/components/forum/forum-refs";
import {
  ForumAvatar,
  ForumAnnouncementPanel,
  ForumLink,
  ForumIndexTable,
  ForumStatusBox,
  ForumThreadPrefixBadge,
  ForumThreadStateBadges,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { userFacingError } from "@/lib/auth-errors";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useConvexAuth, useMutation } from "convex/react";
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
    return (
      <p
        aria-busy="true"
        aria-live="polite"
        className="border-y border-row-border py-2.5 font-mono text-[11px] uppercase text-muted-foreground"
        role="status"
      >
        Loading forum
      </p>
    );
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
    <div className="space-y-2">
      <section className="min-w-0">
        <div className="mb-2 flex flex-col gap-2 border-b border-row-border pb-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Board index
            </p>
            <h1 className="mt-1 text-lg font-semibold md:text-xl">
              Find a useful thread
            </h1>
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
    <section className="border-y border-row-border py-2">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.65fr)]">
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
          No public threads are active yet. Choose a board above when you are
          ready to start the first discussion.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Newest threads
          </p>
          <h2
            className="mt-1 text-lg font-semibold"
            id="forum-newest-threads-heading"
          >
            Recent activity
          </h2>
        </div>
        <ForumLink
          className="focus-ring font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground"
          href="/forum/new-posts"
          prefetch
        >
          View new posts
        </ForumLink>
      </div>
      <div
        aria-labelledby="forum-newest-threads-heading"
        className="focus-ring mt-2 max-h-[min(24rem,55vh)] divide-y divide-row-border overflow-y-auto overscroll-contain border-y border-row-border pr-2 [scrollbar-gutter:stable] sm:max-h-[26rem] xl:max-h-[28rem]"
        role="region"
        tabIndex={0}
      >
        {threads.map((thread) => (
          <article
            className="py-2"
            key={`${thread.categorySlug ?? "forum"}-${thread.slug}`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <ForumThreadPrefixBadge thread={thread} />
              <ForumLink
                className="focus-ring min-w-0 text-sm font-semibold leading-5 hover:text-primary md:text-base"
                href={forumPath(thread.categorySlug, thread.slug)}
                prefetch
              >
                {thread.title}
              </ForumLink>
              <ForumThreadStateBadges thread={thread} />
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {thread.categoryName ??
                (thread.categorySlug
                  ? humanizeSlug(thread.categorySlug)
                  : "Forum")}{" "}
              / {getThreadAuthor(thread)} /{" "}
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
    <aside className="border-t border-row-border pt-3 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        Board pulse
      </p>
      <dl className="mt-2 grid grid-cols-4 gap-x-3">
        {pulseStats.map((item) => (
          <div className="min-w-0" key={item.label}>
            <dt className="font-mono text-[10px] uppercase text-muted-foreground">
              {item.label}
            </dt>
            <dd className="mt-0.5 text-base font-semibold">{item.value}</dd>
          </div>
        ))}
      </dl>

      {online.members.length > 0 ? (
        <div className="mt-3 border-t border-row-border pt-3">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Active since {formatForumDateTime(online.activeSince)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {online.members.slice(0, 6).map((member) => (
              <ForumOnlineMemberChip key={member.userId} member={member} />
            ))}
          </div>
        </div>
      ) : null}

      {hasMemberHighlights ? (
        <div className="mt-3 grid gap-3 border-t border-row-border pt-3 sm:grid-cols-3 xl:grid-cols-1">
          {showNewestMember ? (
            <ForumPulseMember
              label="Newest member"
              member={newestMember}
              value={`Joined ${formatForumDateTime(newestMember.joinedAt)}`}
            />
          ) : null}
          <ForumPulseMember
            label="Top poster"
            member={topPoster}
            value={
              topPoster
                ? `${formatForumCount(topPoster.postCount)} posts`
                : undefined
            }
          />
          <ForumPulseMember
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
    <div className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] gap-2">
      <ForumAvatar
        alt={`${member.displayName} avatar`}
        className="size-7"
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
        <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
          {member.location.href ? (
            <Link
              className="focus-ring hover:text-foreground"
              href={asRoute(member.location.href)}
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
      <div className="mt-1 grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2">
        <ForumAvatar
          alt={`${member.displayName} avatar`}
          className="size-7"
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
            <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
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
