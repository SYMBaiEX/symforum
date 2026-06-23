"use client";

import { Button } from "@/components/ui/button";
import { convexRefs } from "@/lib/convex-refs";
import { useMutation, useQuery } from "convex/react";
import { Bookmark, ChevronDown, ChevronUp } from "lucide-react";

export function InteractionBar({
  entityType,
  entityId,
}: {
  entityType: "post" | "hnStory";
  entityId: string;
}) {
  const summary = useQuery(convexRefs.interactions.summary, {
    entityType,
    entityId,
  });
  const setInteraction = useMutation(convexRefs.interactions.set);
  const viewer = summary?.viewer;
  const vote: -1 | 0 | 1 =
    viewer?.vote === 1 ? 1 : viewer?.vote === -1 ? -1 : 0;
  const saved = viewer?.saved ?? false;

  const update = (nextVote: -1 | 0 | 1, nextSaved = saved) => {
    void setInteraction({
      entityType,
      entityId,
      vote: nextVote,
      saved: nextSaved,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-xs uppercase">
      <Button
        variant={vote === 1 ? "default" : "outline"}
        size="sm"
        onClick={() => update(vote === 1 ? 0 : 1)}
      >
        <ChevronUp />
        {summary?.score ?? 0}
      </Button>
      <Button
        variant={vote === -1 ? "default" : "outline"}
        size="sm"
        onClick={() => update(vote === -1 ? 0 : -1)}
        aria-label="Downvote"
      >
        <ChevronDown />
      </Button>
      <Button
        variant={saved ? "secondary" : "outline"}
        size="sm"
        onClick={() => update(vote, !saved)}
      >
        <Bookmark />
        {summary?.saves ?? 0}
      </Button>
    </div>
  );
}
