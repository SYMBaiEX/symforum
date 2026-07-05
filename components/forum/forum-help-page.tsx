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
import { useQuery } from "convex/react";

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
    <div className="space-y-6">
      <div className="border-y border-row-border py-4">
        <p className="page-kicker">Forum helpdesk</p>
        <h1 className="mt-2 text-2xl font-semibold md:text-3xl">
          Help / FAQ
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
          Read the board customs, account notes, and posting lore before opening
          a new thread.
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
                className="grid gap-3 px-3 py-4 md:grid-cols-[minmax(0,1fr)_9rem]"
                key={document._id}
              >
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">
                    <ForumLink href={forumHelpPath(document)} prefetch>
                      {document.title}
                    </ForumLink>
                  </h2>
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">
                    {document.excerpt}
                  </p>
                </div>
                <div className="flex items-start justify-between gap-3 md:block md:text-right">
                  <p className="font-mono text-[10px] uppercase text-muted-foreground">
                    {formatForumDateTime(document.updatedAt)}
                  </p>
                  <Button
                    asChild
                    className="mt-0 h-7 rounded-none px-2 font-mono text-[10px] uppercase md:mt-3"
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
