"use client";

import { Button } from "@/components/ui/button";
import { formatForumCount, forumPostPath } from "@/components/forum/forum-refs";
import { ForumAvatar, ForumBody } from "@/components/forum/forum-primitives";
import { ProfilePanelSkeleton } from "@/components/profile-panel-skeleton";
import {
  convexRefs,
  type PublicForumProfileRecord,
  type PublicProfileCommentRecord,
  type PublicProfileForumReplyRecord,
  type PublicProfileForumThreadRecord,
} from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { useQuery } from "convex-helpers/react/cache/hooks";
import Link from "next/link";
import type { ReactNode } from "react";

export function PublicProfilePanel({ username }: { username: string }) {
  const profile = useQuery(convexRefs.users.publicProfile, { username });

  if (profile === undefined) {
    return <ProfilePanelSkeleton />;
  }

  if (profile === null) {
    return (
      <div>
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Profile lookup
        </p>
        <h2 className="mt-1 text-xl font-semibold">Profile not found.</h2>
        <p className="mt-1.5 max-w-xl text-sm leading-5 text-muted-foreground">
          No user matches the handle in this URL.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <section className="lg:col-span-5">
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Public profile
        </p>
        <h2 className="mt-1 break-words text-2xl font-semibold">
          {profile.user.username}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {profile.user.bio?.trim() ||
            "No public bio has been set for this handle yet."}
        </p>
        <dl className="mt-3 grid gap-2 text-sm">
          <MetaItem
            label="Joined"
            value={formatDate(
              profile.user.onboardedAt ?? profile.user._creationTime,
            )}
          />
          <MetaItem
            label="Role"
            value={
              profile.user.role === "owner"
                ? "Owner"
                : profile.user.role === "admin"
                  ? "Administrator"
                  : "Reader"
            }
          />
          <MetaItem
            label="Handle"
            mono
            value={profile.user.usernameNormalized}
          />
        </dl>
        <ForumProfileSummary
          currentUser={profile.isCurrentUser}
          profile={profile.forumProfile}
          username={profile.user.usernameNormalized}
        />
        {profile.isCurrentUser ? (
          <div className="mt-3">
            <Button asChild size="sm">
              <Link href="/profile" prefetch>
                Open your profile
              </Link>
            </Button>
          </div>
        ) : null}
      </section>

      <section className="lg:col-span-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Recent comments
            </p>
            <h3 className="mt-1 text-xl font-semibold">Latest notes</h3>
          </div>
        </div>
        <div className="mt-3 space-y-3">
          <section className="border-b border-row-border pb-3">
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Forum activity
            </p>
            <div className="mt-2 grid gap-3 lg:grid-cols-2">
              <ActivityList
                empty="No started threads yet."
                heading="Threads"
                items={profile.recentForumThreads}
                renderItem={(thread) => (
                  <ForumThreadActivity key={thread._id} thread={thread} />
                )}
              />
              <ActivityList
                empty="No forum replies yet."
                heading="Replies"
                items={profile.recentForumReplies}
                renderItem={(reply) => (
                  <ForumReplyActivity key={reply._id} reply={reply} />
                )}
              />
            </div>
          </section>

          {profile.recentComments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No public comments yet.
            </p>
          ) : (
            profile.recentComments.map((comment) => (
              <article key={comment._id}>
                <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase text-muted-foreground">
                  <span>{commentLabel(comment)}</span>
                  <span>{formatDate(comment.createdAt)}</span>
                </div>
                <p className="text-sm leading-6">{comment.body}</p>
                <div className="mt-3">
                  <Button asChild size="sm" variant="outline">
                    <Link href={commentPath(comment)} prefetch>
                      Open thread
                    </Link>
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ForumProfileSummary({
  currentUser,
  profile,
  username,
}: {
  currentUser: boolean;
  profile: PublicForumProfileRecord;
  username: string;
}) {
  const reputation = formatSignedCount(profile.reputationScore);
  return (
    <section className="mt-4 border border-row-border">
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2.5 border-b border-row-border p-3">
        <ForumAvatar
          alt={`${username} avatar`}
          className="size-10"
          name={username}
          src={profile.avatarUrl}
        />
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Forum member
          </p>
          <h3 className="mt-1 truncate text-lg font-semibold">
            {profile.customTitle || profile.rank}
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ForumProfileBadge>
              {profile.trusted ? "Trusted" : "Pending"}
            </ForumProfileBadge>
            <ForumProfileBadge>
              {profile.isOnline ? "Online" : "Offline"}
            </ForumProfileBadge>
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-row-border border-b border-row-border text-center">
        <ForumStatCell
          label="Threads"
          value={formatForumCount(profile.threadCount)}
        />
        <ForumStatCell
          label="Posts"
          value={formatForumCount(profile.postCount)}
        />
        <ForumStatCell label="Reputation" value={reputation} />
      </dl>
      <dl className="grid gap-2 p-3 text-sm">
        <MetaItem label="Rank" value={profile.rank} />
        {profile.location ? (
          <MetaItem label="Location" value={profile.location} />
        ) : null}
        {profile.birthday ? (
          <MetaItem label="Birthday" value={formatDate(profile.birthday)} />
        ) : null}
        {profile.timeZone ? (
          <MetaItem label="Timezone" value={profile.timeZone} />
        ) : null}
        <MetaItem label="Forum joined" value={formatDate(profile.joinedAt)} />
        {profile.websiteUrl ? (
          <div>
            <dt className="font-mono text-[11px] uppercase text-muted-foreground">
              Website
            </dt>
            <dd className="mt-1 break-words">
              <a href={profile.websiteUrl} rel="nofollow me">
                {profile.websiteUrl}
              </a>
            </dd>
          </div>
        ) : null}
        {profile.isOnline && profile.onlineLocation ? (
          <div>
            <dt className="font-mono text-[11px] uppercase text-muted-foreground">
              Current activity
            </dt>
            <dd className="mt-1">
              {profile.onlineLocation.href ? (
                <Link href={profile.onlineLocation.href} prefetch>
                  {profile.onlineLocation.label}
                </Link>
              ) : (
                profile.onlineLocation.label
              )}
            </dd>
          </div>
        ) : null}
      </dl>
      {profile.bio ? (
        <div className="border-t border-row-border p-3">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Bio
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-muted-foreground">
            {profile.bio}
          </p>
        </div>
      ) : null}
      {profile.signature ? (
        <div className="border-t border-row-border p-3">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Signature
          </p>
          <ForumBody
            body={profile.signature}
            className="mt-2 text-xs leading-5 text-muted-foreground md:text-sm"
          />
        </div>
      ) : null}
      {!currentUser && profile.trusted ? (
        <div className="border-t border-row-border p-3">
          <Button
            asChild
            className="rounded-none font-mono text-[10px] uppercase"
            size="sm"
            variant="outline"
          >
            <Link
              href={`/forum/messages?${new URLSearchParams({
                compose: "1",
                recipient: username,
              }).toString()}`}
              prefetch
            >
              Send private message
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ForumProfileBadge({ children }: { children: ReactNode }) {
  return (
    <span className="border border-row-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
      {children}
    </span>
  );
}

function ForumStatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-2">
      <dt className="font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold">{value}</dd>
    </div>
  );
}

function ActivityList<T>({
  empty,
  heading,
  items,
  renderItem,
}: {
  empty: string;
  heading: string;
  items: T[];
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold">{heading}</h4>
      <div className="mt-2 space-y-2.5">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          items.map(renderItem)
        )}
      </div>
    </div>
  );
}

function ForumThreadActivity({
  thread,
}: {
  thread: PublicProfileForumThreadRecord;
}) {
  return (
    <article>
      <Link
        href={`/forum/${thread.categorySlug}/${thread.slug}`}
        prefetch
        className="focus-ring flex flex-wrap items-center gap-2 text-sm font-semibold hover:text-primary"
      >
        <ProfileForumPrefix prefix={thread.prefix} />
        {thread.title}
      </Link>
      <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
        {thread.replyCount} replies / {formatDate(thread.lastPostAt)}
      </p>
    </article>
  );
}

function ForumReplyActivity({
  reply,
}: {
  reply: PublicProfileForumReplyRecord;
}) {
  return (
    <article>
      <Link
        href={forumPostPath(
          reply.categorySlug,
          reply.threadSlug,
          reply.postNumber,
          reply.postPage,
        )}
        prefetch
        className="focus-ring flex flex-wrap items-center gap-2 text-sm font-semibold hover:text-primary"
      >
        <ProfileForumPrefix prefix={reply.prefix} />
        {reply.threadTitle}
      </Link>
      <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
        {reply.excerpt}
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
        {formatDate(reply.createdAt)}
      </p>
    </article>
  );
}

function ProfileForumPrefix({
  prefix,
}: {
  prefix: PublicProfileForumThreadRecord["prefix"];
}) {
  if (!prefix) {
    return null;
  }
  return (
    <span
      className="inline-flex min-h-5 items-center border border-row-border px-1.5 font-mono text-[10px] uppercase leading-none text-muted-foreground"
      style={
        prefix.color
          ? { borderColor: prefix.color, color: prefix.color }
          : undefined
      }
    >
      [{prefix.label}]
    </span>
  );
}

function commentLabel(comment: PublicProfileCommentRecord) {
  if (comment.entityType === "post") {
    return "Blog comment";
  }
  if (comment.entityType === "portfolioProject") {
    return "Project comment";
  }
  return "News comment";
}

function commentPath(comment: PublicProfileCommentRecord) {
  if (comment.entityType === "post") {
    return `/blog/${comment.entityId}`;
  }
  if (comment.entityType === "portfolioProject") {
    return `/portfolio/${comment.entityId}`;
  }
  return `/news/${comment.entityId}`;
}

function formatSignedCount(value: number) {
  if (value > 0) {
    return `+${formatForumCount(value)}`;
  }
  return formatForumCount(value);
}

function MetaItem({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div>
      <dt className="font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "mt-1 font-mono text-xs uppercase" : "mt-1"}>
        {value}
      </dd>
    </div>
  );
}
