"use client";

import { ForumPageHeader } from "./forum-layout-primitives";

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
          <Button asChild className="rounded-xl text-xs" variant="outline">
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
      <ForumPageHeader
        title={document.title}
        description={`Updated ${formatForumDateTime(document.updatedAt)}`}
      />

      <div className="max-w-3xl rounded-xl bg-muted/25 p-4 sm:p-6">
        <ForumBody body={document.body} />
      </div>

      <Button asChild className="rounded-xl text-xs" variant="outline">
        <ForumLink href="/forum/help" prefetch>
          Help / FAQ
        </ForumLink>
      </Button>
    </article>
  );
}
