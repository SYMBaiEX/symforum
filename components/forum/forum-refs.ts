import { compactNumber } from "@/lib/format";
import { asRoute } from "@/lib/typed-route";
import {
  convexRefs,
  type ForumAgentDirectoryRecord as ConvexForumAgentDirectoryRecord,
  type ForumAttachmentInput,
  type ForumAttachmentRecord as ConvexForumAttachmentRecord,
  type ForumAnnouncementRecord as ConvexForumAnnouncementRecord,
  type ForumBoardRulesRecord as ConvexForumBoardRulesRecord,
  type ForumCalendarEventRecord as ConvexForumCalendarEventRecord,
  type ForumCalendarEventSummaryRecord as ConvexForumCalendarEventSummaryRecord,
  type ForumCategoryRecord as ConvexForumCategoryRecord,
  type ForumCategorySectionRecord as ConvexForumCategorySectionRecord,
  type ForumContentReportEntityType,
  type ForumMemberRecord as ConvexForumMemberRecord,
  type ForumMemberSortKey as ConvexForumMemberSortKey,
  type ForumHelpDocumentRecord as ConvexForumHelpDocumentRecord,
  type ForumHelpDocumentSummaryRecord as ConvexForumHelpDocumentSummaryRecord,
  type ForumRelationshipRecord as ConvexForumRelationshipRecord,
  type ForumNotificationPreferencesRecord as ConvexForumNotificationPreferencesRecord,
  type ForumNotificationRecord as ConvexForumNotificationRecord,
  type ForumOnlineSummaryRecord as ConvexForumOnlineSummaryRecord,
  type ForumOnlineMembersRecord as ConvexForumOnlineMembersRecord,
  type ForumOverviewRecord as ConvexForumOverviewRecord,
  type ForumPaginationRecord,
  type ForumPresenceLocationType,
  type ForumRecentThreadMode,
  type ForumRecentThreadsRecord as ConvexForumRecentThreadsRecord,
  type ForumPostRecord as ConvexForumPostRecord,
  type ForumPollRecord as ConvexForumPollRecord,
  type ForumPrivateMessageBox,
  type ForumPrivateMessageRecord as ConvexForumPrivateMessageRecord,
  type ForumThreadDetailRecord as ConvexForumThreadDetailRecord,
  type ForumThreadPrefixRecord,
  type ForumThreadRecord as ConvexForumThreadRecord,
  type ForumThreadStatus,
  type MyPendingForumContentRecord,
  type MyForumProfileRecord,
  type MyForumReputationHistoryRecord,
  type MyForumWarningRecord,
} from "@/lib/convex-refs";

export type ForumThreadSummaryRecord = Partial<ConvexForumThreadRecord> & {
  _id?: string;
  prefixId?: string;
  prefix?: ForumThreadPrefixRecord | null;
  slug: string;
  title: string;
  threadId?: string;
  categorySlug?: string;
  categoryName?: string;
  excerpt?: string;
  body?: string;
  authorName?: string;
  authorUsername?: string;
  createdByName?: string;
  lastActivityAt?: number;
  lastPostAuthorName?: string;
  repliesCount?: number;
  postCount?: number;
  postsCount?: number;
  isPinned?: boolean;
  locked?: boolean;
  isLocked?: boolean;
  viewerHasRead?: boolean;
  viewerUnread?: boolean;
  viewerCanEdit?: boolean;
  viewerCanDelete?: boolean;
  viewerSubscribed?: boolean;
  viewerBookmarked?: boolean;
  viewerCanRateThread?: boolean;
  viewerRating?: number;
  ratingCount?: number;
  ratingAverage?: number;
  firstUnreadPostNumber?: number;
  firstUnreadPage?: number;
  role?: string;
  authorTitle?: string;
  authorRank?: string;
  authorPostCount?: number;
  authorReputationScore?: number;
  authorSignature?: string;
  authorShowSignatures?: boolean;
  authorDisplayName?: string;
  authorImage?: string;
  authorLocation?: string;
  authorJoinedAt?: number;
  viewerCanGiveReputation?: boolean;
  viewerReputationScore?: number;
  lastEditedAt?: number;
  lastEditedBy?: string;
  lastEditedByName?: string;
  lastEditReason?: string;
  editCount?: number;
  attachments?: ConvexForumAttachmentRecord[];
  status?: ForumThreadStatus;
};

