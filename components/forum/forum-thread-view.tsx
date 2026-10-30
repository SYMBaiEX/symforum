"use client";
import { ForumCommerceFrame } from "@/components/swap/forum-commerce";
import { CommunityHolderBadge } from "@/components/community/community-hub";
import type { Id } from "@/convex/_generated/dataModel";
import { forumReplyBranches } from "./forum-reply-branches";
import { forumExperienceRefs } from "./forum-experience-refs";
import { convexRefs } from "@/lib/convex-refs";

import { ForumPageHeader, ForumSectionHeader } from "./forum-layout-primitives";

import { reportAppError } from "@/components/app-error-surface";
import { AuthRequiredDialog } from "@/components/auth-required-dialog";
import type { ForumAttachmentDraft } from "@/components/forum/forum-compose";
import { MAX_FORUM_ATTACHMENTS } from "@/components/forum/forum-attachment-upload";
import { canonicalForumHref } from "@/components/forum/forum-host-url";
import { forumPollInteractionState } from "@/components/forum/forum-poll-state";
import { buildPostQuote } from "@/components/forum/forum-quote";
import {
  forumPath,
  forumMemberProfilePath,
  forumPostPath,
  forumRefs,
  formatForumDateTime,
  getPostNumber,
  getPostTimestamp,
  getRenderablePosts,
  getThreadAuthor,
  getThreadRatingAverage,
  getThreadRatingCount,
  getThreadReplyCount,
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
  handleForumDisclosureKeyDown,
  ForumAttachmentList,
  ForumBody,
  ForumBreadcrumbs,
  ForumJumpLink,
  ForumLink,
  ForumLoading,
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
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useConvexAuth, useMutation } from "convex/react";
import { Paperclip, Star, X, ChevronDown } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const ForumCompose = dynamic(
  () =>
    import("@/components/forum/forum-compose").then(
      (module) => module.ForumCompose,
    ),
  {
    loading: () => (
      <p className="py-3 text-sm text-muted-foreground">Loading editor</p>
    ),
    ssr: false,
  },
);
const ForumAttachmentDraftPanel = dynamic(
  () =>
    import("@/components/forum/forum-compose").then(
      (module) => module.ForumAttachmentDraftPanel,
    ),
  { ssr: false },
);

const POSTS_PER_PAGE = 20;
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
  showHeading = true,
}: {
  categorySlug: string;
  threadSlug: string;
  enabled: boolean;
  showHeading?: boolean;
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
    <LiveForumThreadView
      key={`${categorySlug}:${threadSlug}`}
      categorySlug={categorySlug}
      threadSlug={threadSlug}
      showHeading={showHeading}
    />
  );
}

