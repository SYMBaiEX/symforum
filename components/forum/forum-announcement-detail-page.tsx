"use client";

import {
  formatForumDateTime,
  forumPath,
  forumRefs,
} from "@/components/forum/forum-refs";
import {
  ForumBody,
  ForumLink,
  ForumLoading,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";

export function ForumAnnouncementDetailPage({
  enabled,
  slug,
}: {
  enabled: boolean;
  slug: string;
}) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Announcement unavailable"
        body="Convex is not configured in this checkout, so forum announcements cannot load."
        accent="cyan"
      />
    );
  }

  return <LiveForumAnnouncementDetailPage slug={slug} />;
}

function LiveForumAnnouncementDetailPage({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const categorySlug = searchParams.get("board") ?? undefined;
  const announcement = useQuery(forumRefs.getAnnouncement, { slug, categorySlug });

  if (announcement === undefined) {
    return <ForumLoading label="Opening announcement" />;
  }

  if (announcement === null) {
    return (
      <ForumStatusBox
        title="Announcement not found"
        body="That announcement is not available or belongs to a board you cannot view."
        action={
          <Button
            asChild
            className="rounded-none font-mono text-[10px] uppercase"
            variant="outline"
          >
            <ForumLink href="/forum/announcements" prefetch>
              Announcement archive
            </ForumLink>
          </Button>
        }
      />
    );
  }

  return (
    <article className="space-y-6">
      <div className="border-y border-row-border py-4">
        <p className="page-kicker">Forum bulletin</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold md:text-3xl">
            {announcement.title}
          </h1>
          <span className="border border-row-border px-1.5 font-mono text-[10px] uppercase text-muted-foreground">
            {announcement.categoryName ?? "global"}
          </span>
          {announcement.status === "archived" ? (
            <span className="border border-row-border px-1.5 font-mono text-[10px] uppercase text-muted-foreground">
              archived
            </span>
          ) : null}
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase text-muted-foreground">
          Updated {formatForumDateTime(announcement.updatedAt)}
        </p>
      </div>

      <div className="border-y border-row-border py-5">
        <ForumBody body={announcement.body} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          asChild
          className="rounded-none font-mono text-[10px] uppercase"
          variant="outline"
        >
          <ForumLink href="/forum/announcements" prefetch>
            Announcement archive
          </ForumLink>
        </Button>
        {announcement.categorySlug ? (
          <Button
            asChild
            className="rounded-none font-mono text-[10px] uppercase"
            variant="outline"
          >
            <ForumLink href={forumPath(announcement.categorySlug)} prefetch>
              Open board
            </ForumLink>
          </Button>
        ) : null}
      </div>
    </article>
  );
}