export type ForumAgentDirectoryRecord = ConvexForumAgentDirectoryRecord;

export type ForumPostRecord = Partial<ConvexForumPostRecord> & {
  _id?: string;
  body: string;
  postId?: string;
  threadSlug?: string;
  threadTitle?: string;
  prefixId?: string;
  prefix?: ForumThreadPrefixRecord | null;
  categorySlug?: string;
  authorName?: string;
  authorUsername?: string;
  createdByName?: string;
  role?: string;
  title?: string;
  excerpt?: string;
  postNumber?: number;
  postPage?: number;
  threadLastPostAt?: number;
  threadReplyCount?: number;
  threadViewCount?: number;
  position?: number;
  viewerCanEdit?: boolean;
  viewerCanDelete?: boolean;
  authorTitle?: string;
  authorRank?: string;
  authorPostCount?: number;
  authorReputationScore?: number;
  authorSignature?: string;
  authorShowSignatures?: boolean;
  authorDisplayName?: string;
  authorImage?: string;
  authorLocation?: string;
  authorJoinedAt?: number;
  viewerCanGiveReputation?: boolean;
  viewerReputationScore?: number;
  lastEditedAt?: number;
  lastEditedBy?: string;
  lastEditedByName?: string;
  lastEditReason?: string;
  editCount?: number;
  attachments?: ConvexForumAttachmentRecord[];
};

export type ForumThreadRecord = Partial<ConvexForumThreadDetailRecord> &
  ForumThreadSummaryRecord;

export type ForumPollRecord = ConvexForumPollRecord;
export type ForumAnnouncementRecord = ConvexForumAnnouncementRecord;
export type ForumCalendarEventRecord = ConvexForumCalendarEventRecord;
export type ForumCalendarEventSummaryRecord =
  ConvexForumCalendarEventSummaryRecord;
export type ForumHelpDocumentRecord = ConvexForumHelpDocumentRecord;
export type ForumHelpDocumentSummaryRecord =
  ConvexForumHelpDocumentSummaryRecord;
export type ForumBoardRulesRecord = ConvexForumBoardRulesRecord;

export type ForumCategoryRecord = Partial<ConvexForumCategoryRecord> & {
  slug: string;
  title?: string;
  summary?: string;
  threadsCount?: number;
  postsCount?: number;
  latestThread?: ForumThreadSummaryRecord | null;
  lastThread?: ForumThreadSummaryRecord | null;
  viewerCanCreateThread?: boolean;
  viewerCanReply?: boolean;
  viewerCanCreatePoll?: boolean;
  ancestors?: ForumCategoryRecord[];
  children?: ForumCategoryRecord[];
};

export type ForumCategorySectionRecord = Omit<
  ConvexForumCategorySectionRecord,
  "section" | "boards"
> & {
  section: ForumCategoryRecord | null;
  boards: ForumCategoryRecord[];
};

export type ForumOverviewRecord = Omit<
  ConvexForumOverviewRecord,
  "categories" | "sections" | "newestThreads"
> & {
  categories: ForumCategoryRecord[];
  sections: ForumCategorySectionRecord[];
  newestThreads: ForumThreadSummaryRecord[];
};

export type ForumThreadListRecord = {
  category: ForumCategoryRecord | null;
  announcements: ForumAnnouncementRecord[];
  rules: ForumBoardRulesRecord | null;
  threads: ForumThreadSummaryRecord[];
  pagination: ForumPaginationRecord;
};

export type ForumThreadDetailRecord = {
  category: ForumCategoryRecord | null;
  announcements: ForumAnnouncementRecord[];
  rules: ForumBoardRulesRecord | null;
  thread: ForumThreadRecord | null;
  poll: ForumPollRecord | null;
  replies: {
    page: ForumPostRecord[];
    isDone: boolean;
    pagination: ForumPaginationRecord;
  };
};

