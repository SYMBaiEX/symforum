"use client";

import { reportAppError } from "@/components/app-error-surface";
import { AuthRequiredDialog } from "@/components/auth-required-dialog";
import {
  ForumAttachmentDraftPanel,
  ForumCompose,
  type ForumAttachmentDraft,
} from "@/components/forum/forum-compose";
import { MAX_FORUM_ATTACHMENTS } from "@/components/forum/forum-attachment-upload";
import {
  forumPath,
  forumMemberProfilePath,
  forumPostPath,
  forumRefs,
  formatForumDateTime,
  getCategoryDescription,
  getCategoryTitle,
  getPostNumber,
  getPostTimestamp,
  getRenderablePosts,
  getThreadAuthor,
  getThreadPostCount,
  getThreadRatingAverage,
  getThreadRatingCount,
  getThreadReplyCount,
  formatThreadRating,
  isLockedThread,
  type ForumCategoryRecord,
  type ForumAttachmentRecord,
  type ForumPostRecord,
  type ForumPollRecord,
  type ForumReportTarget,
  type ForumThreadRecord,
  type ForumThreadPrefixRecord,
} from "@/components/forum/forum-refs";
import {
  ForumAnnouncementPanel,
  ForumAttachmentList,
  ForumBody,
  ForumBreadcrumbs,
  ForumJumpLink,
  ForumLoading,
  ForumMetricBar,
  ForumPaginationBar,
  ForumPostFrame,
  ForumStatusBox,
  ForumThreadRatingSummary,
  ForumThreadPrefixBadge,
  ForumThreadStateBadges,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isAuthRequiredError, userFacingError } from "@/lib/auth-errors";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Paperclip, Star, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const POSTS_PER_PAGE = 20;
const MAX_QUOTED_BODY_CHARS = 2_000;
const MAX_REPUTATION_COMMENT_CHARS = 180;

type QueuedQuote = {
  key: string;
  label: string;
  quote: string;
};

type ReputationScore = -1 | 0 | 1;
type ThreadRatingScore = 1 | 2 | 3 | 4 | 5;

type ReputationDraft = {
  label: string;
  post: ForumPostRecord;
  score: Exclude<ReputationScore, 0>;
};

export function ForumThreadView({
  categorySlug,
  threadSlug,
  enabled,
}: {
  categorySlug: string;
  threadSlug: string;
  enabled: boolean;
}) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Local forum disabled"
        body="Convex is not configured locally, so this thread route is rendering a disabled shell."
        accent="cyan"
      />
    );
  }

  return (
    <LiveForumThreadView categorySlug={categorySlug} threadSlug={threadSlug} />
  );
}

