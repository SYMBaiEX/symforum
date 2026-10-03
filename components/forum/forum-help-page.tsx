"use client";

import {
  formatForumDateTime,
  forumHelpPath,
  forumRefs,
} from "@/components/forum/forum-refs";
import {
  ForumLink,
  ForumLoading,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { useQuery } from "convex-helpers/react/cache/hooks";

export function ForumHelpPage({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Help desk unavailable"
        body="Convex is not configured in this checkout, so forum help documents cannot load."
        accent="cyan"
      />
    );
  }

  return <LiveForumHelpPage />;
}

function LiveForumHelpPage() {
  const documents = useQuery(forumRefs.listHelpDocuments, {});

  if (documents === undefined) {
    return <ForumLoading label="Syncing help desk" />;
  }

  return (
    <div className="space-y-3">
      {documents.length === 0 ? (
        <ForumStatusBox
          title="No help documents"
          body="The forum help desk has no active documents yet."
        />
      ) : (
        <div className="forum-panel min-w-0">
          <div className="grid grid-cols-[minmax(0,1fr)_9rem] bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
            <span>Topic</span>
            <span className="text-right">Last edited</span>
          </div>
          <div className="space-y-1">
            {documents.map((document) => (
              <article
                className="forum-list-row grid min-w-0 gap-2 px-3 py-3 md:grid-cols-[minmax(0,1fr)_9rem]"
                key={document._id}
              >
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">
                    <ForumLink href={forumHelpPath(document)} prefetch>
                      {document.title}
                    </ForumLink>
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                    {document.excerpt}
                  </p>
                </div>
                <div className="flex items-start justify-between gap-2 md:block md:text-right">
                  <p className="text-xs text-muted-foreground">
                    {formatForumDateTime(document.updatedAt)}
                  </p>
                  <Button
                    asChild
                    className="mt-0 h-7 rounded-xl px-2 text-xs md:mt-2"
                    size="sm"
                    variant="outline"
                  >
                    <ForumLink href={forumHelpPath(document)} prefetch>
                      Open
                    </ForumLink>
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