export type ForumSearchRecord = {
  threads: ForumThreadSummaryRecord[];
  posts: ForumPostRecord[];
  pagination: ForumPaginationRecord;
  threadPagination: ForumPaginationRecord;
  postPagination: ForumPaginationRecord;
  limited: boolean;
  threadResultsLimited: boolean;
  postResultsLimited: boolean;
  filters: {
    resultType: "all" | "threads" | "replies";
    author: string | null;
    target: "all" | "titles" | "bodies";
    sortKey: "relevance" | "newest" | "oldest" | "replies" | "views";
    days?: number;
  };
};

export type ForumMemberRecord = ConvexForumMemberRecord;
export type ForumMemberSortKey = ConvexForumMemberSortKey;
export type ForumRelationshipRecord = ConvexForumRelationshipRecord;
export type ForumNotificationPreferencesRecord =
  ConvexForumNotificationPreferencesRecord;
export type ForumOnlineSummaryRecord = ConvexForumOnlineSummaryRecord;
export type ForumOnlineMembersRecord = ConvexForumOnlineMembersRecord;
export type ForumRecentThreadsRecord = Omit<
  ConvexForumRecentThreadsRecord,
  "threads"
> & {
  threads: ForumThreadSummaryRecord[];
};

export const FORUM_CALENDAR_TIME_ZONE = "America/Chicago";
export type { ForumRecentThreadMode };
export type ForumNotificationRecord = ConvexForumNotificationRecord;
export type ForumPrivateMessageRecord = ConvexForumPrivateMessageRecord;
export type ForumWarningRecord = MyForumWarningRecord;
export type PendingForumContentRecord = MyPendingForumContentRecord;
export type ForumReputationHistoryRecord = MyForumReputationHistoryRecord;
export type ForumAttachmentRecord = ConvexForumAttachmentRecord;
export type { ForumAttachmentInput };

export const forumRefs = {
  listPublicAgents: convexRefs.forum.listPublicAgents,
  overview: convexRefs.forum.overview,
  listCategories: convexRefs.forum.listCategories,
  listThreadPrefixes: convexRefs.forum.listThreadPrefixes,
  listAnnouncements: convexRefs.forum.listAnnouncements,
  getAnnouncement: convexRefs.forum.getAnnouncement,
  listHelpDocuments: convexRefs.forum.listHelpDocuments,
  getHelpDocument: convexRefs.forum.getHelpDocument,
  listCalendarEvents: convexRefs.forum.listCalendarEvents,
  getCalendarEvent: convexRefs.forum.getCalendarEvent,
  listThreads: convexRefs.forum.listThreads,
  listRecentThreads: convexRefs.forum.listRecentThreads,
  getThread: convexRefs.forum.getThread,
  search: convexRefs.forum.search,
  listMembers: convexRefs.forum.listMembers,
  listOnlineMembers: convexRefs.forum.listOnlineMembers,
  listMyThreadSubscriptions: convexRefs.forum.listMyThreadSubscriptions,
  listMyThreadBookmarks: convexRefs.forum.listMyThreadBookmarks,
  listMyCategorySubscriptions: convexRefs.forum.listMyCategorySubscriptions,
  listMyNotifications: convexRefs.forum.listMyNotifications,
  getMyForumNavState: convexRefs.forum.getMyForumNavState,
  recordPresence: convexRefs.forum.recordPresence,
  markNotificationRead: convexRefs.forum.markNotificationRead,
  listPrivateMessages: convexRefs.forum.listPrivateMessages,
  getPrivateMessage: convexRefs.forum.getPrivateMessage,
  sendPrivateMessage: convexRefs.forum.sendPrivateMessage,
  markPrivateMessageRead: convexRefs.forum.markPrivateMessageRead,
  deletePrivateMessage: convexRefs.forum.deletePrivateMessage,
  restorePrivateMessage: convexRefs.forum.restorePrivateMessage,
  getMyForumProfile: convexRefs.forum.getMyForumProfile,
  listMyForumReputationHistory: convexRefs.forum.listMyForumReputationHistory,
  listMyForumWarnings: convexRefs.forum.listMyForumWarnings,
  listMyPendingForumContent: convexRefs.forum.listMyPendingForumContent,
  listMyForumRelationships: convexRefs.forum.listMyForumRelationships,
  getMyForumNotificationPreferences:
    convexRefs.forum.getMyForumNotificationPreferences,
  createThread: convexRefs.forum.createThread,
  updateMyForumProfile: convexRefs.forum.updateMyForumProfile,
  updateMyForumNotificationPreferences:
    convexRefs.forum.updateMyForumNotificationPreferences,
  updateForumRelationship: convexRefs.forum.updateForumRelationship,
  reply: convexRefs.forum.createReply,
  markThreadRead: convexRefs.forum.markThreadRead,
  markCategoryRead: convexRefs.forum.markCategoryRead,
  markAllForumsRead: convexRefs.forum.markAllForumsRead,
  toggleThreadSubscription: convexRefs.forum.toggleThreadSubscription,
  setThreadBookmark: convexRefs.forum.setThreadBookmark,
  toggleCategorySubscription: convexRefs.forum.toggleCategorySubscription,
  votePoll: convexRefs.forum.votePoll,
  updatePollContent: convexRefs.forum.updatePollContent,
  rateThread: convexRefs.forum.rateThread,
  setForumReputation: convexRefs.forum.setForumReputation,
  updateThreadContent: convexRefs.forum.updateThreadContent,
  updatePostContent: convexRefs.forum.updatePostContent,
  deleteThread: convexRefs.forum.deleteThread,
  deletePost: convexRefs.forum.deletePost,
  createReport: convexRefs.forum.createReport,
  createPrivateMessageReport: convexRefs.forum.createPrivateMessageReport,
  recordThreadView: convexRefs.forum.recordThreadView,
};

