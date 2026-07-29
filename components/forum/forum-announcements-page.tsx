"use client";

import {
  formatForumDateTime,
  forumAnnouncementPath,
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

export function ForumAnnouncementsPage({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Announcements unavailable"
        body="Convex is not configured in this checkout, so forum announcements cannot load."
        accent="cyan"
      />
    );
  }

  return <LiveForumAnnouncementsPage />;
}

function LiveForumAnnouncementsPage() {
  const announcements = useQuery(forumRefs.listAnnouncements, {
    includeBoardAnnouncements: true,
  });

  if (announcements === undefined) {
    return <ForumLoading label="Syncing announcements" />;
  }

  return (
    <div className="space-y-3">
      <div className="border-y border-row-border py-2">
        <p className="page-kicker">Forum bulletin</p>
        <h1 className="mt-1 text-xl font-semibold md:text-2xl">
          Announcements
        </h1>
      </div>

      {announcements.length === 0 ? (
        <ForumStatusBox
          title="No announcements"
          body="There are no forum announcements yet."
        />
      ) : (
        <div className="divide-y divide-row-border border-y border-row-border">
          {announcements.map((announcement) => (
            <article className="py-3" key={announcement._id}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">
                  <ForumLink
                    href={forumAnnouncementPath(announcement)}
                    prefetch
                  >
                    {announcement.title}
                  </ForumLink>
                </h2>
                <span className="border border-row-border px-1.5 font-mono text-[10px] uppercase text-muted-foreground">
                  {announcement.categoryName ?? "global"}
                </span>
              </div>
              <ForumBody body={announcement.body} className="mt-2" />
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  Updated {formatForumDateTime(announcement.updatedAt)}
                </p>
                {announcement.categorySlug ? (
                  <Button
                    asChild
                    className="h-7 rounded-none px-2 font-mono text-[10px] uppercase"
                    size="sm"
                    variant="outline"
                  >
                    <ForumLink
                      href={forumPath(announcement.categorySlug)}
                      prefetch
                    >
                      Open board
                    </ForumLink>
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
