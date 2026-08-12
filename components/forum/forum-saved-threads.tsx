"use client";

import { reportAppError } from "@/components/app-error-surface";
import {
  forumPath,
  forumRefs,
  formatForumCount,
  formatForumDateTime,
  getThreadAuthor,
  getThreadLastActivityAt,
  getThreadLastAuthor,
  getThreadLastPostHref,
  getThreadReplyCount,
  getThreadStartedAt,
  type ForumCategoryRecord,
  type ForumThreadSummaryRecord,
} from "@/components/forum/forum-refs";
import {
  ForumBreadcrumbs,
  ForumLink,
  ForumLoading,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { userFacingError } from "@/lib/auth-errors";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useConvexAuth, useMutation } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const savedCategory: ForumCategoryRecord = {
  slug: "saved",
  name: "Saved threads",
  description: "Your private reading list from across the forum.",
};

export function ForumSavedThreads({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Local forum disabled"
        body="Convex is not configured locally, so saved threads cannot load."
        accent="cyan"
      />
    );
  }

  return <LiveForumSavedThreads />;
}

function LiveForumSavedThreads() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const pathname = usePathname();
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const bookmarks = useQuery(
    forumRefs.listMyThreadBookmarks,
    isAuthenticated ? { limit: 40 } : "skip",
  );
  const setThreadBookmark = useMutation(forumRefs.setThreadBookmark);
  const signInHref = `/signin?${new URLSearchParams({
    redirectTo: pathname ?? "/forum/saved",
  }).toString()}`;

  async function removeBookmark(thread: ForumThreadSummaryRecord) {
    const threadId = thread._id ?? thread.threadId;
    if (!threadId) {
      setActionError("Could not remove this saved thread.");
      return;
    }

    setPendingThreadId(threadId);
    setActionError("");
    try {
      const result = await setThreadBookmark({ threadId, saved: false });
      if (result.saved) {
        throw new Error("The saved thread could not be removed.");
      }
      toast.success("Removed from saved threads", {
        description: thread.title,
      });
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "thread_bookmark_failed",
        component: "ForumSavedThreads",
        action: "forum:setThreadBookmark",
        entityType: "forumThread",
        entityId: threadId,
        metadata: { threadSlug: thread.slug, source: "saved" },
        notify: false,
      });
      const message = userFacingError(caught, "Could not remove saved thread");
      setActionError(message);
      toast.error("Remove failed", { description: message });
    } finally {
      setPendingThreadId(null);
    }
  }

  if (isLoading) {
    return (
      <ForumLoading label="Checking forum session" variant="subscriptions" />
    );
  }

  if (!isAuthenticated) {
    return (
      <ForumStatusBox
        title="Sign in required"
        body="Sign in with your SYM handle to keep a private reading list."
        action={
          <Button
            asChild
            className="rounded-none font-mono text-[10px] uppercase"
            variant="outline"
          >
            <Link href={signInHref}>Sign in</Link>
          </Button>
        }
      />
    );
  }

  if (bookmarks === undefined) {
    return (
      <ForumLoading label="Syncing saved threads" variant="subscriptions" />
    );
  }

  return (
    <div className="space-y-3">
      <ForumBreadcrumbs category={savedCategory} />
      {actionError ? (
        <p
          className="border border-row-border px-3 py-2.5 text-sm text-muted-foreground"
          role="alert"
        >
          <span className="font-mono text-[10px] uppercase text-foreground">
            Action failed /{" "}
          </span>
          {actionError}
        </p>
      ) : null}
      {bookmarks.threads.length === 0 ? (
        <ForumStatusBox
          title="Saved threads"
          body="No saved threads yet. Use Save on any thread to add it to this private reading list."
        />
      ) : (
        <section className="border border-row-border">
          <div className="border-b border-row-border px-4 py-3">
            <h2 className="font-mono text-[11px] uppercase text-muted-foreground">
              Saved threads
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A private reading list. Saving does not turn on reply alerts.
            </p>
          </div>
          <div className="divide-y divide-row-border">
            {bookmarks.threads.map((thread) => {
              const threadId = thread._id;
              return (
                <SavedThreadRow
                  key={threadId ?? thread.slug}
                  onRemove={removeBookmark}
                  pending={threadId === pendingThreadId}
                  thread={thread}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function SavedThreadRow({
  onRemove,
  pending,
  thread,
}: {
  onRemove: (thread: ForumThreadSummaryRecord) => void;
  pending: boolean;
  thread: ForumThreadSummaryRecord;
}) {
  const categorySlug = thread.categorySlug;
  const threadHref = forumPath(categorySlug, thread.slug);
  const lastPostHref = getThreadLastPostHref(thread, categorySlug);

  return (
    <div className="grid gap-3 px-4 py-3 odd:bg-muted/15 md:grid-cols-[minmax(0,1fr)_8rem_8rem_11rem_auto] md:items-center">
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Saved thread / {thread.categoryName ?? categorySlug ?? "Forum"}
        </p>
        <ForumLink
          className="focus-ring mt-1 block truncate text-sm font-semibold hover:text-primary md:text-base"
          href={threadHref}
          prefetch
        >
          {thread.title}
        </ForumLink>
      </div>
      <div className="grid grid-cols-2 gap-px bg-row-border text-center font-mono text-[10px] uppercase text-muted-foreground md:grid-cols-1">
        <div className="bg-background px-3 py-2">
          <p>Replies</p>
          <p className="mt-1 text-foreground">
            {formatForumCount(getThreadReplyCount(thread))}
          </p>
        </div>
        <div className="bg-background px-3 py-2">
          <p>Views</p>
          <p className="mt-1 text-foreground">
            {formatForumCount(thread.viewCount)}
          </p>
        </div>
      </div>
      <div className="font-mono text-[10px] uppercase leading-5 text-muted-foreground">
        <p>Starter</p>
        <p className="truncate text-foreground">{getThreadAuthor(thread)}</p>
        <p>{formatForumDateTime(getThreadStartedAt(thread))}</p>
      </div>
      <div className="font-mono text-[10px] uppercase leading-5 text-muted-foreground">
        <p>Last post</p>
        <p className="truncate text-foreground">
          {getThreadLastAuthor(thread)}
        </p>
        <p>{formatForumDateTime(getThreadLastActivityAt(thread))}</p>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        <Button
          asChild
          className="h-7 rounded-none font-mono text-[10px] uppercase"
          size="sm"
          variant="outline"
        >
          <ForumLink href={lastPostHref} prefetch>
            Last
          </ForumLink>
        </Button>
        <Button
          asChild
          className="h-7 rounded-none font-mono text-[10px] uppercase"
          size="sm"
          variant="outline"
        >
          <ForumLink href={threadHref} prefetch>
            Open
          </ForumLink>
        </Button>
        <Button
          className="h-7 rounded-none font-mono text-[10px] uppercase"
          disabled={pending}
          onClick={() => onRemove(thread)}
          size="sm"
          type="button"
          variant="outline"
        >
          {pending ? "Saving..." : "Remove"}
        </Button>
      </div>
    </div>
  );
}