export type {
  ForumPaginationRecord,
  ForumPresenceLocationType,
  ForumPrivateMessageBox,
  MyForumProfileRecord,
  MyForumReputationHistoryRecord,
  ForumThreadPrefixRecord,
};

export type ForumReportTarget = {
  entityType: ForumContentReportEntityType;
  threadId: string;
  postId?: string;
  label: string;
};

export function formatForumDateTime(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatForumCount(value?: number) {
  return compactNumber(typeof value === "number" ? value : 0);
}

export function humanizeSlug(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

export function forumPath(categorySlug?: string, threadSlug?: string) {
  if (!categorySlug) {
    return asRoute("/forum");
  }
  if (!threadSlug) {
    return asRoute(`/forum/${categorySlug}`);
  }
  return asRoute(`/forum/${categorySlug}/${threadSlug}`);
}

export function forumHrefForPathname(href: string, pathname: string | null) {
  if (pathname?.startsWith("/forum")) {
    return asRoute(href);
  }
  if (href === "/forum") {
    return asRoute("/");
  }
  if (href.startsWith("/forum?") || href.startsWith("/forum#")) {
    return asRoute(`/${href.slice("/forum".length)}`);
  }
  if (href.startsWith("/forum/")) {
    return asRoute(href.slice("/forum".length));
  }
  return asRoute(href);
}

export function normalizedForumPathname(pathname: string | null) {
  if (!pathname || pathname === "/") {
    return "/forum";
  }
  if (pathname === "/forum" || pathname.startsWith("/forum/")) {
    return pathname;
  }
  return `/forum${pathname}`;
}

export function forumMemberProfilePath(username: string) {
  return asRoute(`/forum/members/${encodeURIComponent(username)}`);
}

export function forumAnnouncementPath(announcement: {
  categorySlug?: string;
  slug: string;
}) {
  const params = new URLSearchParams();
  if (announcement.categorySlug) {
    params.set("board", announcement.categorySlug);
  }
  const query = params.toString();
  return asRoute(
    `/forum/announcements/${announcement.slug}${query ? `?${query}` : ""}`,
  );
}

export function forumHelpPath(document: { slug: string }) {
  return asRoute(`/forum/help/${document.slug}`);
}

export function forumCalendarEventPath(event: { slug: string }) {
  return asRoute(`/forum/calendar/${event.slug}`);
}

export function currentForumCalendarMonth() {
  return forumCalendarMonthFromDate(new Date());
}

export function forumCalendarMonthFromDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    timeZone: FORUM_CALENDAR_TIME_ZONE,
    year: "numeric",
  }).formatToParts(date);
  const year = parts
    .find((part) => part.type === "year")
    ?.value.padStart(4, "0");
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : date.toISOString().slice(0, 7);
}

