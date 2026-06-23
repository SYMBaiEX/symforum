"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { convexRefs } from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { FormEvent, useState } from "react";

export function CommentsPanel({
  entityType,
  entityId,
  enabled,
}: {
  entityType: "post" | "hnStory";
  entityId: string;
  enabled: boolean;
}) {
  if (!enabled) {
    return (
      <div className="border border-row-border p-4 text-sm text-muted-foreground">
        Connect Convex locally to enable comments and interactions.
      </div>
    );
  }
  return <LiveComments entityType={entityType} entityId={entityId} />;
}

function LiveComments({
  entityType,
  entityId,
}: {
  entityType: "post" | "hnStory";
  entityId: string;
}) {
  const comments = useQuery(convexRefs.comments.list, { entityType, entityId });
  const addComment = useMutation(convexRefs.comments.add);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await addComment({ entityType, entityId, body });
      setBody("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not comment");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Leave a sharp note..."
          rows={4}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Sign in with a SYM handle to comment.
          </p>
          <Button type="submit" disabled={pending || body.trim().length < 2}>
            Post comment
          </Button>
        </div>
        {error ? (
          <p className="border border-row-border p-3 text-sm text-muted-foreground">
            {error}{" "}
            <Link href="/signin" className="underline">
              Sign in
            </Link>
          </p>
        ) : null}
      </form>
      <div className="border-t border-row-border">
        {comments === undefined ? (
          <p className="py-5 font-mono text-xs uppercase text-muted-foreground">
            Loading comments
          </p>
        ) : comments.length === 0 ? (
          <p className="py-5 text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          comments.map((comment) => (
            <div key={comment._id} className="border-b border-row-border py-5">
              <div className="mb-2 flex flex-wrap items-center gap-3 font-mono text-xs uppercase text-muted-foreground">
                <span>{comment.author}</span>
                <span>{formatDate(comment.createdAt)}</span>
              </div>
              <p className="leading-7">{comment.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
