"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { convexRefs } from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { CornerDownRight } from "lucide-react";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

type CommentRecord = {
  _id: string;
  userId: string;
  entityType: "post" | "hnStory";
  entityId: string;
  parentId?: string;
  body: string;
  createdAt: number;
  author: string;
};

type ThreadComment = CommentRecord & {
  replies: ThreadComment[];
};

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
      <div className="border border-row-border p-3 text-sm text-muted-foreground">
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
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBodies, setReplyBodies] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const signinHref = `/signin?redirectTo=${encodeURIComponent(
    commentRedirectPath(entityType, entityId),
  )}`;
  const thread = useMemo(
    () => buildCommentThread(comments ?? []),
    [comments],
  );

  async function submitComment(
    parentId: string | undefined,
    nextBody: string,
    afterSubmit: () => void,
  ) {
    setPending(true);
    setError("");
    try {
      await addComment({
        entityType,
        entityId,
        body: nextBody,
        ...(parentId !== undefined ? { parentId } : {}),
      });
      afterSubmit();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not comment");
    } finally {
      setPending(false);
    }
  }

  function onRootSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitComment(undefined, body, () => {
      setBody("");
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={onRootSubmit} className="flex flex-col gap-2.5">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Start the thread..."
          rows={3}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Threaded replies attach to your SYM handle.
          </p>
          <Button
            type="submit"
            size="sm"
            disabled={pending || body.trim().length < 2}
          >
            Post comment
          </Button>
        </div>
        {error ? (
          <p className="border border-row-border p-2.5 text-sm text-muted-foreground">
            {error}{" "}
            <Link href={signinHref} className="underline">
              Sign in
            </Link>
          </p>
        ) : null}
      </form>
      <div>
        {comments === undefined ? (
          <p className="py-4 font-mono text-[11px] uppercase text-muted-foreground">
            Syncing thread
          </p>
        ) : comments.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <div className="space-y-1">
            {thread.map((comment) => (
              <CommentThread
                key={comment._id}
                comment={comment}
                depth={0}
                pending={pending}
                replyingTo={replyingTo}
                replyBodies={replyBodies}
                setReplyingTo={setReplyingTo}
                setReplyBodies={setReplyBodies}
                submitReply={submitComment}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentThread({
  comment,
  depth,
  pending,
  replyingTo,
  replyBodies,
  setReplyingTo,
  setReplyBodies,
  submitReply,
}: {
  comment: ThreadComment;
  depth: number;
  pending: boolean;
  replyingTo: string | null;
  replyBodies: Record<string, string>;
  setReplyingTo: (commentId: string | null) => void;
  setReplyBodies: (value: Record<string, string>) => void;
  submitReply: (
    parentId: string | undefined,
    body: string,
    afterSubmit: () => void,
  ) => Promise<void>;
}) {
  const replyBody = replyBodies[comment._id] ?? "";
  const isReplying = replyingTo === comment._id;

  function onReplySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitReply(comment._id, replyBody, () => {
      setReplyBodies({ ...replyBodies, [comment._id]: "" });
      setReplyingTo(null);
    });
  }

  return (
    <article
      className={cn(
        "relative py-3",
        depth > 0 &&
          "border-l border-row-border pl-3 md:pl-4",
        depth > 0 && depth < 5 && "ml-3 md:ml-5",
      )}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
          <span>{comment.author}</span>
          <span>{formatDate(comment.createdAt)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-6 md:text-[0.95rem] md:leading-7">
          {comment.body}
        </p>
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 rounded-none px-1.5 font-mono text-[10px] uppercase text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            onClick={() => setReplyingTo(isReplying ? null : comment._id)}
          >
            <CornerDownRight aria-hidden="true" />
            Reply
          </Button>
        </div>
        {isReplying ? (
          <form onSubmit={onReplySubmit} className="mt-2 flex flex-col gap-2">
            <Textarea
              value={replyBody}
              onChange={(event) =>
                setReplyBodies({
                  ...replyBodies,
                  [comment._id]: event.target.value,
                })
              }
              placeholder={`Reply to ${comment.author}...`}
              rows={2}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setReplyingTo(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={pending || replyBody.trim().length < 2}
              >
                Post reply
              </Button>
            </div>
          </form>
        ) : null}
      </div>
      {comment.replies.length > 0 ? (
        <div className="mt-1">
          {comment.replies.map((reply) => (
            <CommentThread
              key={reply._id}
              comment={reply}
              depth={depth + 1}
              pending={pending}
              replyingTo={replyingTo}
              replyBodies={replyBodies}
              setReplyingTo={setReplyingTo}
              setReplyBodies={setReplyBodies}
              submitReply={submitReply}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function buildCommentThread(comments: CommentRecord[]) {
  const byId = new Map<string, ThreadComment>();
  const roots: ThreadComment[] = [];

  comments.forEach((comment) => {
    byId.set(comment._id, { ...comment, replies: [] });
  });

  comments.forEach((comment) => {
    const node = byId.get(comment._id);
    if (node === undefined) {
      return;
    }
    const parent = comment.parentId ? byId.get(comment.parentId) : undefined;
    if (parent === undefined) {
      roots.push(node);
      return;
    }
    parent.replies.push(node);
  });

  return roots;
}

function commentRedirectPath(
  entityType: "post" | "hnStory",
  entityId: string,
) {
  return entityType === "post" ? `/blog/${entityId}` : `/news/${entityId}`;
}