export function normalizeForumCalendarMonthParam(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    return currentForumCalendarMonth();
  }
  const year = Number(value.slice(0, 4));
  const monthIndex = Number(value.slice(5, 7)) - 1;
  const date = new Date(Date.UTC(year, monthIndex, 1));
  if (
    year < 1970 ||
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex
  ) {
    return currentForumCalendarMonth();
  }
  return value;
}

export function adjacentForumCalendarMonth(month: string, delta: number) {
  const normalized = normalizeForumCalendarMonthParam(month);
  const year = Number(normalized.slice(0, 4));
  const monthIndex = Number(normalized.slice(5, 7)) - 1;
  const targetIndex = year * 12 + monthIndex + delta;
  const minIndex = 1970 * 12;
  const maxIndex = 9999 * 12 + 11;
  if (targetIndex < minIndex || targetIndex > maxIndex) {
    return null;
  }

  const targetYear = Math.floor(targetIndex / 12);
  const targetMonth = (targetIndex % 12) + 1;
  return `${targetYear.toString().padStart(4, "0")}-${targetMonth
    .toString()
    .padStart(2, "0")}`;
}

export function shiftForumCalendarMonth(month: string, delta: number) {
  return (
    adjacentForumCalendarMonth(month, delta) ??
    normalizeForumCalendarMonthParam(month)
  );
}

export function forumCalendarMonthLabel(month: string) {
  const normalized = normalizeForumCalendarMonthParam(month);
  const year = Number(normalized.slice(0, 4));
  const monthIndex = Number(normalized.slice(5, 7)) - 1;
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex, 1)));
}

export function forumPostPath(
  categorySlug: string | undefined,
  threadSlug: string | undefined,
  postNumber?: number,
  postPage?: number,
) {
  if (!categorySlug || !threadSlug) {
    return forumPath(categorySlug, threadSlug);
  }
  const base = forumPath(categorySlug, threadSlug);
  const query = postPage && postPage > 1 ? `?postPage=${postPage}` : "";
  const anchor = postNumber ? `#post-${postNumber}` : "";
  return asRoute(`${base}${query}${anchor}`);
}

export function getThreadLastPostHref(
  thread: ForumThreadSummaryRecord | null,
  categorySlug?: string,
) {
  if (!thread) {
    return forumPath(categorySlug);
  }
  return forumPostPath(
    thread.categorySlug ?? categorySlug,
    thread.slug,
    thread.lastPostNumber,
    thread.lastPostPage,
  );
}

export function getCategoryTitle(category: ForumCategoryRecord | null) {
  if (!category) {
    return "Unknown board";
  }
  return category.title ?? category.name ?? humanizeSlug(category.slug);
}

export function getCategoryDescription(category: ForumCategoryRecord | null) {
  if (!category) {
    return "";
  }
  return category.description ?? category.summary ?? "";
}

export function getCategoryThreadCount(category: ForumCategoryRecord | null) {
  if (!category) {
    return 0;
  }
  return category.threadCount ?? category.threadsCount ?? 0;
}

export function getCategoryPostCount(category: ForumCategoryRecord | null) {
  if (!category) {
    return 0;
  }
  return category.postCount ?? category.postsCount ?? 0;
}

export function getCategoryLatestThread(category: ForumCategoryRecord | null) {
  if (!category) {
    return null;
  }
  return category.latestThread ?? category.lastThread ?? null;
}

export function getThreadAuthor(
  record: Partial<ForumThreadSummaryRecord> | Partial<ForumPostRecord> | null,
) {
  if (!record) {
    return "SYM-UNKNOWN";
  }
  return (
    record.authorUsername ??
    record.authorName ??
    record.createdByName ??
    record.author ??
    "SYM-UNKNOWN"
  );
}

export function getThreadLastAuthor(thread: ForumThreadSummaryRecord | null) {
  if (!thread) {
    return "SYM-UNKNOWN";
  }
  return (
    thread.lastPostAuthorName ??
    thread.lastPostAuthor ??
    getThreadAuthor(thread)
  );
}

export function isPinnedThread(thread: ForumThreadSummaryRecord | null) {
  return Boolean(thread?.pinned ?? thread?.isPinned);
}

