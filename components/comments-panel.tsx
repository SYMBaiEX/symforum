"use client";

import { reportAppError } from "@/components/app-error-surface";
import { AuthRequiredDialog } from "@/components/auth-required-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isAuthRequiredError, userFacingError } from "@/lib/auth-errors";
import {
  convexRefs,
  type CommentEntityType,
  type CommentStatus,
} from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Trash2,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

const ROOT_REPLY_PREVIEW = 6;
const NESTED_REPLY_PREVIEW = 4;
const MAX_INLINE_DEPTH = 5;

type CommentRecord = {
  _id: string;
  userId: string;
  entityType: CommentEntityType;
  entityId: string;
  parentId?: string;
  body: string;
  status: CommentStatus;
  updatedAt: number;
  deletedAt?: number;
  createdAt: number;
  author: string;
  viewerCanDelete: boolean;
  viewerCanModerate: boolean;
};

type ThreadComment = CommentRecord & {
  replies: ThreadComment[];
};

export function CommentsPanel({
  entityType,
  entityId,
  enabled,
}: {
  entityType: CommentEntityType;
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
  entityType: CommentEntityType;
  entityId: string;
}) {
  const pathname = usePathname();
  const comments = useQuery(convexRefs.comments.list, { entityType, entityId });
  const addComment = useMutation(convexRefs.comments.add);
  const softDeleteComment = useMutation(convexRefs.comments.softDelete);
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const [body, setBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBodies, setReplyBodies] = useState<Record<string, string>>({});
  const [replyErrors, setReplyErrors] = useState<Record<string, string>>({});
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const [authOpen, setAuthOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const redirectTo = pathname ?? commentRedirectPath(entityType, entityId);
  const thread = useMemo(
    () => buildCommentThread(comments ?? []),
    [comments],
  );

  async function submitComment(
    parentId: string | undefined,
    nextBody: string,
    afterSubmit: () => void,
  ) {
    const errorKey = parentId ?? "root";
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }
    setPending(true);
    clearError(errorKey);
    try {
      await addComment({
        entityType,
        entityId,
        body: nextBody,
        ...(parentId !== undefined ? { parentId } : {}),
      });
      afterSubmit();
      if (parentId !== undefined) {
        setExpandedById((current) => ({ ...current, [parentId]: true }));
      }
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "comments",
        eventType: parentId ? "reply_failed" : "comment_failed",
        component: "CommentsPanel",
        action: "comments:add",
        entityType,
        entityId,
        metadata: { parentId },
        notify: false,
      });
      setCommentError(errorKey, userFacingError(caught, "Could not comment"));
    } finally {
      setPending(false);
    }
  }

  async function deleteComment(commentId: string) {
    if (!isAuthenticated) {
      setAuthOpen(true);
      return;
    }
    const confirmed = window.confirm(
      "Delete this comment? Replies will stay attached to a deleted placeholder.",
    );
    if (!confirmed) {
      return;
    }
    setPending(true);
    setError("");
    try {
      await softDeleteComment({ commentId });
      setReplyingTo(null);
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "comments",
        eventType: "delete_failed",
        component: "CommentsPanel",
        action: "comments:softDelete",
        entityType,
        entityId,
        metadata: { commentId },
        notify: false,
      });
      setError(userFacingError(caught, "Could not delete comment"));
    } finally {
      setPending(false);
    }
  }

  function clearError(key: string) {
    if (key === "root") {
      setError("");
      return;
    }
    setReplyErrors((current) => ({ ...current, [key]: "" }));
  }

  function setCommentError(key: string, message: string) {
    if (key === "root") {
      setError(message);
      return;
    }
    setReplyErrors((current) => ({ ...current, [key]: message }));
  }

  function toggleExpanded(commentId: string) {
    setExpandedById((current) => ({
      ...current,
      [commentId]: !current[commentId],
    }));
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
            disabled={authLoading || pending || body.trim().length < 2}
          >
            Post comment
          </Button>
        </div>
        {error ? (
          <p className="border border-row-border p-2.5 text-sm text-muted-foreground">
            {error}
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
                replyErrors={replyErrors}
                replyingTo={replyingTo}
                replyBodies={replyBodies}
                expandedById={expandedById}
                requestAuth={() => setAuthOpen(true)}
                setReplyingTo={setReplyingTo}
                setReplyBodies={setReplyBodies}
                submitReply={submitComment}
                deleteComment={deleteComment}
                toggleExpanded={toggleExpanded}
                userCanReply={isAuthenticated && !authLoading}
              />
            ))}
            {comments.length >= 500 ? (
              <p className="pt-3 font-mono text-[10px] uppercase text-muted-foreground">
                Showing the first 500 indexed comments.
              </p>
            ) : null}
          </div>
        )}
      </div>
      <AuthRequiredDialog
        action="join the thread"
        open={authOpen}
        redirectTo={redirectTo}
        setOpen={setAuthOpen}
      />
    </div>
  );
}