function LiveForumThreadView({
  categorySlug,
  threadSlug,
  showHeading,
}: {
  categorySlug: string;
  threadSlug: string;
  showHeading: boolean;
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
  const relatedSearchQuery = useMemo(
    () => relatedThreadSearchQuery(detail?.thread?.title),
    [detail?.thread?.title],
  );
  const reply = useMutation(forumRefs.reply);
  const recordThreadView = useMutation(forumRefs.recordThreadView);
  const markThreadRead = useMutation(forumRefs.markThreadRead);
  const toggleThreadSubscription = useMutation(
    forumRefs.toggleThreadSubscription,
  );
  const setThreadBookmark = useMutation(forumRefs.setThreadBookmark);
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
  const viewer = useQuery(
    convexRefs.users.maybeViewer,
    isAuthenticated ? {} : "skip",
  );
  const acceptAnswer = useMutation(forumExperienceRefs.accept);
  const [answerPending, setAnswerPending] = useState(false);
  const [replyLayout, setReplyLayout] = useState<"chronological" | "context">(
    "chronological",
  );
  const [replyTo, setReplyTo] = useState<ForumPostRecord>();
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
  const [bookmarkPending, setBookmarkPending] = useState(false);
  const [bookmarkError, setBookmarkError] = useState("");
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
        ...(replyTo?._id && forumPostId(replyTo)
          ? { parentPostId: replyTo._id }
          : {}),
        body: replyBody.trim(),
        attachments: replyAttachments.map(({ storageId, filename }) => ({
          storageId,
          filename,
        })),
      });
      setReplyTo(undefined);
      setReplyBody("");
      setReplyAttachments([]);
      setQueuedQuotes([]);
      setReplyPreviewOpen(false);
      setReplyError("");
      if (result.status === "pending") {
        setReplyError(
          "Awaiting moderator review. Find your reply in Account & preferences → Pending content.",
        );
        return true;
      }
      router.push(
        forumPostPath(
          categorySlug,
          threadSlug,
          result.postNumber,
          result.postPage,
        ),
      );
      return true;
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

  async function toggleBookmark(threadId: string, bookmarked: boolean) {
    if (!isAuthenticated) {
      setAuthAction("save this thread");
      setAuthOpen(true);
      return;
    }
    setBookmarkPending(true);
    setBookmarkError("");
    try {
      await setThreadBookmark({ threadId, saved: !bookmarked });
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setAuthAction("save this thread");
        setAuthOpen(true);
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "thread_bookmark_failed",
        component: "ForumThreadView",
        action: "forum:setThreadBookmark",
        entityType: "forumThread",
        entityId: threadId,
        notify: false,
      });
      setBookmarkError(
        userFacingError(caught, "Could not update saved thread"),
      );
    } finally {
      setBookmarkPending(false);
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
        attachments: editThreadNewAttachments.map(
          ({ storageId, filename }) => ({
            storageId,
            filename,
          }),
        ),
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

  async function copyPostPermalink(postNumber: number, postPage?: number) {
    const permalink = canonicalForumHref(
      forumPostPath(categorySlug, threadSlug, postNumber, postPage),
    );
    try {
      await copyForumText(permalink);
      toast.success("Post link copied", {
        description: `Post #${postNumber}`,
      });
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "forum_post_permalink_copy_failed",
        component: "ForumThreadView",
        action: "forum:copyPostPermalink",
        entityType: "forumThread",
        entityId: detail?.thread?._id,
        metadata: { postNumber, permalink },
        notify: false,
      });
      toast.error("Could not copy post link", {
        description: "Use the numbered post link to copy it manually.",
      });
    }
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
    return <ForumLoading label="Loading discussion" variant="thread" />;
  }

  const { category, thread } = detail;

  if (!category || !thread) {
    return (
      <ForumStatusBox
        title="Thread unavailable"
        body="This discussion may have been removed or restricted. Browse the board to find another thread."
        accent="canary"
        action={
          <Button asChild className="rounded-full">
            <ForumLink href={forumPath(categorySlug)}>Back to board</ForumLink>
          </Button>
        }
      />
    );
  }

  const threadLocked = isLockedThread(thread);
  const viewerCanReply =
    isAuthenticated &&
    !threadLocked &&
    category.readOnlyArchive !== true &&
    thread.viewerCanReply === true;
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
  const ratingCount = getThreadRatingCount(thread);
  const ratingVisible = ratingCount > 0 || thread.viewerCanRateThread === true;
  const hasPostPages = detail.replies.pagination.totalPages > 1;

  return (
    <ForumCommerceFrame
      threadId={thread._id}
      readOnlyArchive={category.readOnlyArchive === true}
    >
      <div className="space-y-2">
        {showHeading ? (
          <ForumPageHeader title={thread.title} view="boards" nested />
        ) : null}
        <div className="forum-toolbar flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
            <ForumBreadcrumbs category={category} thread={thread} />
          </div>
          <span className="text-xs text-muted-foreground">
            {getThreadReplyCount(thread)} replies
          </span>
          <ForumThreadPrefixBadge thread={thread} />
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
          {viewerCanReply ? (
            <Button asChild className="min-h-11 rounded-full px-4 text-sm">
              <a href="#forum-reply-composer">Reply</a>
            </Button>
          ) : !isAuthenticated &&
            !authLoading &&
            !threadLocked &&
            category.readOnlyArchive !== true ? (
            <Button
              className="min-h-11 rounded-full px-4 text-sm"
              onClick={() => {
                setAuthAction("reply to this thread");
                setAuthOpen(true);
              }}
            >
              Reply
            </Button>
          ) : null}
          <details
            className="group min-w-0 open:basis-full"
            onKeyDown={handleForumDisclosureKeyDown}
          >
            <summary className="forum-action-pill focus-ring inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-xs">
              Thread tools <span aria-hidden="true">⌄</span>
            </summary>
            <div className="mt-2 flex w-full flex-wrap gap-1 rounded-xl bg-muted/30 p-3">
              <ThreadActions
                bookmarked={thread.viewerBookmarked === true}
                bookmarkPending={bookmarkPending}
                canDelete={thread.viewerCanDelete === true}
                canEdit={thread.viewerCanEdit === true}
                subscribed={thread.viewerSubscribed === true}
                subscriptionPending={subscriptionPending}
                onDelete={() => removeThread(thread._id, category.slug)}
                onEdit={openThreadEditor}
                onToggleBookmark={() =>
                  toggleBookmark(thread._id, thread.viewerBookmarked === true)
                }
                onToggleSubscription={() => toggleSubscription(thread._id)}
              />
              {ratingVisible ? (
                <div className="flex basis-full flex-wrap items-center gap-2 pt-2">
                  {ratingCount > 0 ? (
                    <ForumThreadRatingSummary
                      average={getThreadRatingAverage(thread)}
                      count={ratingCount}
                    />
                  ) : null}
                  {thread.viewerCanRateThread === true ? (
                    <ThreadRatingControls
                      pending={ratingPending}
                      thread={thread}
                      onRate={updateThreadRating}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </details>
        </div>
        {subscriptionError ? (
          <p className="rounded-xl bg-muted p-3 text-sm" role="alert">
            {subscriptionError}
          </p>
        ) : null}
        {bookmarkError ? (
          <p className="rounded-xl bg-muted p-3 text-sm" role="alert">
            {bookmarkError}
          </p>
        ) : null}
        {ratingError ? (
          <p className="rounded-xl bg-muted p-3 text-sm" role="alert">
            {ratingError}
          </p>
        ) : null}
      </div>

      {editingThread ? (
        <section className="space-y-3">
          <div className="pb-2">
            <p className="text-xs text-muted-foreground">Edit thread</p>
            <h2 className="mt-1 text-lg font-semibold">Starter post</h2>
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
                className="min-h-11 rounded-full px-4 text-xs"
                type="button"
                variant="outline"
                disabled={editThreadBody.trim().length === 0}
                onClick={() => setEditThreadPreviewOpen((current) => !current)}
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
              <ReplyPreviewPanel
                body={editThreadBody}
                label="Starter preview"
              />
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
              <span className="text-xs text-muted-foreground">Edit reason</span>
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
          authLoading={authLoading}
          poll={detail.poll}
          selectedOptionId={selectedPollOptionId}
          pending={pollPending}
          error={pollError}
          canEdit={detail.poll.viewerCanEdit}
          isAuthenticated={isAuthenticated}
          pollAccess={
            detail.category.readOnlyArchive === true
              ? "closed"
              : detail.category.pollAccess
          }
          onEdit={() => openPollEditor(detail.poll!)}
          onSelect={setSelectedPollOptionId}
          onVote={() => submitPollVote(detail.poll!)}
        />
      ) : null}

      <section className="space-y-3" aria-label="Discussion posts">
        <h2 className="sr-only">Discussion</h2>
        {hasPostPages ? (
          <ForumPaginationBar
            buildHref={threadPageHref}
            label="Posts"
            nextLabel="Later"
            pagination={detail.replies.pagination}
            previousLabel="Earlier"
          />
        ) : null}
        {detail.acceptedAnswer ? (
          <section className="forum-post-card mb-4 bg-accent/5 p-4">
            <h2 className="text-sm font-semibold text-accent">
              Accepted answer by {detail.acceptedAnswer.author}
            </h2>
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
              {detail.acceptedAnswer.body}
            </p>
            <ForumLink
              href={forumPostPath(
                category.slug,
                thread.slug,
                detail.acceptedAnswer.postNumber,
                detail.acceptedAnswer.postPage,
              )}
              className="focus-ring inline-flex min-h-11 items-center text-sm text-accent"
            >
              Read the answer →
            </ForumLink>
          </section>
        ) : null}
        {thread.sourceUrl ? (
          <a
            href={thread.sourceUrl}
            rel="noopener noreferrer"
            target="_blank"
            className="focus-ring mb-3 inline-flex min-h-11 max-w-full items-center break-all text-sm text-accent"
          >
            Read source article ↗
          </a>
        ) : null}
        <div
          className="mb-3 flex items-center gap-2"
          role="group"
          aria-label="Reply layout"
        >
          {(["chronological", "context"] as const).map((layout) => (
            <button
              className={`forum-action-pill focus-ring min-h-11 px-3 text-xs ${replyLayout === layout ? "text-primary" : "text-muted-foreground"}`}
              type="button"
              key={layout}
              aria-pressed={replyLayout === layout}
              onClick={() => setReplyLayout(layout)}
            >
              {layout === "context" ? "Replies with context" : "Chronological"}
            </button>
          ))}
        </div>
        {posts.length === 0 ? (
          <ForumStatusBox
            title="Thread body"
            body="The thread loaded, but no root post or replies were returned."
          />
        ) : (
          (replyLayout === "context"
            ? forumReplyBranches(posts)
            : posts.map((post) => ({ post, depth: 0 }))
          ).map(({ post, depth }, index) => {
            const postNumber = getPostNumber(post, index);
            const quoteKey = getPostQuoteKey(post, postNumber);
            const postId = forumPostId(post);
            const reputationTargetKey = `${postId === null ? "thread" : "post"}:${postId ?? thread._id}`;

            return (
              <ForumReplyContainer
                key={post._id ?? `post-${index}`}
                depth={depth}
                summary={
                  replyLayout === "context" && post.parentPostId
                    ? `Reply by ${getThreadAuthor(post)} · #${postNumber}`
                    : undefined
                }
              >
                <ForumPostFrame
                  variant="grouped"
                  id={`post-${postNumber}`}
                  actions={
                    <div className="flex flex-wrap items-center gap-1">
                      {viewerCanReply && postId ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="min-h-11 rounded-full text-xs"
                          onClick={() => {
                            setReplyTo(post);
                            document
                              .getElementById("forum-reply-composer")
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "center",
                              });
                            replyTextareaRef.current?.focus();
                          }}
                        >
                          Reply
                        </Button>
                      ) : null}
                      {thread.viewerCanAcceptAnswer && postId ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={answerPending}
                          className="min-h-11 rounded-full text-xs text-accent"
                          onClick={async () => {
                            if (answerPending) return;
                            setAnswerPending(true);
                            try {
                              await acceptAnswer({
                                threadId: thread._id,
                                postId:
                                  thread.acceptedPostId === postId
                                    ? null
                                    : postId,
                              });
                            } catch (caught) {
                              setReplyError(
                                userFacingError(
                                  caught,
                                  "Could not select the answer.",
                                ),
                              );
                            } finally {
                              setAnswerPending(false);
                            }
                          }}
                        >
                          {thread.acceptedPostId === postId
                            ? "Clear accepted answer"
                            : "Accept answer"}
                        </Button>
                      ) : null}
                      <PostActions
                        post={post}
                        postNumber={postNumber}
                        threadId={thread._id}
                        canDelete={post.viewerCanDelete === true}
                        canEdit={post.viewerCanEdit === true}
                        canGiveReputation={
                          post.viewerCanGiveReputation === true
                        }
                        canQuote={viewerCanReply}
                        multiQuoteSelected={queuedQuoteKeys.has(quoteKey)}
                        reputationPending={
                          reputationPendingKey === reputationTargetKey
                        }
                        viewerReputationScore={
                          (post.viewerReputationScore ?? 0) as ReputationScore
                        }
                        onDelete={() => removePost(post)}
                        onCopyLink={() =>
                          copyPostPermalink(postNumber, post.postPage)
                        }
                        onEdit={() => openPostEditor(post)}
                        onMultiQuote={() => toggleQueuedQuote(post, postNumber)}
                        onQuote={() => quotePost(post)}
                        onReputation={(score) =>
                          openReputationDialog(post, score, postNumber)
                        }
                        onReport={(target) => openReport(target)}
                      />
                    </div>
                  }
                  author={
                    post.authorDisplayName ??
                    post.authorName ??
                    post.createdByName ??
                    post.author ??
                    getThreadAuthor(post)
                  }
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
                  {post.authorId && !post.authorIsAgent ? (
                    <CommunityHolderBadge
                      userId={post.authorId as Id<"users">}
                    />
                  ) : null}
                  {post.authorIsAgent ? (
                    <p className="mb-2 text-xs font-medium text-accent">
                      AI agent
                    </p>
                  ) : post.agentAssisted ? (
                    <p className="mb-2 text-xs text-muted-foreground">
                      Posted with agent assistance
                    </p>
                  ) : null}
                  {thread.acceptedPostId === postId ? (
                    <p className="mb-3 text-sm font-semibold text-accent">
                      Accepted answer
                    </p>
                  ) : null}
                  {post.replyContext ? (
                    <p className="mb-3 text-xs text-muted-foreground">
                      In reply to{" "}
                      <ForumLink
                        className="focus-ring underline"
                        href={forumPostPath(
                          category.slug,
                          thread.slug,
                          post.replyContext.postNumber,
                          post.replyContext.postPage,
                        )}
                      >
                        {post.replyContext.author} · #
                        {post.replyContext.postNumber}
                      </ForumLink>
                    </p>
                  ) : post.parentPostId ? (
                    <p className="mb-3 text-xs text-muted-foreground">
                      Earlier reply is unavailable.
                    </p>
                  ) : null}
                  {editingPostId !== null &&
                  editingPostId === forumPostId(post) ? (
                    <div className="space-y-3">
                      <ForumCompose
                        body={editPostBody}
                        bodyLabel={`Reply #${postNumber}`}
                        bodyPlaceholder="Edit the reply body."
                        bodyRows={6}
                        disabled={editPostPending}
                        error={editPostError}
                        footerActions={
                          <Button
                            className="min-h-11 rounded-full px-4 text-xs"
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
                          <span className="text-xs text-muted-foreground">
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
              </ForumReplyContainer>
            );
          })
        )}
        {hasPostPages ? (
          <ForumPaginationBar
            buildHref={threadPageHref}
            label="Posts"
            nextLabel="Later"
            pagination={detail.replies.pagination}
            previousLabel="Earlier"
          />
        ) : null}
      </section>
      {detail.announcements.length > 0 || relatedSearchQuery !== null ? (
        <details className="group rounded-xl bg-card px-4">
          <summary className="focus-ring flex min-h-11 cursor-pointer items-center justify-between text-xs text-muted-foreground">
            Board information and related discussions{" "}
            <span aria-hidden="true">⌄</span>
          </summary>
          <ForumAnnouncementPanel announcements={detail.announcements} />
          {relatedSearchQuery !== null ? (
            <ForumLink
              className="focus-ring inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
              href={`/forum/search?q=${encodeURIComponent(relatedSearchQuery)}`}
              prefetch={false}
            >
              Find related discussions →
            </ForumLink>
          ) : null}
        </details>
      ) : null}

      <section
        className="scroll-mt-28 space-y-3"
        id="forum-reply-composer"
        tabIndex={-1}
      >
        {viewerCanReply ? (
          <h2 className="px-1 text-sm font-semibold">Your reply</h2>
        ) : null}
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
            draftKey={
              viewer
                ? `symbaiex:forum:draft:reply:${viewer._id}:${thread._id}`
                : undefined
            }
            onBodyChange={setReplyBody}
            bodyLabel={
              replyTo
                ? `Reply to ${getThreadAuthor(replyTo)}`
                : "Join the discussion"
            }
            bodyPlaceholder="Share your reply…"
            submitLabel="Post reply"
            pending={pending}
            disabled={authLoading}
            error={replyError}
            footerActions={
              <Button
                className="min-h-11 rounded-full px-4 text-xs"
                type="button"
                variant="outline"
                disabled={replyBody.trim().length === 0}
                onClick={() => setReplyPreviewOpen((current) => !current)}
              >
                {replyPreviewOpen ? "Hide preview" : "Preview"}
              </Button>
            }
            note="Mention a member with @handle to send an in-app alert."
            onSubmit={() => submitReply(thread._id)}
          >
            {replyTo ? (
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {replyTo.body}
                </p>
                <button
                  className="focus-ring min-h-11 text-xs text-primary"
                  type="button"
                  onClick={() => setReplyTo(undefined)}
                >
                  Reply to thread instead
                </button>
              </div>
            ) : null}
            <ForumAttachmentDraftPanel
              attachments={replyAttachments}
              disabled={pending || authLoading}
              onAttachmentsChange={setReplyAttachments}
            />
            {replyPreviewOpen ? <ReplyPreviewPanel body={replyBody} /> : null}
          </ForumCompose>
        ) : (
          <div className="forum-panel flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">
                {category.readOnlyArchive === true
                  ? "Read-only archive"
                  : threadLocked
                    ? "Thread closed"
                    : !isAuthenticated && !authLoading
                      ? "Join the discussion"
                      : "Replying unavailable"}
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {replyMessage}
              </p>
            </div>
            {!isAuthenticated &&
              !authLoading &&
              !threadLocked &&
              category.readOnlyArchive !== true && (
                <Button
                  className="rounded-full"
                  onClick={() => {
                    setAuthAction("reply to this thread");
                    setAuthOpen(true);
                  }}
                >
                  Sign in to reply
                </Button>
              )}
          </div>
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
        <DialogContent className="rounded-xl border-input sm:rounded-xl">
          <DialogHeader>
            <DialogTitle>Report post</DialogTitle>
            <DialogDescription>
              Send this to the forum moderation queue for staff review.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-2">
              <span className="text-xs text-muted-foreground">Target</span>
              <span className="text-sm">{reportTarget?.label}</span>
            </label>
            <label className="grid gap-2">
              <span className="text-xs text-muted-foreground">Reason</span>
              <Textarea
                aria-describedby={
                  reportError ? "forum-report-reason-error" : undefined
                }
                aria-invalid={reportError ? true : undefined}
                className="rounded-xl border-input"
                rows={2}
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
                placeholder="Spam, abuse, off-topic, or needs moderator attention"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-xs text-muted-foreground">Details</span>
              <Textarea
                className="rounded-xl border-input"
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
        <DialogContent className="rounded-xl border-input sm:rounded-xl">
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
          <div className="grid gap-3">
            <label className="grid gap-2">
              <span className="text-xs text-muted-foreground">Target</span>
              <span className="text-sm">{reputationDraft?.label}</span>
            </label>
            <label className="grid gap-2">
              <span className="text-xs text-muted-foreground">Score</span>
              <span className="text-sm">
                {reputationDraft?.score === 1 ? "+1" : "-1"}
              </span>
            </label>
            <label className="grid gap-2">
              <span className="text-xs text-muted-foreground">Comment</span>
              <Textarea
                aria-describedby={
                  reputationError ? "forum-reputation-error" : undefined
                }
                aria-invalid={reputationError ? true : undefined}
                className="rounded-xl border-input"
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
    </ForumCommerceFrame>
  );
}

function replyUnavailableMessage(
  category: ForumCategoryRecord,
  threadLocked: boolean,
  isAuthenticated: boolean,
) {
  if (category.readOnlyArchive === true) {
    return "This thread remains readable in the Archive. New replies are closed; continue the topic in an active board.";
  }
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
  authLoading,
  canEdit,
  error,
  isAuthenticated,
  pending,
  poll,
  pollAccess,
  selectedOptionId,
  onEdit,
  onSelect,
  onVote,
}: {
  authLoading: boolean;
  canEdit: boolean;
  error: string;
  isAuthenticated: boolean;
  pending: boolean;
  poll: ForumPollRecord;
  pollAccess?: ForumCategoryRecord["pollAccess"];
  selectedOptionId: string;
  onEdit: () => void;
  onSelect: (optionId: string) => void;
  onVote: () => void;
}) {
  const hasVoted = Boolean(poll.viewerOptionId);
  const resultsVisible = poll.viewerCanSeeResults;
  const interaction = forumPollInteractionState({
    authLoading,
    isAuthenticated,
    poll,
    pollAccess,
  });
  const statusId = `poll-${poll._id}-status`;

  return (
    <section className="forum-panel">
      <div className="flex flex-wrap items-start justify-between gap-2 py-2.5">
        <div>
          <p className="text-xs text-muted-foreground">Poll</p>
          <h2 className="mt-1 text-base font-semibold">{poll.question}</h2>
        </div>
        {canEdit ? (
          <Button
            className="min-h-11 rounded-full px-4 text-xs"
            type="button"
            variant="outline"
            onClick={onEdit}
          >
            Edit poll
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 pt-3">
        <fieldset
          className="grid gap-2"
          aria-describedby={statusId}
          disabled={pending || !interaction.canSelect}
        >
          <legend className="sr-only">Choose one poll option</legend>
          {poll.options.map((option) => {
            const selected = selectedOptionId === option._id;
            const votedFor = poll.viewerOptionId === option._id;

            return (
              <label
                key={option._id}
                className={`grid min-h-11 gap-2 rounded-sm bg-muted/35 p-3 ${
                  interaction.canSelect && !pending
                    ? "cursor-pointer hover:bg-primary/5"
                    : "cursor-not-allowed"
                }`}
              >
                <span className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      className="size-4 accent-primary"
                      type="radio"
                      name={`poll-${poll._id}`}
                      checked={selected}
                      onChange={() => onSelect(option._id)}
                    />
                    <span className="break-words text-sm font-semibold">
                      {option.label}
                    </span>
                    {votedFor ? (
                      <span className="text-xs text-primary">Your vote</span>
                    ) : null}
                  </span>
                  {resultsVisible ? (
                    <span className="text-xs text-muted-foreground">
                      {option.voteCount} votes · {option.percent}%
                    </span>
                  ) : null}
                </span>
                {resultsVisible ? (
                  <span
                    className="h-1.5 overflow-hidden rounded-sm bg-muted"
                    role="progressbar"
                    aria-label={`${option.label} vote percentage`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.max(0, Math.min(100, option.percent))}
                  >
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
        </fieldset>
        <p
          className="py-1 text-xs text-muted-foreground"
          id={statusId}
          aria-live="polite"
        >
          {interaction.statusMessage}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {resultsVisible
              ? `${poll.totalVotes} total votes${
                  poll.status === "closed" ? " · Closed" : ""
                }${hasVoted ? " · Voted" : ""}`
              : "Results reveal after you vote"}
          </p>
          {interaction.showVoteButton ? (
            <Button
              className="min-h-11 rounded-full px-4 text-xs"
              type="button"
              disabled={pending || interaction.voteButtonDisabled}
              onClick={onVote}
            >
              {pending ? "Voting..." : interaction.voteButtonLabel}
            </Button>
          ) : null}
        </div>
        {error ? (
          <p
            className="rounded-sm bg-accent-canary/10 p-3 text-sm text-foreground"
            role="alert"
          >
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
    <section className="space-y-3 bg-muted/20 p-4">
      <div className="py-2.5">
        <p className="text-xs text-muted-foreground">Edit poll</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Poll options can be edited until the first vote is recorded.
        </p>
      </div>
      <div className="grid gap-3 p-3">
        <label className="grid gap-2">
          <span className="text-xs text-muted-foreground">Question</span>
          <Input
            className="rounded-xl border-input"
            disabled={pending}
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
          />
        </label>
        <div className="grid gap-2">
          <span className="text-xs text-muted-foreground">Options</span>
          {options.map((option, index) => (
            <div className="flex gap-2" key={`edit-poll-option-${index}`}>
              <Input
                aria-label={`Poll option ${index + 1}`}
                className="rounded-xl border-input"
                disabled={pending}
                value={option}
                onChange={(event) => updateOption(index, event.target.value)}
              />
              {options.length > 2 ? (
                <Button
                  className="min-h-11 rounded-full px-4 text-xs"
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
              className="min-h-11 justify-self-start rounded-full px-4 text-xs"
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
            className="min-h-11 rounded-full px-4 text-xs"
            disabled={pending}
            type="button"
            onClick={onSave}
          >
            {pending ? "Saving..." : "Save poll"}
          </Button>
          <Button
            className="min-h-11 rounded-full px-4 text-xs"
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
    <div className="bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
        <div>
          <p className="text-xs text-muted-foreground">Multi-quote</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {quotes.length} selected for this reply.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-11 rounded-full px-4 text-xs"
            type="button"
            onClick={onInsert}
          >
            Insert quotes
          </Button>
          <Button
            className="min-h-11 rounded-full px-4 text-xs"
            type="button"
            variant="outline"
            onClick={onClear}
          >
            Clear
          </Button>
        </div>
      </div>
      <div className="space-y-4">
        {quotes.map((quote) => (
          <div
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
            key={quote.key}
          >
            <p className="text-xs text-muted-foreground">{quote.label}</p>
            <Button
              className="min-h-11 rounded-full px-3 text-xs"
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
    <section className="rounded-xl bg-muted/25">
      <div className="px-3 py-2.5 text-xs text-muted-foreground">{label}</div>
      <div className="p-3">
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
      existingAttachments.filter(
        (attachment) => attachment._id !== attachmentId,
      ),
    );
  }

  return (
    <section className="space-y-3">
      <div className="rounded-xl bg-muted/25 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">
            {existingAttachments.length + newAttachments.length}/
            {MAX_FORUM_ATTACHMENTS}
          </p>
        </div>
        {existingAttachments.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {existingAttachments.map((attachment) => (
              <div
                className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-card px-3 py-2"
                key={attachment._id}
              >
                <a
                  className="min-w-0 flex-1 text-sm font-semibold underline-offset-4 hover:underline"
                  href={attachment.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Paperclip className="size-3.5 shrink-0" />
                    <span className="truncate">{attachment.filename}</span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {attachment.contentType} /{" "}
                    {formatAttachmentSize(attachment.size)}
                  </span>
                </a>
                <Button
                  aria-label={`Remove ${attachment.filename}`}
                  className="size-11 rounded-full p-0"
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
    <div className="mt-5 text-xs leading-5 text-muted-foreground">
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
  onCopyLink,
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
  onCopyLink: () => void;
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
      {canQuote ? (
        <>
          <Button
            className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
            type="button"
            variant="ghost"
            onClick={onQuote}
          >
            Quote
          </Button>
          <Button
            aria-pressed={multiQuoteSelected}
            className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
            type="button"
            variant={multiQuoteSelected ? "default" : "ghost"}
            onClick={onMultiQuote}
          >
            {multiQuoteSelected ? "Queued" : "+ Quote"}
          </Button>
        </>
      ) : null}
      <details
        className="group min-w-0 open:basis-full"
        onKeyDown={handleForumDisclosureKeyDown}
      >
        <summary
          className="forum-action-pill focus-ring inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
          aria-label={`More actions for post ${postNumber}`}
        >
          More <span aria-hidden="true">⌄</span>
        </summary>
        <div className="mt-1 flex w-full flex-wrap gap-1 rounded-xl bg-muted/35 p-2">
          <Button
            asChild
            className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
            variant="ghost"
          >
            <a
              aria-label={`Link to post ${postNumber}`}
              href={`#post-${postNumber}`}
            >
              #{postNumber}
            </a>
          </Button>
          <Button
            className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
            type="button"
            variant="ghost"
            onClick={onCopyLink}
          >
            Copy link
          </Button>
          {canGiveReputation ? (
            <>
              <Button
                aria-pressed={viewerReputationScore === 1}
                className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
                type="button"
                variant={viewerReputationScore === 1 ? "default" : "ghost"}
                disabled={reputationPending}
                onClick={() => onReputation(1)}
              >
                + Rep
              </Button>
              <Button
                aria-pressed={viewerReputationScore === -1}
                className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
                type="button"
                variant={viewerReputationScore === -1 ? "default" : "ghost"}
                disabled={reputationPending}
                onClick={() => onReputation(-1)}
              >
                - Rep
              </Button>
            </>
          ) : null}
          {canEdit ? (
            <Button
              className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
              type="button"
              variant="ghost"
              onClick={onEdit}
            >
              Edit
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
              type="button"
              variant="ghost"
              onClick={onDelete}
            >
              Delete
            </Button>
          ) : null}
          <Button
            className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
            type="button"
            variant="ghost"
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
        </div>
      </details>
    </>
  );
}

function ThreadActions({
  bookmarked,
  bookmarkPending,
  canDelete,
  canEdit,
  subscribed,
  subscriptionPending,
  onDelete,
  onEdit,
  onToggleBookmark,
  onToggleSubscription,
}: {
  bookmarked: boolean;
  bookmarkPending: boolean;
  canDelete: boolean;
  canEdit: boolean;
  subscribed: boolean;
  subscriptionPending: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onToggleBookmark: () => void;
  onToggleSubscription: () => void;
}) {
  return (
    <>
      <Button
        aria-pressed={bookmarked}
        className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
        type="button"
        variant="ghost"
        disabled={bookmarkPending}
        onClick={onToggleBookmark}
      >
        {bookmarkPending ? "Saving..." : bookmarked ? "Saved" : "Save"}
      </Button>
      <Button
        className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
        type="button"
        variant="ghost"
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
          className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
          type="button"
          variant="ghost"
          onClick={onEdit}
        >
          Edit
        </Button>
      ) : null}
      {canDelete ? (
        <Button
          className="forum-action-pill min-h-11 rounded-full px-3 text-xs"
          type="button"
          variant="ghost"
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
            className="size-11 rounded-full p-0"
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
      <span className="text-xs text-muted-foreground">Prefix</span>
      <select
        className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
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

async function copyForumText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Sandboxed browsers can deny Clipboard API access; use a selected textarea.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto -9999px";
  document.body.append(textarea);
  let copied = false;
  try {
    textarea.select();
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  if (!copied) {
    throw new Error("Clipboard access is unavailable in this browser.");
  }
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

function relatedThreadSearchQuery(title: string | undefined) {
  if (!title) {
    return null;
  }
  const terms = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 4)
    .filter((term, index, all) => all.indexOf(term) === index)
    .slice(0, 5);
  return terms.length >= 2 ? terms.join(" ") : title.trim().slice(0, 120);
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

function ForumReplyContainer({
  depth,
  summary,
  children,
}: {
  depth: number;
  summary?: string;
  children: React.ReactNode;
}) {
  const style = { marginLeft: depth * 16 };
  if (!summary)
    return (
      <div className="min-w-0" style={style}>
        {children}
      </div>
    );
  return (
    <details open className="min-w-0" style={style}>
      <summary className="forum-action-pill focus-ring flex min-h-11 cursor-pointer items-center gap-2 px-3 text-xs text-muted-foreground">
        {summary}
        <ChevronDown className="size-3" aria-hidden="true" />
      </summary>
      {children}
    </details>
  );
}
