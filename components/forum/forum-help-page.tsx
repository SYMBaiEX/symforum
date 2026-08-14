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
      <div className="border-y border-row-border py-2">
        <p className="page-kicker">Forum helpdesk</p>
        <h2 className="mt-1 text-xl font-semibold md:text-2xl">Help / FAQ</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">
          Read posting guidelines, account information, and forum policies
          before opening a new thread.
        </p>
      </div>

      {documents.length === 0 ? (
        <ForumStatusBox
          title="No help documents"
          body="The forum help desk has no active documents yet."
        />
      ) : (
        <div className="border border-row-border">
          <div className="grid grid-cols-[minmax(0,1fr)_9rem] border-b border-row-border bg-muted/35 px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground">
            <span>Topic</span>
            <span className="text-right">Last edited</span>
          </div>
          <div className="divide-y divide-row-border">
            {documents.map((document) => (
              <article
                className="grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_9rem]"
                key={document._id}
              >
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">
                    <ForumLink href={forumHelpPath(document)} prefetch>
                      {document.title}
                    </ForumLink>
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                    {document.excerpt}
                  </p>
                </div>
                <div className="flex items-start justify-between gap-2 md:block md:text-right">
                  <p className="font-mono text-[10px] uppercase text-muted-foreground">
                    {formatForumDateTime(document.updatedAt)}
                  </p>
                  <Button
                    asChild
                    className="mt-0 h-7 rounded-none px-2 font-mono text-[10px] uppercase md:mt-2"
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
