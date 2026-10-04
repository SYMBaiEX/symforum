"use client";

import { useState } from "react";
import { useConvexAuth } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { MessageSquare, Plus, ChevronDown } from "lucide-react";
import { ForumLink } from "./forum-link";
import { forumRefs, forumPath } from "./forum-refs";

/** A feed entry point into the existing board composer and its draft/status flow. */
export function ForumFeedStarter() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const overview = useQuery(forumRefs.overview, isLoading ? "skip" : {});
  const [selectedBoard, setSelectedBoard] = useState("");
  const boards =
    overview?.categories.filter(
      (board) =>
        board.kind !== "section" &&
        board.status === "active" &&
        board.isPostable &&
        (!isAuthenticated || board.viewerCanCreateThread === true),
    ) ?? [];
  const board =
    boards.find((item) => item.slug === selectedBoard) ??
    boards.find((item) => item.slug === "general") ??
    boards[0];
  return (
    <details className="forum-feed-starter forum-post-card">
      <summary className="forum-feed-starter-summary focus-ring">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MessageSquare className="size-4" aria-hidden="true" />
        </span>
        <span className="text-sm text-muted-foreground">
          Start a conversation…
        </span>
        <span className="flex min-h-11 shrink-0 items-center gap-1 text-xs font-semibold text-primary">
          Post <Plus className="size-4" aria-hidden="true" />
        </span>
      </summary>
      <div className="forum-feed-starter-options">
        {board ? (
          <>
            <label className="flex min-h-11 min-w-0 items-center gap-2 text-xs text-muted-foreground">
              In
              <select
                aria-label="Choose a board for your post"
                className="focus-ring min-h-11 max-w-48 rounded-lg bg-muted/50 px-3 text-sm text-foreground"
                value={board.slug}
                onChange={(event) => setSelectedBoard(event.target.value)}
              >
                {boards.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {[
              { kind: "discussion", label: "Share a thought" },
              { kind: "question", label: "Ask a question" },
              { kind: "link", label: "Share a link" },
            ].map(({ kind, label }) => {
              const href = `${forumPath(board.slug)}?compose=1&kind=${kind}`;
              return (
                <ForumLink
                  key={kind}
                  href={
                    isAuthenticated
                      ? href
                      : `/signin?${new URLSearchParams({ redirectTo: href })}`
                  }
                  className="forum-action-pill focus-ring min-h-11 text-primary"
                >
                  {label}
                </ForumLink>
              );
            })}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isLoading || overview === undefined
              ? "Loading boards…"
              : "No boards are available for posting with this profile."}
          </p>
        )}
        <ForumLink
          href="/forum?view=boards"
          className="focus-ring inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Browse boards <ChevronDown className="size-3" aria-hidden="true" />
        </ForumLink>
      </div>
    </details>
  );
}
