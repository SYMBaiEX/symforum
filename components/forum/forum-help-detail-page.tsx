"use client";

import { formatForumDateTime, forumRefs } from "@/components/forum/forum-refs";
import {
  ForumBody,
  ForumLink,
  ForumLoading,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { useQuery } from "convex-helpers/react/cache/hooks";

export function ForumHelpDetailPage({
  enabled,
  slug,
}: {
  enabled: boolean;
  slug: string;
}) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Help desk unavailable"
        body="Convex is not configured in this checkout, so forum help documents cannot load."
        accent="cyan"
      />
    );
  }

  return <LiveForumHelpDetailPage slug={slug} />;
}

function LiveForumHelpDetailPage({ slug }: { slug: string }) {
  const document = useQuery(forumRefs.getHelpDocument, { slug });

  if (document === undefined) {
    return <ForumLoading label="Opening help topic" />;
  }

  if (document === null) {
    return (
      <ForumStatusBox
        title="Help topic not found"
        body="That help document is no longer active in the forum help desk."
        action={
          <Button
            asChild
            className="rounded-none font-mono text-[10px] uppercase"
            variant="outline"
          >
            <ForumLink href="/forum/help" prefetch>
              Help / FAQ
            </ForumLink>
          </Button>
        }
      />
    );
  }

  return (
    <article className="space-y-3">
      <div className="border-y border-row-border py-2">
        <p className="page-kicker">Forum helpdesk</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold md:text-2xl">
            {document.title}
          </h1>
          <span className="border border-row-border px-1.5 font-mono text-[10px] uppercase text-muted-foreground">
            FAQ
          </span>
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
          Updated {formatForumDateTime(document.updatedAt)}
        </p>
      </div>

      <div className="border-y border-row-border py-3">
        <ForumBody body={document.body} />
      </div>

      <Button
        asChild
        className="rounded-none font-mono text-[10px] uppercase"
        variant="outline"
      >
        <ForumLink href="/forum/help" prefetch>
          Help / FAQ
        </ForumLink>
      </Button>
    </article>
  );
}