function LiveForumThreadView({
  categorySlug,
  threadSlug,
}: {
  categorySlug: string;
  threadSlug: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const postPage = parsePage(searchParams.get("postPage"));
  const threadQueryArgs = useMemo(
    () => ({
      categorySlug,
      threadSlug,
      page: postPage,
      pageSize: POSTS_PER_PAGE,
    }),
    [categorySlug, postPage, threadSlug],
  );
  const authRedirectTo = useMemo(
    () =>
      currentForumRedirectTo(
        pathname,
        searchParams,
        forumPath(categorySlug, threadSlug),
      ),
    [categorySlug, pathname, searchParams, threadSlug],
  );
  const detail = useQuery(forumRefs.getThread, threadQueryArgs);
  const threadPrefixes = useQuery(forumRefs.listThreadPrefixes, {
    categorySlug,
  });
  const reply = useMutation(forumRefs.reply);
  const recordThreadView = useMutation(forumRefs.recordThreadView);
  const markThreadRead = useMutation(forumRefs.markThreadRead);
  const toggleThreadSubscription = useMutation(
    forumRefs.toggleThreadSubscription,
  );
  const votePoll = useMutation(forumRefs.votePoll);
  const updatePollContent = useMutation(forumRefs.updatePollContent);
  const rateThread = useMutation(forumRefs.rateThread);
  const setForumReputation = useMutation(forumRefs.setForumReputation);
  const updateThreadContent = useMutation(forumRefs.updateThreadContent);
  const updatePostContent = useMutation(forumRefs.updatePostContent);
  const deleteThread = useMutation(forumRefs.deleteThread);
  const deletePost = useMutation(forumRefs.deletePost);
  const createReport = useMutation(forumRefs.createReport);
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const [replyBody, setReplyBody] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<
    ForumAttachmentDraft[]
  >([]);
  const [replyPreviewOpen, setReplyPreviewOpen] = useState(false);
  const [queuedQuotes, setQueuedQuotes] = useState<QueuedQuote[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [authAction, setAuthAction] = useState("reply to this thread");
  const [pending, setPending] = useState(false);
  const [subscriptionPending, setSubscriptionPending] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState("");
  const [pollPending, setPollPending] = useState(false);
  const [pollError, setPollError] = useState("");
  const [ratingPending, setRatingPending] = useState(false);
  const [ratingError, setRatingError] = useState("");
  const [selectedPollOptionId, setSelectedPollOptionId] = useState("");
  const [editingPoll, setEditingPoll] = useState(false);
  const [editPollQuestion, setEditPollQuestion] = useState("");
  const [editPollOptions, setEditPollOptions] = useState(["", ""]);
  const [editPollPending, setEditPollPending] = useState(false);
  const [editPollError, setEditPollError] = useState("");
  const [replyError, setReplyError] = useState("");
  const [editingThread, setEditingThread] = useState(false);
  const [editThreadPrefixId, setEditThreadPrefixId] = useState("none");
  const [editThreadInitialPrefixId, setEditThreadInitialPrefixId] =
    useState("none");
  const [editThreadTitle, setEditThreadTitle] = useState("");
  const [editThreadBody, setEditThreadBody] = useState("");
  const [editThreadReason, setEditThreadReason] = useState("");
  const [editThreadExistingAttachments, setEditThreadExistingAttachments] =
    useState<ForumAttachmentRecord[]>([]);
  const [editThreadNewAttachments, setEditThreadNewAttachments] = useState<
    ForumAttachmentDraft[]
  >([]);
  const [editThreadPreviewOpen, setEditThreadPreviewOpen] = useState(false);
  const [editThreadError, setEditThreadError] = useState("");
  const [editThreadPending, setEditThreadPending] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostBody, setEditPostBody] = useState("");
  const [editPostReason, setEditPostReason] = useState("");
  const [editPostExistingAttachments, setEditPostExistingAttachments] =
    useState<ForumAttachmentRecord[]>([]);
  const [editPostNewAttachments, setEditPostNewAttachments] = useState<
    ForumAttachmentDraft[]
  >([]);
  const [editPostPreviewOpen, setEditPostPreviewOpen] = useState(false);
  const [editPostError, setEditPostError] = useState("");
  const [editPostPending, setEditPostPending] = useState(false);
  const [reportTarget, setReportTarget] = useState<ForumReportTarget | null>(
    null,
  );
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportPending, setReportPending] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reputationDraft, setReputationDraft] =
    useState<ReputationDraft | null>(null);
  const [reputationComment, setReputationComment] = useState("");
  const [reputationError, setReputationError] = useState("");
  const [reputationPendingKey, setReputationPendingKey] = useState<
    string | null
  >(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recordedThreadId = useRef<string | null>(null);
  const markedReadKey = useRef<string | null>(null);
  const posts = useMemo(
    () =>
      detail
        ? getRenderablePosts(detail.thread, detail.replies.page, {
            includeRoot: detail.replies.pagination.page === 1,
          })
        : [],
    [detail],
  );
  const highestViewedPostNumber = useMemo(
    () =>
      posts.reduce(
        (highest, post, index) => Math.max(highest, getPostNumber(post, index)),
        0,
      ),
    [posts],
  );
  const queuedQuoteKeys = useMemo(
    () => new Set(queuedQuotes.map((quote) => quote.key)),
    [queuedQuotes],
  );
  const editPrefixOptions = useMemo(() => {
    const prefixes = threadPrefixes ?? [];
    const currentPrefix = detail?.thread?.prefix;
    if (
      !currentPrefix?._id ||
      prefixes.some((prefix) => prefix._id === currentPrefix._id)
    ) {
      return prefixes;
    }
    return [currentPrefix, ...prefixes];
  }, [detail?.thread?.prefix, threadPrefixes]);

  useEffect(() => {
    const poll = detail?.poll;
    setPollError("");
    if (editingPoll && (!poll || !poll.viewerCanEdit)) {
      setEditingPoll(false);
      setEditPollError("");
    }
    if (!editingPoll || !poll?.viewerCanEdit) {
      setEditPollQuestion(poll?.question ?? "");
      setEditPollOptions(
        poll?.options.map((option) => option.label) ?? ["", ""],
      );
      setEditPollError("");
    }
    setSelectedPollOptionId((current) => {
      if (!poll) {
        return "";
      }
      if (poll.viewerOptionId) {
        return poll.viewerOptionId;
      }
      return poll.options.some((option) => option._id === current)
        ? current
        : "";
    });
  }, [detail?.poll, editingPoll]);

  useEffect(() => {
    const threadId = detail?.thread?._id;
    if (
      !threadId ||
      !isAuthenticated ||
      recordedThreadId.current === threadId
    ) {
      return;
    }
    recordedThreadId.current = threadId;
    void recordThreadView({ threadId }).catch((caught) => {
      reportAppError(caught, {
        scope: "forum",
        eventType: "thread_view_record_failed",
        component: "ForumThreadView",
        action: "forum:recordThreadView",
        entityType: "forumThread",
        entityId: threadId,
        notify: false,
      });
    });
  }, [detail?.thread?._id, isAuthenticated, recordThreadView]);

  useEffect(() => {
    const threadId = detail?.thread?._id;
    const readKey = `${threadId}:${highestViewedPostNumber}`;
    if (
      !threadId ||
      !isAuthenticated ||
      highestViewedPostNumber <= 0 ||
      markedReadKey.current === readKey
    ) {
      return;
    }
    markedReadKey.current = readKey;
    void markThreadRead({
      threadId,
      lastReadPostNumber: highestViewedPostNumber,
    }).catch((caught) => {
      reportAppError(caught, {
        scope: "forum",
        eventType: "thread_mark_read_failed",
        component: "ForumThreadView",
        action: "forum:markThreadRead",
        entityType: "forumThread",
        entityId: threadId,
        notify: false,
      });
    });
  }, [
    detail?.thread?._id,
    highestViewedPostNumber,
    isAuthenticated,
    markThreadRead,
  ]);

  async function submitReply(threadId: string) {
    if (!isAuthenticated) {
      setAuthAction("reply to this thread");
      setAuthOpen(true);
      return;
    }
    const currentCategory = detail?.category;
    const currentThread = detail?.thread;
    if (!currentCategory || !currentThread) {
      setReplyError("This thread is not ready for replies yet.");
      return;
    }
    const currentThreadLocked = isLockedThread(currentThread);
    if (currentThreadLocked || currentThread.viewerCanReply !== true) {
      setReplyError(
        replyUnavailableMessage(
          currentCategory,
          currentThreadLocked,
          isAuthenticated,
        ),
      );
      return;
    }
    if (replyBody.trim().length < 2) {
      setReplyError("Write a reply before posting.");
      return;
    }
    setPending(true);
    setReplyError("");
    try {
      const result = await reply({
        threadId,
        body: replyBody.trim(),
        attachments: replyAttachments.map(({ storageId, filename }) => ({
          storageId,
          filename,
        })),
      });
      setReplyBody("");
      setReplyAttachments([]);
      setQueuedQuotes([]);
      setReplyPreviewOpen(false);
      setReplyError("");
      if (result.status === "pending") {
        setReplyError(
          "Reply submitted for approval. It will appear after a moderator approves it.",
        );
        return;
      }
      router.push(
        forumPostPath(
          categorySlug,
          threadSlug,
          result.postNumber,
          result.postPage,
        ),
      );
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "reply_failed",
        component: "ForumThreadView",
        action: "forum:reply",
        metadata: { categorySlug, threadSlug },
        notify: false,
      });
      setReplyError(userFacingError(caught, "Could not post reply"));
    } finally {
      setPending(false);
    }
  }

  async function toggleSubscription(threadId: string) {
    if (!isAuthenticated) {
      setAuthAction("subscribe to this thread");
      setAuthOpen(true);
      return;
    }
    setSubscriptionPending(true);
    setSubscriptionError("");
    try {
      await toggleThreadSubscription({ threadId });
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("subscribe to this thread");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "thread_subscription_failed",
        component: "ForumThreadView",
        action: "forum:toggleThreadSubscription",
        entityType: "forumThread",
        entityId: threadId,
        notify: false,
      });
      setSubscriptionError(
        userFacingError(caught, "Could not update subscription"),
      );
    } finally {
      setSubscriptionPending(false);
    }
  }

  function openThreadEditor() {
    if (!detail?.thread) {
      return;
    }
    const currentPrefixId = detail.thread.prefix?._id ?? "none";
    setEditThreadPrefixId(currentPrefixId);
    setEditThreadInitialPrefixId(currentPrefixId);
    setEditThreadTitle(detail.thread.title);
    setEditThreadBody(detail.thread.body ?? "");
    setEditThreadReason("");
    setEditThreadExistingAttachments(detail.thread.attachments ?? []);
    setEditThreadNewAttachments([]);
    setEditThreadPreviewOpen(false);
    setEditThreadError("");
    setEditingThread(true);
  }

  async function submitThreadEdit(threadId: string) {
    setEditThreadPending(true);
    setEditThreadError("");
    try {
      await updateThreadContent({
        threadId,
        ...(editThreadPrefixId === editThreadInitialPrefixId
          ? {}
          : {
              prefixId:
                editThreadPrefixId === "none" ? null : editThreadPrefixId,
            }),
        title: editThreadTitle.trim(),
        body: editThreadBody.trim(),
        attachmentIdsToKeep: editThreadExistingAttachments.map(
          (attachment) => attachment._id,
        ),
        attachments: editThreadNewAttachments.map(({ storageId, filename }) => ({
          storageId,
          filename,
        })),
        editReason: editThreadReason.trim() || undefined,
      });
      setEditingThread(false);
      setEditThreadReason("");
      setEditThreadExistingAttachments([]);
      setEditThreadNewAttachments([]);
      setEditThreadPreviewOpen(false);
      setEditThreadError("");
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("edit this thread");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "thread_edit_failed",
        component: "ForumThreadView",
        action: "forum:updateThreadContent",
        entityType: "forumThread",
        entityId: threadId,
        notify: false,
      });
      setEditThreadError(userFacingError(caught, "Could not edit thread"));
    } finally {
      setEditThreadPending(false);
    }
  }

  async function removeThread(
    threadId: string,
    categorySlugForRedirect: string,
  ) {
    if (!window.confirm("Delete this starter thread?")) {
      return;
    }
    try {
      const result = await deleteThread({ threadId });
      router.push(forumPath(result.categorySlug || categorySlugForRedirect));
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("delete this thread");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "thread_delete_failed",
        component: "ForumThreadView",
        action: "forum:deleteThread",
        entityType: "forumThread",
        entityId: threadId,
        notify: false,
      });
      setReplyError(userFacingError(caught, "Could not delete thread"));
    }
  }

  function appendReplyText(text: string) {
    setReplyBody((current) =>
      current.trim().length === 0 ? text : `${current.trimEnd()}\n\n${text}`,
    );
    setReplyPreviewOpen(false);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        document
          .getElementById("forum-reply-composer")
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
        replyTextareaRef.current?.focus();
      });
    }
  }

  function quotePost(post: ForumPostRecord) {
    if (threadLocked) {
      return;
    }
    appendReplyText(buildPostQuote(post));
  }

  function toggleQueuedQuote(post: ForumPostRecord, postNumber: number) {
    if (threadLocked) {
      return;
    }
    const key = getPostQuoteKey(post, postNumber);
    setQueuedQuotes((current) => {
      if (current.some((quote) => quote.key === key)) {
        return current.filter((quote) => quote.key !== key);
      }
      return [
        ...current,
        {
          key,
          label: `#${postNumber} · ${getThreadAuthor(post)}`,
          quote: buildPostQuote(post),
        },
      ];
    });
  }

  function insertQueuedQuotes() {
    if (threadLocked || queuedQuotes.length === 0) {
      return;
    }
    appendReplyText(queuedQuotes.map((quote) => quote.quote).join("\n\n"));
    setQueuedQuotes([]);
  }

  function openPostEditor(post: ForumPostRecord) {
    const postId = forumPostId(post);
    if (!postId) {
      openThreadEditor();
      return;
    }
    setEditingPostId(postId);
    setEditPostBody(post.body);
    setEditPostReason("");
    setEditPostExistingAttachments(post.attachments ?? []);
    setEditPostNewAttachments([]);
    setEditPostPreviewOpen(false);
    setEditPostError("");
  }

  async function submitPostEdit(postId: string) {
    setEditPostPending(true);
    setEditPostError("");
    try {
      await updatePostContent({
        postId,
        body: editPostBody.trim(),
        attachmentIdsToKeep: editPostExistingAttachments.map(
          (attachment) => attachment._id,
        ),
        attachments: editPostNewAttachments.map(({ storageId, filename }) => ({
          storageId,
          filename,
        })),
        editReason: editPostReason.trim() || undefined,
      });
      setEditingPostId(null);
      setEditPostBody("");
      setEditPostReason("");
      setEditPostExistingAttachments([]);
      setEditPostNewAttachments([]);
      setEditPostPreviewOpen(false);
      setEditPostError("");
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("edit this reply");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "post_edit_failed",
        component: "ForumThreadView",
        action: "forum:updatePostContent",
        entityType: "forumPost",
        entityId: postId,
        notify: false,
      });
      setEditPostError(userFacingError(caught, "Could not edit reply"));
    } finally {
      setEditPostPending(false);
    }
  }

  async function removePost(post: ForumPostRecord) {
    const postId = forumPostId(post);
    if (!postId) {
      if (detail?.thread && detail.category) {
        await removeThread(detail.thread._id, detail.category.slug);
      }
      return;
    }
    if (!window.confirm("Delete this reply?")) {
      return;
    }
    try {
      await deletePost({ postId });
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("delete this reply");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "post_delete_failed",
        component: "ForumThreadView",
        action: "forum:deletePost",
        entityType: "forumPost",
        entityId: postId,
        notify: false,
      });
      setReplyError(userFacingError(caught, "Could not delete reply"));
    }
  }

  function openReport(target: ForumReportTarget) {
    if (!isAuthenticated) {
      setAuthAction("report forum content");
      setAuthOpen(true);
      return;
    }
    setReportTarget(target);
    setReportReason("");
    setReportDetails("");
    setReportError("");
  }

  async function submitReport() {
    if (!reportTarget) {
      return;
    }
    if (reportReason.trim().length < 3) {
      setReportError("Add a short reason so moderation has a clear signal.");
      return;
    }
    setReportPending(true);
    setReportError("");
    try {
      await createReport({
        entityType: reportTarget.entityType,
        threadId: reportTarget.threadId,
        postId: reportTarget.postId,
        reason: reportReason.trim(),
        details: reportDetails.trim() || undefined,
      });
      setReportTarget(null);
      setReportReason("");
      setReportDetails("");
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("report forum content");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "report_failed",
        component: "ForumThreadView",
        action: "forum:createReport",
        entityType: "forumThread",
        entityId: reportTarget.threadId,
        metadata: { reportEntityType: reportTarget.entityType },
        notify: false,
      });
      setReportError(userFacingError(caught, "Could not send report"));
    } finally {
      setReportPending(false);
    }
  }

  async function updateThreadRating(score: ThreadRatingScore) {
    if (!isAuthenticated) {
      setAuthAction("rate this thread");
      setAuthOpen(true);
      return;
    }
    if (!detail?.thread) {
      return;
    }

    setRatingPending(true);
    setRatingError("");
    try {
      await rateThread({
        threadId: detail.thread._id,
        score: detail.thread.viewerRating === score ? null : score,
      });
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("rate this thread");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "forum_thread_rating_failed",
        component: "ForumThreadView",
        action: "forum:rateThread",
        entityType: "forumThread",
        entityId: detail.thread._id,
        notify: false,
      });
      const message = userFacingError(caught, "Could not update thread rating");
      setRatingError(message);
    } finally {
      setRatingPending(false);
    }
  }

  function openReputationDialog(
    post: ForumPostRecord,
    score: Exclude<ReputationScore, 0>,
    postNumber: number,
  ) {
    if (!isAuthenticated) {
      setAuthAction("rate this post");
      setAuthOpen(true);
      return;
    }
    if (post.viewerReputationScore === score) {
      void updatePostReputation(post, score);
      return;
    }
    setReputationDraft({
      label:
        postNumber === 1
          ? `Thread: ${detail?.thread?.title ?? "Forum thread"}`
          : `Reply #${postNumber}`,
      post,
      score,
    });
    setReputationComment("");
    setReputationError("");
  }

  async function updatePostReputation(
    post: ForumPostRecord,
    score: Exclude<ReputationScore, 0>,
    comment?: string,
  ) {
    if (!isAuthenticated) {
      setAuthAction("rate this post");
      setAuthOpen(true);
      return false;
    }
    if (!detail?.thread) {
      return false;
    }
    const postId = forumPostId(post);
    const targetType = postId === null ? "thread" : "post";
    const targetKey = `${targetType}:${postId ?? detail.thread._id}`;
    const nextScore: ReputationScore =
      post.viewerReputationScore === score ? 0 : score;

    setReputationPendingKey(targetKey);
    setReputationError("");
    try {
      await setForumReputation({
        targetType,
        threadId: detail.thread._id,
        postId: postId ?? undefined,
        score: nextScore,
        comment,
      });
      return true;
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("rate this post");
        setAuthOpen(true);
        return false;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "forum_reputation_failed",
        component: "ForumThreadView",
        action: "forum:setForumReputation",
        entityType: postId === null ? "forumThread" : "forumPost",
        entityId: postId ?? detail.thread._id,
        notify: false,
      });
      const message = userFacingError(caught, "Could not update reputation");
      setReputationError(message);
      return false;
    } finally {
      setReputationPendingKey(null);
    }
  }

  async function submitReputation() {
    if (!reputationDraft) {
      return;
    }
    const saved = await updatePostReputation(
      reputationDraft.post,
      reputationDraft.score,
      reputationComment.trim() || undefined,
    );
    if (!saved) {
      return;
    }
    setReputationDraft(null);
    setReputationComment("");
    setReputationError("");
  }

  async function submitPollVote(poll: ForumPollRecord) {
    if (!isAuthenticated) {
      setAuthAction("vote in this poll");
      setAuthOpen(true);
      return;
    }
    if (!selectedPollOptionId) {
      setPollError("Choose an option before voting.");
      return;
    }
    setPollPending(true);
    setPollError("");
    try {
      await votePoll({ pollId: poll._id, optionId: selectedPollOptionId });
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("vote in this poll");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "poll_vote_failed",
        component: "ForumThreadView",
        action: "forum:votePoll",
        entityType: "forumPoll",
        entityId: poll._id,
        notify: false,
      });
      setPollError(userFacingError(caught, "Could not record vote"));
    } finally {
      setPollPending(false);
    }
  }

  function openPollEditor(poll: ForumPollRecord) {
    if (!isAuthenticated) {
      setAuthAction("edit this poll");
      setAuthOpen(true);
      return;
    }
    setEditPollQuestion(poll.question);
    setEditPollOptions(poll.options.map((option) => option.label));
    setEditPollError("");
    setEditingPoll(true);
  }

  async function submitPollEdit(poll: ForumPollRecord) {
    const payload = buildPollEditPayload(editPollQuestion, editPollOptions);
    if (payload === null) {
      setEditPollError(
        "Polls need a question and at least two unique options.",
      );
      return;
    }

    setEditPollPending(true);
    setEditPollError("");
    try {
      await updatePollContent({
        pollId: poll._id,
        question: payload.question,
        options: payload.options,
      });
      setEditingPoll(false);
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("edit this poll");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "poll_edit_failed",
        component: "ForumThreadView",
        action: "forum:updatePollContent",
        entityType: "forumPoll",
        entityId: poll._id,
        notify: false,
      });
      setEditPollError(userFacingError(caught, "Could not edit poll"));
    } finally {
      setEditPollPending(false);
    }
  }

  if (detail === undefined) {
    return <ForumLoading label={`Syncing ${threadSlug}`} variant="thread" />;
  }

  const { category, thread } = detail;

  if (!category || !thread) {
    return (
      <ForumStatusBox
        title="Thread unavailable"
        body="The forum backend did not return this thread. Confirm the board slug and thread slug."
        accent="canary"
      />
    );
  }

  const threadLocked = isLockedThread(thread);
  const viewerCanReply = !threadLocked && thread.viewerCanReply === true;
  const replyMessage = replyUnavailableMessage(
    category,
    threadLocked,
    isAuthenticated,
  );
  const threadPageHref = (nextPage: number) =>
    nextPage <= 1
      ? forumPath(category.slug, thread.slug)
      : `${forumPath(category.slug, thread.slug)}?postPage=${nextPage}`;
  const firstUnreadHref =
    thread.viewerUnread === true && thread.firstUnreadPostNumber
      ? forumPostPath(
          category.slug,
          thread.slug,
          thread.firstUnreadPostNumber,
          thread.firstUnreadPage,
        )
      : null;

  return (
    <div className="space-y-8">
      <div className="border-y border-row-border py-4">
        <ForumBreadcrumbs category={category} thread={thread} />
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-end">
          <div>
            <p className="page-kicker">Thread view</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ForumThreadPrefixBadge thread={thread} />
              <h1 className="text-2xl font-semibold md:text-3xl">
                {thread.title}
              </h1>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ForumThreadStateBadges thread={thread} />
              {firstUnreadHref ? (
                <ForumJumpLink
                  ariaLabel={`Go to first unread post in ${thread.title}`}
                  className="px-2"
                  href={firstUnreadHref}
                >
                  First unread »
                </ForumJumpLink>
              ) : null}
              <ThreadActions
                canDelete={thread.viewerCanDelete === true}
                canEdit={thread.viewerCanEdit === true}
                subscribed={thread.viewerSubscribed === true}
                subscriptionPending={subscriptionPending}
                onDelete={() => removeThread(thread._id, category.slug)}
                onEdit={openThreadEditor}
                onToggleSubscription={() => toggleSubscription(thread._id)}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <ForumThreadRatingSummary
                average={getThreadRatingAverage(thread)}
                count={getThreadRatingCount(thread)}
              />
              <ThreadRatingControls
                pending={ratingPending}
                thread={thread}
                onRate={updateThreadRating}
              />
            </div>
            {subscriptionError ? (
              <p
                className="mt-3 border border-row-border p-3 text-sm text-muted-foreground"
                role="alert"
              >
                {subscriptionError}
              </p>
            ) : null}
            {ratingError ? (
              <p
                className="mt-3 border border-row-border p-3 text-sm text-muted-foreground"
                role="alert"
              >
                {ratingError}
              </p>
            ) : null}
            {getCategoryDescription(category) ? (
              <p className="mt-5 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
                {getCategoryTitle(category)} ·{" "}
                {getCategoryDescription(category)}
              </p>
            ) : null}
          </div>
          <ForumMetricBar
            items={[
              { label: "Replies", value: getThreadReplyCount(thread) },
              {
                label: "Posts",
                value: getThreadPostCount(thread) || posts.length,
              },
              { label: "Rating", value: formatThreadRating(thread) },
            ]}
            className="sm:grid-cols-3"
          />
        </div>
      </div>

      <ForumAnnouncementPanel announcements={detail.announcements} />

      {editingThread ? (
        <section className="space-y-4">
          <div className="border-b border-row-border pb-3">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Edit thread
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Starter post</h2>
          </div>
          <ForumCompose
            title={editThreadTitle}
            onTitleChange={setEditThreadTitle}
            titlePlaceholder="Thread title"
            body={editThreadBody}
            onBodyChange={setEditThreadBody}
            bodyLabel="Starter body"
            bodyPlaceholder="Edit the starter post."
            submitLabel="Save thread"
            pending={editThreadPending}
            error={editThreadError}
            footerActions={
              <Button
                className="rounded-none font-mono text-[10px] uppercase"
                type="button"
                variant="outline"
                disabled={editThreadBody.trim().length === 0}
                onClick={() =>
                  setEditThreadPreviewOpen((current) => !current)
                }
              >
                {editThreadPreviewOpen ? "Hide preview" : "Preview"}
              </Button>
            }
            note={
              "Thread edits update the visible title, starter post, and attachments."
            }
            onSubmit={() => submitThreadEdit(thread._id)}
          >
            <ForumPrefixEditSelect
              disabled={editThreadPending}
              prefixes={editPrefixOptions}
              value={editThreadPrefixId}
              onChange={setEditThreadPrefixId}
            />
            {editThreadPreviewOpen ? (
              <ReplyPreviewPanel body={editThreadBody} label="Starter preview" />
            ) : null}
            <ForumEditAttachmentManager
              disabled={editThreadPending}
              existingAttachments={editThreadExistingAttachments}
              label="Starter attachments"
              newAttachments={editThreadNewAttachments}
              onExistingAttachmentsChange={setEditThreadExistingAttachments}
              onNewAttachmentsChange={setEditThreadNewAttachments}
            />
            <label className="block">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                Edit reason
              </span>
              <Input
                className="mt-2 rounded-none border-row-border"
                maxLength={180}
                placeholder="Optional: typo, new links, clarity pass"
                value={editThreadReason}
                onChange={(event) => setEditThreadReason(event.target.value)}
              />
            </label>
          </ForumCompose>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setEditingThread(false);
              setEditThreadReason("");
              setEditThreadExistingAttachments([]);
              setEditThreadNewAttachments([]);
              setEditThreadPreviewOpen(false);
              setEditThreadError("");
            }}
          >
            Cancel edit
          </Button>
        </section>
      ) : null}

      {detail.poll && editingPoll && detail.poll.viewerCanEdit ? (
        <ForumPollEditor
          error={editPollError}
          options={editPollOptions}
          pending={editPollPending}
          question={editPollQuestion}
          onCancel={() => {
            setEditingPoll(false);
            setEditPollError("");
          }}
          onOptionsChange={setEditPollOptions}
          onQuestionChange={setEditPollQuestion}
          onSave={() => submitPollEdit(detail.poll!)}
        />
      ) : detail.poll ? (
        <ForumPollPanel
          poll={detail.poll}
          selectedOptionId={selectedPollOptionId}
          pending={pollPending}
          error={pollError}
          canEdit={detail.poll.viewerCanEdit}
          onEdit={() => openPollEditor(detail.poll!)}
          onSelect={setSelectedPollOptionId}
          onVote={() => submitPollVote(detail.poll!)}
        />
      ) : null}

      <section className="space-y-5">
        <ForumPaginationBar
          buildHref={threadPageHref}
          label="Posts"
          nextLabel="Later"
          pagination={detail.replies.pagination}
          previousLabel="Earlier"
        />
        {posts.length === 0 ? (
          <ForumStatusBox
            title="Thread body"
            body="The thread loaded, but no root post or replies were returned."
          />
        ) : (
          posts.map((post, index) => {
            const postNumber = getPostNumber(post, index);
            const quoteKey = getPostQuoteKey(post, postNumber);
            const postId = forumPostId(post);
            const reputationTargetKey = `${postId === null ? "thread" : "post"}:${postId ?? thread._id}`;

            return (
              <ForumPostFrame
                key={post._id ?? `post-${index}`}
                id={`post-${postNumber}`}
                actions={
                  <PostActions
                    post={post}
                    postNumber={postNumber}
                    threadId={thread._id}
                    canDelete={post.viewerCanDelete === true}
                    canEdit={post.viewerCanEdit === true}
                    canGiveReputation={post.viewerCanGiveReputation === true}
                    canQuote={viewerCanReply}
                    multiQuoteSelected={queuedQuoteKeys.has(quoteKey)}
                    reputationPending={
                      reputationPendingKey === reputationTargetKey
                    }
                    viewerReputationScore={
                      (post.viewerReputationScore ?? 0) as ReputationScore
                    }
                    onDelete={() => removePost(post)}
                    onEdit={() => openPostEditor(post)}
                    onMultiQuote={() => toggleQueuedQuote(post, postNumber)}
                    onQuote={() => quotePost(post)}
                    onReputation={(score) =>
                      openReputationDialog(post, score, postNumber)
                    }
                    onReport={(target) => openReport(target)}
                  />
                }
                author={getThreadAuthor(post)}
                authorHref={profileHref(post.authorUsername)}
                avatarUrl={post.authorImage}
                location={post.authorLocation}
                joinedAt={post.authorJoinedAt}
                postCount={post.authorPostCount}
                rank={post.authorRank}
                reputationScore={post.authorReputationScore}
                role={post.role}
                signature={
                  post.authorShowSignatures === false
                    ? undefined
                    : post.authorSignature
                }
                timestamp={formatForumDateTime(getPostTimestamp(post))}
                postNumber={postNumber}
              >
                {editingPostId !== null &&
                editingPostId === forumPostId(post) ? (
                  <div className="space-y-4">
                    <ForumCompose
                      body={editPostBody}
                      bodyLabel={`Reply #${postNumber}`}
                      bodyPlaceholder="Edit the reply body."
                      bodyRows={6}
                      disabled={editPostPending}
                      error={editPostError}
                      footerActions={
                        <Button
                          className="rounded-none font-mono text-[10px] uppercase"
                          type="button"
                          variant="outline"
                          disabled={editPostBody.trim().length === 0}
                          onClick={() =>
                            setEditPostPreviewOpen((current) => !current)
                          }
                        >
                          {editPostPreviewOpen ? "Hide preview" : "Preview"}
                        </Button>
                      }
                      note={
                        "Reply edits keep the original post number and can update attachments."
                      }
                      pending={editPostPending}
                      submitLabel="Save reply"
                      onBodyChange={setEditPostBody}
                      onSubmit={() => submitPostEdit(editingPostId)}
                    >
                      {editPostPreviewOpen ? (
                        <ReplyPreviewPanel
                          body={editPostBody}
                          label={`Reply #${postNumber} preview`}
                        />
                      ) : null}
                      <ForumEditAttachmentManager
                        disabled={editPostPending}
                        existingAttachments={editPostExistingAttachments}
                        label="Current attachments"
                        newAttachments={editPostNewAttachments}
                        onExistingAttachmentsChange={
                          setEditPostExistingAttachments
                        }
                        onNewAttachmentsChange={setEditPostNewAttachments}
                      />
                      <label className="block">
                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                          Edit reason
                        </span>
                        <Input
                          className="mt-2 rounded-none border-row-border"
                          maxLength={180}
                          placeholder="Optional: typo, corrected link, added context"
                          value={editPostReason}
                          onChange={(event) =>
                            setEditPostReason(event.target.value)
                          }
                        />
                      </label>
                    </ForumCompose>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingPostId(null);
                        setEditPostReason("");
                        setEditPostExistingAttachments([]);
                        setEditPostNewAttachments([]);
                        setEditPostPreviewOpen(false);
                        setEditPostError("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <ForumBody body={post.body} />
                    <ForumAttachmentList attachments={post.attachments} />
                    <ForumEditMetaLine post={post} />
                  </>
                )}
              </ForumPostFrame>
            );
          })
        )}
        <ForumPaginationBar
          buildHref={threadPageHref}
          label="Posts"
          nextLabel="Later"
          pagination={detail.replies.pagination}
          previousLabel="Earlier"
        />
      </section>

      <section className="space-y-4" id="forum-reply-composer">
        <div className="border-b border-row-border pb-3">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Reply
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Post to thread</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Replies publish under your current SYM handle.
          </p>
        </div>
        {viewerCanReply && queuedQuotes.length > 0 ? (
          <QueuedQuotePanel
            quotes={queuedQuotes}
            onClear={() => setQueuedQuotes([])}
            onInsert={insertQueuedQuotes}
            onRemove={(key) =>
              setQueuedQuotes((current) =>
                current.filter((quote) => quote.key !== key),
              )
            }
          />
        ) : null}
        {viewerCanReply ? (
          <ForumCompose
            body={replyBody}
            bodyTextareaRef={replyTextareaRef}
            onBodyChange={setReplyBody}
            bodyLabel="Reply body"
            bodyPlaceholder="Write the next post in the thread."
            submitLabel="Post reply"
            pending={pending}
            disabled={authLoading}
            error={replyError}
            footerActions={
              <Button
                className="rounded-none font-mono text-[10px] uppercase"
                type="button"
                variant="outline"
                disabled={replyBody.trim().length === 0}
                onClick={() => setReplyPreviewOpen((current) => !current)}
              >
                {replyPreviewOpen ? "Hide preview" : "Preview"}
              </Button>
            }
            note="Classic board layout, plain reading mode."
            onSubmit={() => submitReply(thread._id)}
          >
            <ForumAttachmentDraftPanel
              attachments={replyAttachments}
              disabled={pending || authLoading}
              onAttachmentsChange={setReplyAttachments}
            />
            {replyPreviewOpen ? <ReplyPreviewPanel body={replyBody} /> : null}
          </ForumCompose>
        ) : (
          <ForumStatusBox
            title="Replying unavailable"
            body={replyMessage}
            accent={threadLocked ? "muted" : "canary"}
          />
        )}
      </section>

      <AuthRequiredDialog
        action={authAction}
        open={authOpen}
        redirectTo={authRedirectTo}
        setOpen={setAuthOpen}
      />
      <Dialog
        open={reportTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReportTarget(null);
          }
        }}
      >
        <DialogContent className="rounded-none border-row-border sm:rounded-none">
          <DialogHeader>
            <DialogTitle>Report post</DialogTitle>
            <DialogDescription>
              Send this to the forum moderation queue for staff review.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                Target
              </span>
              <span className="text-sm">{reportTarget?.label}</span>
            </label>
            <label className="grid gap-2">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                Reason
              </span>
              <Textarea
                aria-describedby={
                  reportError ? "forum-report-reason-error" : undefined
                }
                aria-invalid={reportError ? true : undefined}
                className="rounded-none border-row-border"
                rows={2}
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
                placeholder="Spam, abuse, off-topic, or needs moderator attention"
              />
            </label>
            <label className="grid gap-2">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                Details
              </span>
              <Textarea
                className="rounded-none border-row-border"
                rows={4}
                value={reportDetails}
                onChange={(event) => setReportDetails(event.target.value)}
                placeholder="Optional context"
              />
            </label>
            {reportError ? (
              <p
                className="border border-row-border p-3 text-sm text-muted-foreground"
                id="forum-report-reason-error"
                role="alert"
              >
                {reportError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReportTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={reportPending}
              onClick={submitReport}
            >
              {reportPending ? "Sending..." : "Send report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={reputationDraft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReputationDraft(null);
            setReputationComment("");
            setReputationError("");
          }
        }}
      >
        <DialogContent className="rounded-none border-row-border sm:rounded-none">
          <DialogHeader>
            <DialogTitle>
              {reputationDraft?.score === 1
                ? "Add reputation"
                : "Subtract reputation"}
            </DialogTitle>
            <DialogDescription>
              Leave a short note for the member ledger.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                Target
              </span>
              <span className="text-sm">{reputationDraft?.label}</span>
            </label>
            <label className="grid gap-2">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                Score
              </span>
              <span className="text-sm">
                {reputationDraft?.score === 1 ? "+1" : "-1"}
              </span>
            </label>
            <label className="grid gap-2">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                Comment
              </span>
              <Textarea
                aria-describedby={
                  reputationError ? "forum-reputation-error" : undefined
                }
                aria-invalid={reputationError ? true : undefined}
                className="rounded-none border-row-border"
                maxLength={MAX_REPUTATION_COMMENT_CHARS}
                rows={3}
                value={reputationComment}
                onChange={(event) => setReputationComment(event.target.value)}
                placeholder="Helpful post, useful context, or disagreement"
              />
              <span className="text-xs leading-5 text-muted-foreground">
                {reputationComment.length}/{MAX_REPUTATION_COMMENT_CHARS}{" "}
                characters
              </span>
            </label>
            {reputationError ? (
              <p
                className="border border-row-border p-3 text-sm text-muted-foreground"
                id="forum-reputation-error"
                role="alert"
              >
                {reputationError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setReputationDraft(null);
                setReputationComment("");
                setReputationError("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={reputationPendingKey !== null}
              onClick={submitReputation}
            >
              {reputationPendingKey !== null ? "Saving..." : "Save reputation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function replyUnavailableMessage(
  category: ForumCategoryRecord,
  threadLocked: boolean,
  isAuthenticated: boolean,
) {
  if (threadLocked) {
    return "This thread is locked. Replying is disabled.";
  }
  if (!isAuthenticated) {
    return "Sign in with a SYM handle to reply to this thread.";
  }
  if (category.replyAccess === "closed") {
    return "Replies are closed on this board.";
  }
  if (category.replyAccess === "staff") {
    return "Only forum staff can reply on this board.";
  }
  if (category.replyAccess === "trusted") {
    return "A moderator needs to approve your forum access before you can reply here.";
  }
  return "Your account cannot reply to this thread right now.";
}

function ForumPollPanel({
  canEdit,
  error,
  pending,
  poll,
  selectedOptionId,
  onEdit,
  onSelect,
  onVote,
}: {
  canEdit: boolean;
  error: string;
  pending: boolean;
  poll: ForumPollRecord;
  selectedOptionId: string;
  onEdit: () => void;
  onSelect: (optionId: string) => void;
  onVote: () => void;
}) {
  const hasVoted = Boolean(poll.viewerOptionId);
  const resultsVisible =
    hasVoted || poll.status === "closed" || !poll.viewerCanVote;

  return (
    <section className="border border-row-border">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-row-border px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Poll
          </p>
          <h2 className="mt-2 text-xl font-semibold">{poll.question}</h2>
        </div>
        {canEdit ? (
          <Button
            className="rounded-none font-mono text-[10px] uppercase"
            type="button"
            variant="outline"
            onClick={onEdit}
          >
            Edit poll
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 p-4">
        {poll.options.map((option) => {
          const selected = selectedOptionId === option._id;
          const votedFor = poll.viewerOptionId === option._id;

          return (
            <label
              key={option._id}
              className="grid gap-2 border border-row-border p-3"
            >
              <span className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <input
                    className="size-4 accent-primary"
                    type="radio"
                    name={`poll-${poll._id}`}
                    checked={selected}
                    disabled={!poll.viewerCanVote || pending}
                    onChange={() => onSelect(option._id)}
                  />
                  <span className="break-words text-sm font-semibold">
                    {option.label}
                  </span>
                  {votedFor ? (
                    <span className="font-mono text-[10px] uppercase text-primary">
                      Your vote
                    </span>
                  ) : null}
                </span>
                {resultsVisible ? (
                  <span className="font-mono text-[10px] uppercase text-muted-foreground">
                    {option.voteCount} votes · {option.percent}%
                  </span>
                ) : null}
              </span>
              {resultsVisible ? (
                <span className="h-2 border border-row-border bg-muted">
                  <span
                    className="block h-full bg-primary"
                    style={{
                      width: `${Math.max(0, Math.min(100, option.percent))}%`,
                    }}
                  />
                </span>
              ) : null}
            </label>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            {poll.totalVotes} total votes
            {poll.status === "closed" ? " · Closed" : ""}
            {hasVoted ? " · Voted" : ""}
          </p>
          {poll.viewerCanVote ? (
            <Button
              className="rounded-none font-mono text-[10px] uppercase"
              type="button"
              disabled={pending}
              onClick={onVote}
            >
              {pending ? "Voting..." : "Vote"}
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="border border-row-border p-3 text-sm text-muted-foreground">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ForumPollEditor({
  error,
  options,
  pending,
  question,
  onCancel,
  onOptionsChange,
  onQuestionChange,
  onSave,
}: {
  error: string;
  options: string[];
  pending: boolean;
  question: string;
  onCancel: () => void;
  onOptionsChange: (options: string[]) => void;
  onQuestionChange: (question: string) => void;
  onSave: () => void;
}) {
  function updateOption(index: number, value: string) {
    onOptionsChange(
      options.map((option, optionIndex) =>
        optionIndex === index ? value : option,
      ),
    );
  }

  function addOption() {
    onOptionsChange([...options, ""]);
  }

  function removeOption(index: number) {
    onOptionsChange(options.filter((_, optionIndex) => optionIndex !== index));
  }

  return (
    <section className="border border-row-border">
      <div className="border-b border-row-border px-4 py-3">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Edit poll
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Poll options can be edited until the first vote is recorded.
        </p>
      </div>
      <div className="grid gap-4 p-4">
        <label className="grid gap-2">
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            Question
          </span>
          <Input
            className="rounded-none border-row-border"
            disabled={pending}
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
          />
        </label>
        <div className="grid gap-2">
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            Options
          </span>
          {options.map((option, index) => (
            <div className="flex gap-2" key={`edit-poll-option-${index}`}>
              <Input
                aria-label={`Poll option ${index + 1}`}
                className="rounded-none border-row-border"
                disabled={pending}
                value={option}
                onChange={(event) => updateOption(index, event.target.value)}
              />
              {options.length > 2 ? (
                <Button
                  className="rounded-none font-mono text-[10px] uppercase"
                  disabled={pending}
                  type="button"
                  variant="outline"
                  onClick={() => removeOption(index)}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          {options.length < 8 ? (
            <Button
              className="justify-self-start rounded-none font-mono text-[10px] uppercase"
              disabled={pending}
              type="button"
              variant="outline"
              onClick={addOption}
            >
              Add option
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="border border-row-border p-3 text-sm text-muted-foreground">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            className="rounded-none font-mono text-[10px] uppercase"
            disabled={pending}
            type="button"
            onClick={onSave}
          >
            {pending ? "Saving..." : "Save poll"}
          </Button>
          <Button
            className="rounded-none font-mono text-[10px] uppercase"
            disabled={pending}
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </div>
    </section>
  );
}

function QueuedQuotePanel({
  quotes,
  onClear,
  onInsert,
  onRemove,
}: {
  quotes: QueuedQuote[];
  onClear: () => void;
  onInsert: () => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="border border-row-border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-row-border px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Multi-quote
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {quotes.length} selected for this reply.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="rounded-none font-mono text-[10px] uppercase"
            type="button"
            onClick={onInsert}
          >
            Insert quotes
          </Button>
          <Button
            className="rounded-none font-mono text-[10px] uppercase"
            type="button"
            variant="outline"
            onClick={onClear}
          >
            Clear
          </Button>
        </div>
      </div>
      <div className="divide-y divide-row-border">
        {quotes.map((quote) => (
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            key={quote.key}
          >
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              {quote.label}
            </p>
            <Button
              className="h-7 rounded-none px-2 font-mono text-[10px] uppercase"
              type="button"
              variant="outline"
              onClick={() => onRemove(quote.key)}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReplyPreviewPanel({
  body,
  label = "Reply preview",
}: {
  body: string;
  label?: string;
}) {
  const trimmed = body.trim();

  return (
    <section className="border border-row-border">
      <div className="border-b border-row-border px-4 py-3 font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </div>
      <div className="p-4">
        {trimmed.length > 0 ? (
          <ForumBody body={trimmed} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing to preview yet.
          </p>
        )}
      </div>
    </section>
  );
}

function ForumEditAttachmentManager({
  disabled,
  existingAttachments,
  label,
  newAttachments,
  onExistingAttachmentsChange,
  onNewAttachmentsChange,
}: {
  disabled?: boolean;
  existingAttachments: ForumAttachmentRecord[];
  label: string;
  newAttachments: ForumAttachmentDraft[];
  onExistingAttachmentsChange: (attachments: ForumAttachmentRecord[]) => void;
  onNewAttachmentsChange: (attachments: ForumAttachmentDraft[]) => void;
}) {
  function removeExistingAttachment(attachmentId: string) {
    onExistingAttachmentsChange(
      existingAttachments.filter((attachment) => attachment._id !== attachmentId),
    );
  }

  return (
    <section className="space-y-3">
      <div className="border border-row-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            {label}
          </p>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            {existingAttachments.length + newAttachments.length}/
            {MAX_FORUM_ATTACHMENTS}
          </p>
        </div>
        {existingAttachments.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {existingAttachments.map((attachment) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 border border-row-border px-3 py-2"
                key={attachment._id}
              >
                <a
                  className="min-w-0 text-sm font-semibold underline-offset-4 hover:underline"
                  href={attachment.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Paperclip className="size-3.5 shrink-0" />
                    <span className="truncate">{attachment.filename}</span>
                  </span>
                  <span className="mt-1 block font-mono text-[10px] uppercase text-muted-foreground">
                    {attachment.contentType} /{" "}
                    {formatAttachmentSize(attachment.size)}
                  </span>
                </a>
                <Button
                  aria-label={`Remove ${attachment.filename}`}
                  className="size-8 rounded-none p-0"
                  disabled={disabled}
                  type="button"
                  variant="ghost"
                  onClick={() => removeExistingAttachment(attachment._id)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            No saved attachments.
          </p>
        )}
      </div>
      <ForumAttachmentDraftPanel
        attachments={newAttachments}
        disabled={disabled}
        reservedAttachmentSlots={existingAttachments.length}
        onAttachmentsChange={onNewAttachmentsChange}
      />
    </section>
  );
}

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.ceil(size / 1024)} KB`;
  }
  return `${size} B`;
}

function ForumEditMetaLine({ post }: { post: ForumPostRecord }) {
  if (!post.lastEditedAt) {
    return null;
  }

  const editor = post.lastEditedByName ?? "unknown member";
  return (
    <div className="mt-5 border-t border-row-border pt-3 font-mono text-[10px] uppercase leading-5 text-muted-foreground">
      Last edited by {editor} on {formatForumDateTime(post.lastEditedAt)}
      {post.lastEditReason ? ` / ${post.lastEditReason}` : ""}
    </div>
  );
}

function PostActions({
  canQuote,
  canGiveReputation,
  canDelete,
  canEdit,
  multiQuoteSelected,
  reputationPending,
  viewerReputationScore,
  onDelete,
  onEdit,
  onMultiQuote,
  post,
  postNumber,
  threadId,
  onQuote,
  onReputation,
  onReport,
}: {
  canQuote: boolean;
  canGiveReputation: boolean;
  canDelete: boolean;
  canEdit: boolean;
  multiQuoteSelected: boolean;
  reputationPending: boolean;
  viewerReputationScore: ReputationScore;
  onDelete: () => void;
  onEdit: () => void;
  onMultiQuote: () => void;
  post: ForumPostRecord;
  postNumber: number;
  threadId: string;
  onQuote: () => void;
  onReputation: (score: Exclude<ReputationScore, 0>) => void;
  onReport: (target: ForumReportTarget) => void;
}) {
  const postId = post._id?.endsWith("-root") ? undefined : post._id;

  return (
    <>
      <Button
        asChild
        className="min-h-10 rounded-none px-2 font-mono text-[10px] uppercase md:h-7 md:min-h-0"
        variant="outline"
      >
        <a
          aria-label={`Link to post ${postNumber}`}
          href={`#post-${postNumber}`}
        >
          #{postNumber}
        </a>
      </Button>
      {canQuote ? (
        <>
          <Button
            className="min-h-10 rounded-none px-2 font-mono text-[10px] uppercase md:h-7 md:min-h-0"
            type="button"
            variant="outline"
            onClick={onQuote}
          >
            Quote
          </Button>
          <Button
            aria-pressed={multiQuoteSelected}
            className="min-h-10 rounded-none px-2 font-mono text-[10px] uppercase md:h-7 md:min-h-0"
            type="button"
            variant={multiQuoteSelected ? "default" : "outline"}
            onClick={onMultiQuote}
          >
            {multiQuoteSelected ? "Queued" : "+ Quote"}
          </Button>
        </>
      ) : null}
      {canGiveReputation ? (
        <>
          <Button
            aria-pressed={viewerReputationScore === 1}
            className="min-h-10 rounded-none px-2 font-mono text-[10px] uppercase md:h-7 md:min-h-0"
            type="button"
            variant={viewerReputationScore === 1 ? "default" : "outline"}
            disabled={reputationPending}
            onClick={() => onReputation(1)}
          >
            + Rep
          </Button>
          <Button
            aria-pressed={viewerReputationScore === -1}
            className="min-h-10 rounded-none px-2 font-mono text-[10px] uppercase md:h-7 md:min-h-0"
            type="button"
            variant={viewerReputationScore === -1 ? "default" : "outline"}
            disabled={reputationPending}
            onClick={() => onReputation(-1)}
          >
            - Rep
          </Button>
        </>
      ) : null}
      {canEdit ? (
        <Button
          className="min-h-10 rounded-none px-2 font-mono text-[10px] uppercase md:h-7 md:min-h-0"
          type="button"
          variant="outline"
          onClick={onEdit}
        >
          Edit
        </Button>
      ) : null}
      {canDelete ? (
        <Button
          className="min-h-10 rounded-none px-2 font-mono text-[10px] uppercase md:h-7 md:min-h-0"
          type="button"
          variant="outline"
          onClick={onDelete}
        >
          Delete
        </Button>
      ) : null}
      <Button
        className="min-h-10 rounded-none px-2 font-mono text-[10px] uppercase md:h-7 md:min-h-0"
        type="button"
        variant="outline"
        onClick={() =>
          onReport({
            entityType: postId === undefined ? "thread" : "post",
            threadId,
            postId,
            label:
              postId === undefined
                ? `Thread starter #${postNumber}`
                : `Reply #${postNumber}`,
          })
        }
      >
        Report
      </Button>
    </>
  );
}

function ThreadActions({
  canDelete,
  canEdit,
  subscribed,
  subscriptionPending,
  onDelete,
  onEdit,
  onToggleSubscription,
}: {
  canDelete: boolean;
  canEdit: boolean;
  subscribed: boolean;
  subscriptionPending: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onToggleSubscription: () => void;
}) {
  return (
    <>
      <Button
        className="h-8 rounded-none px-3 font-mono text-[10px] uppercase"
        type="button"
        variant="outline"
        disabled={subscriptionPending}
        onClick={onToggleSubscription}
      >
        {subscriptionPending
          ? "Saving..."
          : subscribed
            ? "Unsubscribe"
            : "Subscribe"}
      </Button>
      {canEdit ? (
        <Button
          className="h-8 rounded-none px-3 font-mono text-[10px] uppercase"
          type="button"
          variant="outline"
          onClick={onEdit}
        >
          Edit
        </Button>
      ) : null}
      {canDelete ? (
        <Button
          className="h-8 rounded-none px-3 font-mono text-[10px] uppercase"
          type="button"
          variant="outline"
          onClick={onDelete}
        >
          Delete
        </Button>
      ) : null}
    </>
  );
}

function ThreadRatingControls({
  onRate,
  pending,
  thread,
}: {
  onRate: (score: ThreadRatingScore) => void;
  pending: boolean;
  thread: ForumThreadRecord;
}) {
  const viewerRating =
    typeof thread.viewerRating === "number" ? thread.viewerRating : 0;

  return (
    <div
      aria-label="Rate this thread"
      className="inline-flex items-center gap-1"
      role="group"
    >
      {([1, 2, 3, 4, 5] as ThreadRatingScore[]).map((score) => {
        const active = viewerRating === score;
        return (
          <Button
            key={score}
            aria-label={`${active ? "Clear" : "Set"} ${score} star thread rating`}
            aria-pressed={active}
            className="size-8 rounded-none p-0"
            disabled={pending}
            type="button"
            variant={active ? "default" : "outline"}
            onClick={() => onRate(score)}
          >
            <Star
              aria-hidden="true"
              className={active ? "size-4 fill-current" : "size-4"}
            />
          </Button>
        );
      })}
    </div>
  );
}

function ForumPrefixEditSelect({
  disabled,
  prefixes,
  value,
  onChange,
}: {
  disabled: boolean;
  prefixes: ForumThreadPrefixRecord[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (prefixes.length === 0) {
    return null;
  }

  return (
    <label className="grid gap-2">
      <span className="font-mono text-[10px] uppercase text-muted-foreground">
        Prefix
      </span>
      <select
        className="min-h-10 rounded-none border border-row-border bg-background px-3 font-mono text-[11px] uppercase text-foreground"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="none">No prefix</option>
        {prefixes.map((prefix) => (
          <option
            key={prefix._id ?? prefix.slug}
            value={prefix._id ?? prefix.slug}
          >
            {prefix.categoryName ? `${prefix.categoryName}: ` : ""}[
            {prefix.label}]
          </option>
        ))}
      </select>
    </label>
  );
}

function buildPostQuote(post: ForumPostRecord) {
  const author = getThreadAuthor(post);
  const cleanBody = post.body
    .replace(/\[quote(?:=[^\]]+)?\][\s\S]*?\[\/quote\]/gi, "")
    .replace(/\[\/?quote[^\]]*\]/gi, "")
    .trim()
    .slice(0, MAX_QUOTED_BODY_CHARS);
  return `[quote=${author}]\n${cleanBody}\n[/quote]\n\n`;
}

function getPostQuoteKey(post: ForumPostRecord, postNumber: number) {
  return post._id ?? `post-${postNumber}`;
}

function forumPostId(post: ForumPostRecord) {
  return post._id?.endsWith("-root") ? null : (post._id ?? null);
}

function profileHref(username?: string) {
  if (!username) {
    return undefined;
  }
  return forumMemberProfilePath(username);
}

function buildPollEditPayload(question: string, options: string[]) {
  const cleanedQuestion = question.trim();
  const cleanedOptions = options.map((option) => option.trim()).filter(Boolean);
  const distinctOptions = new Set(
    cleanedOptions.map((option) => option.toLowerCase()),
  );
  if (
    cleanedQuestion.length < 4 ||
    cleanedOptions.length < 2 ||
    cleanedOptions.length > 8 ||
    distinctOptions.size !== cleanedOptions.length
  ) {
    return null;
  }
  return { question: cleanedQuestion, options: cleanedOptions };
}

function parsePage(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
}

function currentForumRedirectTo(
  pathname: string | null,
  searchParams: Pick<URLSearchParams, "toString">,
  fallback: string,
) {
  const query = searchParams.toString();
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  return `${pathname ?? fallback}${query ? `?${query}` : ""}${hash}`;
}