export function isLockedThread(thread: ForumThreadSummaryRecord | null) {
  if (thread?.locked !== undefined) {
    return thread.locked;
  }
  if (thread?.isLocked !== undefined) {
    return thread.isLocked;
  }
  return thread?.status === "locked";
}

export function getThreadStartedAt(thread: ForumThreadSummaryRecord | null) {
  return thread?.createdAt ?? thread?._creationTime;
}

export function getThreadLastActivityAt(
  thread: ForumThreadSummaryRecord | null,
) {
  return (
    thread?.lastPostAt ??
    thread?.lastActivityAt ??
    thread?.updatedAt ??
    thread?.createdAt ??
    thread?._creationTime
  );
}

export function getThreadPostCount(thread: ForumThreadSummaryRecord | null) {
  if (!thread) {
    return 0;
  }

  const explicitCount = thread.postCount ?? thread.postsCount;
  if (typeof explicitCount === "number") {
    return explicitCount;
  }
  return typeof thread.replyCount === "number" ? thread.replyCount + 1 : 0;
}

export function getThreadReplyCount(thread: ForumThreadSummaryRecord | null) {
  if (!thread) {
    return 0;
  }

  if (typeof thread.replyCount === "number") {
    return thread.replyCount;
  }
  if (typeof thread.repliesCount === "number") {
    return thread.repliesCount;
  }

  const totalPosts = getThreadPostCount(thread);
  return totalPosts > 0 ? Math.max(totalPosts - 1, 0) : 0;
}

export function getThreadRatingCount(thread: ForumThreadSummaryRecord | null) {
  return typeof thread?.ratingCount === "number" ? thread.ratingCount : 0;
}

export function getThreadRatingAverage(
  thread: ForumThreadSummaryRecord | null,
) {
  return typeof thread?.ratingAverage === "number" ? thread.ratingAverage : 0;
}

export function formatThreadRating(thread: ForumThreadSummaryRecord | null) {
  const count = getThreadRatingCount(thread);
  if (count === 0) {
    return "Unrated";
  }
  return `${getThreadRatingAverage(thread).toFixed(1)}/5`;
}

export function getPostTimestamp(post: ForumPostRecord) {
  return post.createdAt ?? post.updatedAt ?? post._creationTime;
}

export function getPostNumber(post: ForumPostRecord, index: number) {
  return post.postNumber ?? post.position ?? index + 1;
}

export function getRenderablePosts(
  thread: ForumThreadRecord | null,
  posts: ForumPostRecord[],
  options?: { includeRoot?: boolean },
): ForumPostRecord[] {
  if (!thread?.body || options?.includeRoot === false) {
    return posts;
  }

  const rootPost: ForumPostRecord = {
    _id: `${thread._id ?? thread.threadId ?? thread.slug}-root`,
    threadId: thread._id ?? thread.threadId,
    threadSlug: thread.slug,
    categorySlug: thread.categorySlug,
    body: thread.body,
    author: thread.author,
    authorName: thread.authorName,
    authorUsername: thread.authorUsername,
    createdByName: thread.createdByName,
    role: thread.role,
    authorTitle: thread.authorTitle,
    authorRank: thread.authorRank,
    authorPostCount: thread.authorPostCount,
    authorReputationScore: thread.authorReputationScore,
    authorSignature: thread.authorSignature,
    authorShowSignatures: thread.authorShowSignatures,
    authorDisplayName: thread.authorDisplayName,
    authorImage: thread.authorImage,
    authorLocation: thread.authorLocation,
    authorJoinedAt: thread.authorJoinedAt,
    lastEditedAt: thread.lastEditedAt,
    lastEditedBy: thread.lastEditedBy,
    lastEditedByName: thread.lastEditedByName,
    lastEditReason: thread.lastEditReason,
    editCount: thread.editCount,
    attachments: thread.attachments,
    viewerCanGiveReputation: thread.viewerCanGiveReputation,
    viewerReputationScore: thread.viewerReputationScore,
    createdAt: getThreadStartedAt(thread),
    postNumber: 1,
    viewerCanEdit: thread.viewerCanEdit,
    viewerCanDelete: thread.viewerCanDelete,
  };

  return [
    rootPost,
    ...posts.map((post, index) => ({
      ...post,
      postNumber: post.postNumber ?? index + 2,
    })),
  ];
}