function CommentThread({
  comment,
  depth,
  pending,
  replyErrors,
  replyingTo,
  replyBodies,
  expandedById,
  requestAuth,
  setReplyingTo,
  setReplyBodies,
  submitReply,
  deleteComment,
  toggleExpanded,
  userCanReply,
}: {
  comment: ThreadComment;
  depth: number;
  pending: boolean;
  replyErrors: Record<string, string>;
  replyingTo: string | null;
  replyBodies: Record<string, string>;
  expandedById: Record<string, boolean>;
  requestAuth: () => void;
  setReplyingTo: (commentId: string | null) => void;
  setReplyBodies: (value: Record<string, string>) => void;
  submitReply: (
    parentId: string | undefined,
    body: string,
    afterSubmit: () => void,
  ) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  toggleExpanded: (commentId: string) => void;
  userCanReply: boolean;
}) {
  const replyBody = replyBodies[comment._id] ?? "";
  const replyError = replyErrors[comment._id] ?? "";
  const isReplying = replyingTo === comment._id;
  const isDeleted = comment.status !== "active";
  const isExpanded = Boolean(expandedById[comment._id]);
  const depthLimited = depth >= MAX_INLINE_DEPTH && comment.replies.length > 0;
  const replyPreviewLimit =
    depth === 0 ? ROOT_REPLY_PREVIEW : NESTED_REPLY_PREVIEW;
  const canShowReplies = !depthLimited || isExpanded;
  const visibleReplies = canShowReplies
    ? isExpanded
      ? comment.replies
      : comment.replies.slice(0, replyPreviewLimit)
    : [];
  const hiddenReplies = comment.replies.length - visibleReplies.length;
  const showMoreButton =
    comment.replies.length > 0 && (hiddenReplies > 0 || isExpanded);

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
        depth > 0 && "border-l border-row-border pl-3 md:pl-4",
        depth > 0 && depth < MAX_INLINE_DEPTH && "ml-3 md:ml-5",
        depth >= MAX_INLINE_DEPTH && "ml-2 pl-3 md:ml-3",
      )}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
          <span>{comment.author}</span>
          <span>{formatDate(comment.deletedAt ?? comment.createdAt)}</span>
          {isDeleted ? <span>Deleted</span> : null}
        </div>
        {isDeleted ? (
          <p className="text-sm leading-6 text-muted-foreground">
            Comment deleted
          </p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-6 md:text-[0.95rem] md:leading-7">
            {comment.body}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {!isDeleted ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 rounded-none px-1.5 font-mono text-[10px] uppercase text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              onClick={() => {
                if (!userCanReply) {
                  requestAuth();
                  return;
                }
                setReplyingTo(isReplying ? null : comment._id);
              }}
            >
              <CornerDownRight aria-hidden="true" />
              Reply
            </Button>
          ) : null}
          {comment.viewerCanDelete && !isDeleted ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 rounded-none px-1.5 font-mono text-[10px] uppercase text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              disabled={pending}
              onClick={() => void deleteComment(comment._id)}
            >
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          ) : null}
        </div>
        {isReplying && !isDeleted ? (
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
            {replyError ? (
              <p className="border border-row-border p-2.5 text-sm text-muted-foreground">
                {replyError}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
      {visibleReplies.length > 0 ? (
        <div className="mt-1">
          {visibleReplies.map((reply) => (
            <CommentThread
              key={reply._id}
              comment={reply}
              depth={depth + 1}
              pending={pending}
              replyErrors={replyErrors}
              replyingTo={replyingTo}
              replyBodies={replyBodies}
              expandedById={expandedById}
              requestAuth={requestAuth}
              setReplyingTo={setReplyingTo}
              setReplyBodies={setReplyBodies}
              submitReply={submitReply}
              deleteComment={deleteComment}
              toggleExpanded={toggleExpanded}
              userCanReply={userCanReply}
            />
          ))}
        </div>
      ) : null}
      {showMoreButton ? (
        <div className={cn("mt-1", depth > 0 && "pl-1")}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={isExpanded}
            className="h-7 rounded-none px-1.5 font-mono text-[10px] uppercase text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            onClick={() => toggleExpanded(comment._id)}
          >
            {isExpanded ? (
              <ChevronDown aria-hidden="true" />
            ) : (
              <ChevronRight aria-hidden="true" />
            )}
            {isExpanded
              ? "Collapse replies"
              : depthLimited
                ? `Continue thread (${comment.replies.length})`
                : `View ${hiddenReplies} more replies`}
          </Button>
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

function commentRedirectPath(entityType: CommentEntityType, entityId: string) {
  if (entityType === "post") {
    return `/blog/${entityId}`;
  }
  if (entityType === "portfolioProject") {
    return `/portfolio/${entityId}`;
  }
  return `/news/${entityId}`;
}
