"use client";

import { Button } from "@/components/ui/button";
import { ProfilePanelSkeleton } from "@/components/profile-panel-skeleton";
import { type PublicProfileCommentRecord, convexRefs } from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { useQuery } from "convex/react";
import Link from "next/link";

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
        <h2 className="mt-3 text-2xl font-semibold">Profile not found.</h2>
        <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
          No user matches the handle in this URL.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-12">
      <section className="md:col-span-5">
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Public profile
        </p>
        <h2 className="mt-3 break-words text-3xl font-bold md:text-5xl">
          {profile.user.username}
        </h2>
        <p className="mt-4 text-sm leading-7 text-muted-foreground md:text-base">
          {profile.user.bio?.trim() ||
            "No public bio has been set for this handle yet."}
        </p>
        <dl className="mt-6 grid gap-4 text-sm">
          <MetaItem
            label="Joined"
            value={formatDate(
              profile.user.onboardedAt ?? profile.user._creationTime,
            )}
          />
          <MetaItem
            label="Role"
            value={profile.user.role === "owner" ? "Owner" : "Reader"}
          />
          <MetaItem
            label="Handle"
            mono
            value={profile.user.usernameNormalized}
          />
        </dl>
        {profile.isCurrentUser ? (
          <div className="mt-6">
            <Button asChild size="sm">
              <Link href="/profile">Open your profile</Link>
            </Button>
          </div>
        ) : null}
      </section>

      <section className="md:col-span-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Recent comments
            </p>
            <h3 className="mt-2 text-2xl font-semibold">Latest notes</h3>
          </div>
        </div>
        <div className="mt-6 space-y-4">
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
                <p className="text-sm leading-7 md:text-base">{comment.body}</p>
                <div className="mt-3">
                  <Button asChild size="sm" variant="outline">
                    <Link href={commentPath(comment)}>Open thread</Link>
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

function commentLabel(comment: PublicProfileCommentRecord) {
  return comment.entityType === "post" ? "Blog comment" : "News comment";
}

function commentPath(comment: PublicProfileCommentRecord) {
  return comment.entityType === "post"
    ? `/blog/${comment.entityId}`
    : `/news/${comment.entityId}`;
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
