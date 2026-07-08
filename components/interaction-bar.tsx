"use client";

import { reportAppError } from "@/components/app-error-surface";
import { AuthRequiredDialog } from "@/components/auth-required-dialog";
import { Button } from "@/components/ui/button";
import { isAuthRequiredError } from "@/lib/auth-errors";
import { convexRefs } from "@/lib/convex-refs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Bookmark, ChevronDown, ChevronUp } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";

export function InteractionBar({
  entityType,
  entityId,
}: {
  entityType: "post" | "hnStory";
  entityId: string;
}) {
  const pathname = usePathname();
  const summary = useQuery(convexRefs.interactions.summary, {
    entityType,
    entityId,
  });
  const setInteraction = useMutation(convexRefs.interactions.set);
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const viewer = summary?.viewer;
  const vote: -1 | 0 | 1 =
    viewer?.vote === 1 ? 1 : viewer?.vote === -1 ? -1 : 0;
  const saved = viewer?.saved ?? false;
  const disabled = authLoading || (isAuthenticated && !summary) || pending;

  async function update(nextVote: -1 | 0 | 1, nextSaved = saved) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }
    setPending(true);
    setError("");
    try {
      await setInteraction({
        entityType,
        entityId,
        vote: nextVote,
        saved: nextSaved,
      });
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "interactions",
        eventType: "interaction_failed",
        component: "InteractionBar",
        action: "interactions:set",
        entityType,
        entityId,
        metadata: { vote: nextVote, saved: nextSaved },
        notify: false,
      });
      setError("Could not update interaction. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] uppercase">
        <Button
          variant={vote === 1 ? "default" : "outline"}
          size="sm"
          className="h-7 px-2"
          aria-label={vote === 1 ? "Remove upvote" : "Upvote"}
          aria-pressed={vote === 1}
          disabled={disabled}
          onClick={() => void update(vote === 1 ? 0 : 1)}
        >
          <ChevronUp />
          {summary?.score ?? 0}
        </Button>
        <Button
          variant={vote === -1 ? "default" : "outline"}
          size="sm"
          className="h-7 px-2"
          aria-label={vote === -1 ? "Remove downvote" : "Downvote"}
          aria-pressed={vote === -1}
          disabled={disabled}
          onClick={() => void update(vote === -1 ? 0 : -1)}
        >
          <ChevronDown />
        </Button>
        <Button
          variant={saved ? "secondary" : "outline"}
          size="sm"
          className="h-7 px-2"
          aria-label={saved ? "Unsave" : "Save"}
          aria-pressed={saved}
          disabled={disabled}
          onClick={() => void update(vote, !saved)}
        >
          <Bookmark />
          {summary?.saves ?? 0}
        </Button>
        {error ? (
          <span role="alert" className="text-[10px] text-muted-foreground">
            {error}
          </span>
        ) : null}
      </div>
      <AuthRequiredDialog
        action="vote, save, and comment"
        open={authOpen}
        redirectTo={pathname ?? "/"}
        setOpen={setAuthOpen}
      />
    </>
  );
}
