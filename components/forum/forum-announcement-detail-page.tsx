"use client";

import { ForumPageHeader } from "./forum-layout-primitives";

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
import { useQuery } from "convex-helpers/react/cache/hooks";
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
  const announcement = useQuery(forumRefs.getAnnouncement, {
    slug,
    categorySlug,
  });

  if (announcement === undefined) {
    return <ForumLoading label="Opening announcement" />;
  }

  if (announcement === null) {
    return (
      <ForumStatusBox
        title="Announcement not found"
        body="That announcement is not available or belongs to a board you cannot view."
        action={
          <Button asChild className="rounded-sm text-xs" variant="outline">
            <ForumLink href="/forum/announcements" prefetch>
              Announcement archive
            </ForumLink>
          </Button>
        }
      />
    );
  }

  return (
    <article className="space-y-3">
      <ForumPageHeader
        title={announcement.title}
        description={`Updated ${formatForumDateTime(announcement.updatedAt)}`}
        actions={
          <span className="rounded-sm bg-muted px-3 py-2 text-xs text-muted-foreground">
            {announcement.categoryName ?? "Global"}
            {announcement.status === "archived" ? " · Archived" : ""}
          </span>
        }
      />

      <div className="max-w-3xl rounded-sm bg-muted/25 p-4 sm:p-6">
        <ForumBody body={announcement.body} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild className="rounded-sm text-xs" variant="outline">
          <ForumLink href="/forum/announcements" prefetch>
            Announcement archive
          </ForumLink>
        </Button>
        {announcement.categorySlug ? (
          <Button asChild className="rounded-sm text-xs" variant="outline">
            <ForumLink href={forumPath(announcement.categorySlug)} prefetch>
              Open board
            </ForumLink>
          </Button>
        ) : null}
      </div>
    </article>
  );
}
