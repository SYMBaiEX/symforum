import { makeFunctionReference } from "convex/server";

export type UserRole = "owner" | "admin" | "reader";
export type ForumAccountStatus = "active" | "suspended" | "banned";
export type ForumRole = "moderator" | "admin";
export type CommentEntityType = "post" | "hnStory" | "portfolioProject";
export type CommentStatus = "active" | "deleted" | "hidden";
export type ContactRequestStatus = "new" | "read" | "archived";
export type ForumCategoryStatus = "active" | "archived";
export type ForumThreadPrefixStatus = "active" | "archived";
export type ForumPageStatus = "active" | "archived";
export type ForumCalendarEventStatus = "active" | "archived";
export type ForumCategoryKind = "section" | "board";
export type ForumCategoryViewAccess =
  | "public"
  | "members"
  | "trusted"
  | "staff";
export type ForumCategoryWriteAccess =
  | "members"
  | "trusted"
  | "staff"
  | "closed";
export type ForumThreadStatus =
  | "pending"
  | "active"
  | "locked"
  | "hidden"
  | "deleted";
export type ForumPostStatus = "pending" | "active" | "hidden" | "deleted";
export type ForumReportStatus = "open" | "reviewed" | "dismissed";
export type ForumReportEntityType = "thread" | "post" | "privateMessage";
export type ForumContentReportEntityType = Extract<
  ForumReportEntityType,
  "thread" | "post"
>;
export type ForumReputationTargetType = "thread" | "post";
export type ForumReputationHistoryDirection = "received" | "given";
export type ForumWarningStatus = "active" | "revoked" | "expired";
export type ForumPollStatus = "open" | "closed";
export type ForumNotificationStatus = "unread" | "read";
export type ForumNotificationType = "reply" | "newThread";
export type ForumPrivateMessageBox = "inbox" | "sent" | "trash";
export type ForumMemberSortKey =
  | "posts-desc"
  | "threads-desc"
  | "reputation-desc"
  | "joined-desc"
  | "joined-asc"
  | "name-asc"
  | "online-desc";
export type ForumModerationEventEntityType =
  | "forumThread"
  | "forumPost"
  | "forumReport"
  | "forumPoll"
  | "forumWarning"
  | "forumCategory"
  | "forumCategoryOrder"
  | "forumThreadPrefix"
  | "forumAnnouncement"
  | "forumHelpDocument"
  | "forumCalendarEvent"
  | "forumBoardRules"
  | "forumCategoryModerator";
export type ForumModerationEventType =
  | "forum_report_created"
  | "forum_report_updated"
  | "forum_poll_status_updated"
  | "forum_category_created"
  | "forum_category_updated"
  | "forum_categories_reordered"
  | "forum_default_categories_created"
  | "forum_thread_prefix_created"
  | "forum_thread_prefix_updated"
  | "forum_announcement_created"
  | "forum_announcement_updated"
  | "forum_help_document_created"
  | "forum_help_document_updated"
  | "forum_calendar_event_created"
  | "forum_calendar_event_updated"
  | "forum_board_rules_created"
  | "forum_board_rules_updated"
  | "forum_category_moderator_assigned"
  | "forum_category_moderator_removed"
  | "forum_thread_submitted"
  | "forum_post_submitted"
  | "forum_thread_moderated"
  | "forum_thread_moved"
  | "forum_post_moderated"
  | "forum_posts_moved"
  | "forum_thread_deleted"
  | "forum_post_deleted"
  | "forum_warning_issued"
  | "forum_warning_updated";

export type ConvexPaginationOpts = {
  numItems: number;
  cursor: string | null;
};

export type ForumPaginationRecord = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  startItem: number;
  endItem: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  limited?: boolean;
  actualTotalItems?: number;
};

export type ForumNavStateRecord = {
  authenticated: boolean;
  trusted: boolean;
  canModerate: boolean;
  canAdmin: boolean;
  canManageBoards: boolean;
  username: string | null;
  rank: string | null;
  postCount: number;
  reputationScore: number;
  unreadNotifications: number;
  unreadNotificationsLimited: boolean;
  unreadPrivateMessages: number;
  unreadPrivateMessagesLimited: boolean;
};

export type ForumPresenceLocationType =
  | "index"
  | "board"
  | "thread"
  | "search"
  | "members"
  | "online"
  | "newPosts"
  | "help"
  | "calendar"
  | "userCp"
  | "messages"
  | "subscriptions";

export type ForumPresenceLocationRecord = {
  type: ForumPresenceLocationType;
  label: string;
  href?: string;
};

export type ForumOnlineMemberRecord = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  customTitle?: string;
  rank: string;
  postCount: number;
  reputationScore: number;
  lastSeenAt: number;
  location: ForumPresenceLocationRecord;
};

export type ForumOnlineSummaryRecord = {
  activeSince: number;
  registeredCount: number;
  registeredCountLimited: boolean;
  members: ForumOnlineMemberRecord[];
};

export type ForumOnlineMembersRecord = ForumOnlineSummaryRecord & {
  pagination: ForumPaginationRecord;
};

export type ForumRecentThreadMode = "new" | "today";
export type ForumSearchTarget = "all" | "titles" | "bodies";
export type ForumSearchSortKey =
  | "relevance"
  | "newest"
  | "oldest"
  | "replies"
  | "views";
export type ForumThreadListSortKey =
  | "lastPostAt"
  | "createdAt"
  | "replies"
  | "views"
  | "rating"
  | "title";
export type ForumThreadListSortOrder = "desc" | "asc";

export type ForumRecentThreadsRecord = {
  mode: ForumRecentThreadMode;
  label: string;
  since?: number;
  visibleThreadCount: number;
  unreadThreadCount?: number;
  limited: boolean;
  threads: ForumThreadRecord[];
  pagination: ForumPaginationRecord;
};

export type ForumStatisticsMemberRecord = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  customTitle?: string;
  rank: string;
  threadCount: number;
  postCount: number;
  reputationScore: number;
  joinedAt: number;
};

export type ForumBoardStatisticsRecord = {
  memberCount: number;
  memberCountLimited: boolean;
  newestMember: ForumStatisticsMemberRecord | null;
  topPoster: ForumStatisticsMemberRecord | null;
  reputationLeader: ForumStatisticsMemberRecord | null;
};

export type ForumCategoryLastThreadRecord = {
  threadId: string;
  slug: string;
  title: string;
  status: ForumThreadStatus;
  pinned: boolean;
  lastPostNumber?: number;
  lastPostPage?: number;
};

export type ForumCategoryRecord = {
  _id: string;
  _creationTime: number;
  slug: string;
  name: string;
  description: string;
  kind: ForumCategoryKind;
  parentCategoryId?: string;
  isPostable: boolean;
  status: ForumCategoryStatus;
  viewAccess: ForumCategoryViewAccess;
  threadAccess: ForumCategoryWriteAccess;
  replyAccess: ForumCategoryWriteAccess;
  pollAccess: ForumCategoryWriteAccess;
  position: number;
  threadCount: number;
  postCount: number;
  lastPostAt?: number;
  viewerHasRead?: boolean;
  viewerUnread?: boolean;
  lastThread?: ForumCategoryLastThreadRecord;
  viewerCanCreateThread?: boolean;
  viewerCanReply?: boolean;
  viewerCanCreatePoll?: boolean;
  viewerSubscribedToCategory?: boolean;
  ancestors?: ForumCategoryRecord[];
  children?: ForumCategoryRecord[];
};

export type AdminForumCategoryRecord = ForumCategoryRecord & {
  lastThreadId?: string;
  lastPostId?: string;
  moderators: ForumCategoryModeratorRecord[];
  createdAt: number;
  updatedAt: number;
};

export type ForumCategoryModeratorRecord = {
  _id: string;
  userId: string;
  username?: string;
  displayName: string;
  assignedAt: number;
  assignedBy?: string;
  assignedByName: string;
};

export type ForumCategorySectionRecord = {
  section: ForumCategoryRecord | null;
  boards: ForumCategoryRecord[];
  threadCount: number;
  postCount: number;
};

export type ForumThreadPrefixRecord = {
  _id?: string;
  _creationTime?: number;
  categoryId?: string;
  categorySlug?: string;
  categoryName?: string;
  slug: string;
  label: string;
  description?: string;
  color?: string;
  status?: ForumThreadPrefixStatus;
  position?: number;
};

export type AdminForumThreadPrefixRecord = ForumThreadPrefixRecord & {
  _id: string;
  _creationTime: number;
  status: ForumThreadPrefixStatus;
  position: number;
  createdAt: number;
  updatedAt: number;
  syncedThreads?: number;
  syncTruncated?: boolean;
};

export type ForumAnnouncementRecord = {
  _id: string;
  _creationTime: number;
  categoryId?: string;
  categorySlug?: string;
  categoryName?: string;
  slug: string;
  title: string;
  body: string;
  status: ForumPageStatus;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type AdminForumAnnouncementRecord = ForumAnnouncementRecord & {
  key: string;
  createdBy: string;
  updatedBy: string;
  createdByName: string;
  updatedByName: string;
};

export type ForumHelpDocumentRecord = {
  _id: string;
  _creationTime: number;
  slug: string;
  title: string;
  body: string;
  status: ForumPageStatus;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type ForumHelpDocumentSummaryRecord = Omit<
  ForumHelpDocumentRecord,
  "body"
> & {
  excerpt: string;
};

export type AdminForumHelpDocumentRecord = ForumHelpDocumentRecord & {
  createdBy: string;
  updatedBy: string;
  createdByName: string;
  updatedByName: string;
};

export type ForumCalendarEventRecord = {
  _id: string;
  _creationTime: number;
  slug: string;
  title: string;
  body: string;
  status: ForumCalendarEventStatus;
  startsAt: number;
  endsAt?: number;
  allDay: boolean;
  month: string;
  day: string;
  createdAt: number;
  updatedAt: number;
};

export type ForumCalendarEventSummaryRecord = Omit<
  ForumCalendarEventRecord,
  "body"
> & {
  excerpt: string;
};

export type AdminForumCalendarEventRecord = ForumCalendarEventRecord & {
  createdBy: string;
  updatedBy: string;
  createdByName: string;
  updatedByName: string;
};

export type ForumBoardRulesRecord = {
  _id: string;
  _creationTime: number;
  categoryId: string;
  categorySlug?: string;
  categoryName?: string;
  title: string;
  body: string;
  status: ForumPageStatus;
  createdAt: number;
  updatedAt: number;
};

export type AdminForumBoardRulesRecord = ForumBoardRulesRecord & {
  createdBy: string;
  updatedBy: string;
  createdByName: string;
  updatedByName: string;
};

export type ForumAttachmentRecord = {
  _id: string;
  _creationTime: number;
  threadId: string;
  postId?: string;
  filename: string;
  contentType: string;
  size: number;
  altText?: string;
  credit?: string;
  sourceUrl?: string;
  url: string;
  createdAt: number;
};

export type ForumAttachmentInput = {
  storageId: string;
  filename: string;
};

export type ForumThreadRecord = {
  _id: string;
  _creationTime: number;
  categoryId: string;
  categorySlug: string;
  prefixId?: string;
  prefix: ForumThreadPrefixRecord | null;
  slug: string;
  title: string;
  status: ForumThreadStatus;
  pinned: boolean;
  replyCount: number;
  viewCount: number;
  ratingCount: number;
  ratingAverage: number;
  createdAt: number;
  updatedAt: number;
  lastPostAt: number;
  lastPostNumber?: number;
  lastPostPage?: number;
  author: string;
  lastPostAuthor: string;
  viewerHasRead?: boolean;
  viewerUnread?: boolean;
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
  authorUsername?: string;
  authorImage?: string;
  authorLocation?: string;
  authorJoinedAt?: number;
  lastEditedAt?: number;
  lastEditedBy?: string;
  lastEditedByName?: string;
  lastEditReason?: string;
  editCount?: number;
  attachments?: ForumAttachmentRecord[];
};

export type ForumThreadDetailRecord = ForumThreadRecord & {
  body: string;
  lastEditedAt?: number;
  lastEditedBy?: string;
  lastEditedByName?: string;
  lastEditReason?: string;
  editCount: number;
  attachments: ForumAttachmentRecord[];
  viewerCanReply: boolean;
  viewerCanModerate: boolean;
  viewerCanEdit: boolean;
  viewerCanDelete: boolean;
  viewerSubscribed: boolean;
  viewerCanRateThread: boolean;
  viewerRating: number;
  viewerCanGiveReputation: boolean;
  viewerReputationScore: number;
};

export type ForumPollOptionRecord = {
  _id: string;
  label: string;
  position: number;
  voteCount: number;
  percent: number;
};

export type ForumPollRecord = {
  _id: string;
  _creationTime: number;
  threadId: string;
  categoryId: string;
  question: string;
  status: ForumPollStatus;
  optionCount: number;
  totalVotes: number;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  viewerCanEdit: boolean;
  viewerOptionId?: string;
  viewerCanVote: boolean;
  options: ForumPollOptionRecord[];
};

export type AdminForumThreadRecord = ForumThreadRecord & {
  categoryName?: string;
  lastPostId?: string;
  lockedAt?: number;
  lockedBy?: string;
  deletedAt?: number;
  deletedBy?: string;
  moderationReason?: string;
  body?: string;
};

export type ForumPostRecord = {
  _id: string;
  _creationTime: number;
  threadId: string;
  categoryId: string;
  authorId: string;
  body: string;
  status: ForumPostStatus;
  createdAt: number;
  updatedAt: number;
  author: string;
  postNumber?: number;
  postPage?: number;
  viewerCanEdit: boolean;
  viewerCanDelete: boolean;
  viewerCanGiveReputation: boolean;
  viewerReputationScore: number;
  role?: string;
  authorTitle?: string;
  authorRank?: string;
  authorPostCount?: number;
  authorReputationScore?: number;
  authorSignature?: string;
  authorShowSignatures?: boolean;
  authorDisplayName?: string;
  authorUsername?: string;
  authorImage?: string;
  authorLocation?: string;
  authorJoinedAt?: number;
  lastEditedAt?: number;
  lastEditedBy?: string;
  lastEditedByName?: string;
  lastEditReason?: string;
  editCount?: number;
  attachments?: ForumAttachmentRecord[];
};

export type MyForumProfileRecord = {
  _id?: string;
  userId: string;
  username: string;
  signature: string;
  customTitle: string;
  showSignatures: boolean;
  avatarUrl?: string;
  authAvatarUrl?: string;
  bio: string;
  birthday: string;
  location: string;
  timeZone: string;
  websiteUrl: string;
  threadCount: number;
  postCount: number;
  reputationScore: number;
  rank: string;
  trusted: boolean;
  activeWarningCount: number;
  activeWarningPoints: number;
  updatedAt?: number;
};

export type ForumNotificationPreferencesRecord = {
  _id?: string;
  userId: string;
  inAppReplies: boolean;
  inAppNewThreads: boolean;
  emailReplies: boolean;
  emailNewThreads: boolean;
  emailDestinationAvailable: boolean;
  emailDeliveryEnabled: boolean;
  emailDestinationLabel?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type ForumRelationshipKind = "buddy" | "ignore";

export type ForumRelationshipRecord = {
  _id: string;
  _creationTime: number;
  targetUserId: string;
  kind: ForumRelationshipKind;
  username: string;
  displayName: string;
  avatarUrl?: string;
  customTitle?: string;
  rank: string;
  postCount: number;
  reputationScore: number;
  createdAt: number;
  updatedAt: number;
};

export type MyForumRelationshipsRecord = {
  buddies: ForumRelationshipRecord[];
  ignored: ForumRelationshipRecord[];
};

export type MyForumReputationHistoryRecord = {
  _id: string;
  _creationTime: number;
  fromUserId: string;
  fromUsername: string;
  toUserId: string;
  toUsername: string;
  targetType: ForumReputationTargetType;
  score: -1 | 0 | 1;
  comment?: string;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  threadId: string;
  threadSlug: string;
  threadTitle: string;
  postId?: string;
  postNumber?: number;
  postPage?: number;
  createdAt: number;
  updatedAt: number;
};

export type MyForumWarningRecord = {
  _id: string;
  _creationTime: number;
  status: ForumWarningStatus;
  active: boolean;
  points: number;
  reason: string;
  moderator: string;
  categoryId?: string;
  categorySlug?: string;
  categoryName?: string;
  threadId?: string;
  threadSlug?: string;
  threadTitle?: string;
  postId?: string;
  postNumber?: number;
  postPage?: number;
  reportId?: string;
  expiresAt?: number;
  revokedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type MyPendingForumThreadRecord = {
  _id: string;
  _creationTime: number;
  type: "thread";
  title: string;
  excerpt: string;
  categoryId?: string;
  categorySlug?: string;
  categoryName?: string;
  createdAt: number;
  updatedAt: number;
};

export type MyPendingForumPostRecord = {
  _id: string;
  _creationTime: number;
  type: "reply";
  excerpt: string;
  threadId?: string;
  threadSlug?: string;
  threadTitle?: string;
  categoryId?: string;
  categorySlug?: string;
  categoryName?: string;
  createdAt: number;
  updatedAt: number;
};

export type MyPendingForumContentRecord = {
  threads: MyPendingForumThreadRecord[];
  posts: MyPendingForumPostRecord[];
};

export type ForumMemberRecord = {
  _id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  customTitle?: string;
  location?: string;
  rank: string;
  threadCount: number;
  postCount: number;
  reputationScore: number;
  joinedAt: number;
  isOnline: boolean;
  lastSeenAt?: number;
  onlineLocation?: ForumPresenceLocationRecord;
};

export type ForumNotificationRecord = {
  _id: string;
  _creationTime: number;
  type: ForumNotificationType;
  status: ForumNotificationStatus;
  threadId: string;
  threadSlug: string;
  threadTitle: string;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  postId?: string;
  postNumber?: number;
  postPage?: number;
  actor: string;
  createdAt: number;
  readAt?: number;
};

export type ForumPrivateMessageRecord = {
  _id: string;
  _creationTime: number;
  senderUserId: string;
  recipientUserId: string;
  senderUsername: string;
  recipientUsername: string;
  otherUsername: string;
  box: ForumPrivateMessageBox;
  sourceBox: Exclude<ForumPrivateMessageBox, "trash">;
  subject: string;
  body?: string;
  excerpt?: string;
  readAt?: number;
  unread: boolean;
  trashedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type AdminForumPostRecord = ForumPostRecord & {
  deletedAt?: number;
  deletedBy?: string;
  moderationReason?: string;
  threadSlug?: string;
  threadTitle?: string;
  categorySlug?: string;
  excerpt?: string;
};

export type AdminForumContentEditRecord = {
  _id: string;
  _creationTime: number;
  entityType: "thread" | "post";
  threadId: string;
  postId?: string;
  actorUserId: string;
  actor: string;
  targetUserId: string;
  target: string;
  previousTitle?: string;
  nextTitle?: string;
  previousPrefixId?: string;
  nextPrefixId?: string;
  previousPrefixLabel?: string;
  nextPrefixLabel?: string;
  previousBody: string;
  nextBody: string;
  editReason?: string;
  createdAt: number;
};

export type AdminForumReportRecord = {
  _id: string;
  _creationTime: number;
  reporterId: string;
  reporter: string;
  entityType: ForumReportEntityType;
  threadId?: string;
  threadSlug?: string;
  threadTitle?: string;
  threadPrefix: ForumThreadPrefixRecord | null;
  postId?: string;
  messageId?: string;
  targetUserId?: string;
  targetUser?: string;
  targetActiveWarningCount: number;
  targetActiveWarningPoints: number;
  postNumber?: number;
  postPage?: number;
  categoryId?: string;
  categorySlug?: string;
  categoryName?: string;
  reason: string;
  details?: string;
  status: ForumReportStatus;
  excerpt: string;
  snapshotTitle?: string;
  snapshotPrefixSlug?: string;
  snapshotPrefixLabel?: string;
  snapshotPrefixColor?: string;
  snapshotBody?: string;
  snapshotAuthor?: string;
  snapshotPostNumber?: number;
  snapshotCreatedAt?: number;
  createdAt: number;
  updatedAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewer?: string;
  moderationNote?: string;
};

export type AdminForumWarningRecord = {
  _id: string;
  _creationTime: number;
  targetUserId: string;
  targetUser: string;
  actorUserId: string;
  actor: string;
  status: ForumWarningStatus;
  points: number;
  reason: string;
  moderationNote?: string;
  categoryId?: string;
  categorySlug?: string;
  categoryName?: string;
  threadId?: string;
  threadSlug?: string;
  threadTitle?: string;
  postId?: string;
  postNumber?: number;
  postPage?: number;
  reportId?: string;
  reportStatus?: ForumReportStatus;
  expiresAt?: number;
  revokedAt?: number;
  revokedBy?: string;
  revokedByName?: string;
  createdAt: number;
  updatedAt: number;
};

export type AdminForumModerationEventRecord = {
  _id: string;
  _creationTime: number;
  actorUserId: string;
  actor: string;
  entityType: ForumModerationEventEntityType;
  entityId: string;
  eventType: ForumModerationEventType;
  message: string;
  categoryId?: string;
  categorySlug?: string;
  categoryName?: string;
  threadId?: string;
  threadSlug?: string;
  threadTitle?: string;
  postId?: string;
  reportId?: string;
  warningId?: string;
  pollId?: string;
  metadataJson: string;
  createdAt: number;
};

export type ForumOverviewRecord = {
  categories: ForumCategoryRecord[];
  sections: ForumCategorySectionRecord[];
  announcements: ForumAnnouncementRecord[];
  newestThreads: ForumThreadRecord[];
  online: ForumOnlineSummaryRecord;
  statistics: ForumBoardStatisticsRecord;
  totals: {
    categories: number;
    threads: number;
    posts: number;
  };
};

export type AdminForumOverviewRecord = {
  categories: AdminForumCategoryRecord[];
  recentThreads: AdminForumThreadRecord[];
  recentPosts: AdminForumPostRecord[];
  totals: {
    categories: number;
    threads: number;
    posts: number;
    pendingThreads: number;
    pendingPosts: number;
    hiddenThreads: number;
    hiddenPosts: number;
    pinnedThreads: number;
    lockedThreads: number;
  };
};

export type ConvexPostRecord = {
  _id: string;
  _creationTime: number;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  tags: string[];
  status: "draft" | "published";
  publishedAt: number;
  readingMinutes: number;
  featured: boolean;
  imageUrl?: string;
  imageAlt?: string;
  imageCredit?: string;
};

export type SitePageRecord = {
  _id: string;
  _creationTime: number;
  slug: string;
  title: string;
  subtitle: string;
  heroHeading: string;
  heroBody: string;
  body: string;
  status: "draft" | "published";
  updatedAt: number;
  showImage?: boolean;
  imageUrl?: string;
  imageLightUrl?: string;
  imageAlt?: string;
  imageCredit?: string;
};

export type PortfolioProjectRecord = {
  _id: string;
  _creationTime: number;
  slug: string;
  name: string;
  type: string;
  role: string;
  timeframe: string;
  summary: string;
  problem: string;
  approach: string;
  outcome: string;
  status: "draft" | "published" | "archived";
  order: number;
  tags: string[];
  imageUrl?: string;
  imageAlt?: string;
  homepageUrl?: string;
  repoUrl?: string;
  writeupUrl?: string;
};

export type AdminUserRecord = {
  _id: string;
  _creationTime: number;
  name?: string;
  email?: string;
  username?: string;
  usernameNormalized?: string;
  usernameSource?: "auto" | "chosen";
  role?: UserRole;
  roleAssignedAt?: number;
  roleAssignedBy?: string;
  forumRole?: ForumRole;
  forumRoleAssignedAt?: number;
  forumRoleAssignedBy?: string;
  contactEmail?: string;
  bio?: string;
  onboardedAt?: number;
  forumTrustedAt?: number;
  forumTrustedBy?: string;
  forumTrustRevokedAt?: number;
  forumTrustRevokedBy?: string;
  forumSuspendedUntil?: number;
  forumSuspendedReason?: string;
  forumSuspendedBy?: string;
  forumBannedAt?: number;
  forumBannedReason?: string;
  forumBannedBy?: string;
};

export type ViewerUserRecord = {
  _id: string;
  _creationTime: number;
  name?: string;
  email?: string;
  username?: string;
  usernameNormalized?: string;
  usernameSource?: "auto" | "chosen";
  role?: UserRole;
  forumRole?: ForumRole;
  contactEmail?: string;
  bio?: string;
  onboardedAt?: number;
};

export type PublicProfileCommentRecord = {
  _id: string;
  entityType: CommentEntityType;
  entityId: string;
  body: string;
  createdAt: number;
};

export type PublicProfileForumThreadRecord = {
  _id: string;
  categorySlug: string;
  prefix: ForumThreadPrefixRecord | null;
  slug: string;
  title: string;
  replyCount: number;
  createdAt: number;
  lastPostAt: number;
};

export type PublicProfileForumReplyRecord = {
  _id: string;
  categorySlug: string;
  threadSlug: string;
  threadTitle: string;
  prefix: ForumThreadPrefixRecord | null;
  excerpt: string;
  postNumber?: number;
  postPage?: number;
  createdAt: number;
};

export type PublicForumProfileRecord = {
  bio?: string;
  birthday?: string;
  customTitle?: string;
  location?: string;
  signature?: string;
  showSignatures: boolean;
  timeZone?: string;
  threadCount: number;
  postCount: number;
  reputationScore: number;
  rank: string;
  trusted: boolean;
  avatarUrl?: string;
  websiteUrl?: string;
  joinedAt: number;
  isOnline: boolean;
  lastSeenAt?: number;
  onlineLocation?: {
    label: string;
    href?: string;
  };
};

export type PublicProfileRecord = {
  user: {
    _creationTime: number;
    username: string;
    usernameNormalized: string;
    bio?: string;
    role?: UserRole;
    usernameSource?: "auto" | "chosen";
    onboardedAt?: number;
  };
  forumProfile: PublicForumProfileRecord;
  isCurrentUser: boolean;
  recentComments: PublicProfileCommentRecord[];
  recentForumThreads: PublicProfileForumThreadRecord[];
  recentForumReplies: PublicProfileForumReplyRecord[];
};

export type InteractionSummaryRecord = {
  comments: number;
  score: number;
  saves: number;
  viewer: { vote: number; saved: boolean } | null;
};

export type AdminCommentRecord = {
  _id: string;
  userId: string;
  entityType: CommentEntityType;
  entityId: string;
  parentId?: string;
  body: string;
  status?: CommentStatus;
  updatedAt?: number;
  deletedAt?: number;
  deletedBy?: string;
  createdAt: number;
  author: string;
};

export type AdminInteractionRecord = {
  _id: string;
  userId: string;
  entityType: "post" | "hnStory";
  entityId: string;
  vote: number;
  saved: boolean;
  updatedAt: number;
  author: string;
};

export type AdminApiKeyRecord = {
  _id: string;
  _creationTime: number;
  name: string;
  tokenPreview: string;
  createdBy: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
};

export type ContactRequestRecord = {
  _id: string;
  _creationTime: number;
  name: string;
  email: string;
  subject: string;
  description: string;
  status: ContactRequestStatus;
  source?: string;
  userAgent?: string;
  emailedAt?: number;
  emailError?: string;
  createdAt: number;
  updatedAt: number;
};

export type NewsletterSubscriberRecord = {
  _id: string;
  _creationTime: number;
  email: string;
  status: "pending" | "confirmed" | "unsubscribed" | "bounced";
  source: string;
  dailyOptIn: boolean;
  weeklyOptIn: boolean;
  resendContactId?: string;
  resendSyncStatus: "idle" | "synced" | "failed" | "not_configured";
  resendSyncedAt?: number;
  resendError?: string;
  createdAt: number;
  confirmedAt?: number;
  unsubscribedAt?: number;
  updatedAt: number;
};

export type NewsletterIssueRecord = {
  _id: string;
  _creationTime: number;
  slug: string;
  subject: string;
  previewText: string;
  body: string;
  edition?: "daily-signal" | "weekly-field-note";
  editorialVersion?: number;
  qualityScore?: number;
  status: "draft" | "scheduled" | "sent" | "cancelled" | "failed";
  linkedPostSlug?: string;
  forumCategorySlug?: string;
  forumThreadSlug?: string;
  scheduledAt?: number;
  sentAt?: number;
  resendBroadcastId?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
};

export type DailyNewsletterSettingsRecord = {
  enabled: boolean;
  testMode: boolean;
  reviewRequired: boolean;
  weeklyEnabled: boolean;
  weeklyReviewRequired: boolean;
  timeZone: string;
  sendTimeLocal: string;
  maxIndexedArticles: number;
  maxNewsletterStories: number;
  siteUrl: string;
  cron: {
    hnRefreshUtc: string;
    scheduleCheckUtc: string;
    weeklyFieldNoteUtc: string;
  };
};

export type DailyNewsletterRunRecord = {
  _id: string;
  _creationTime: number;
  runDate: string;
  snapshotDate?: string;
  status: "running" | "generated" | "sent" | "skipped" | "failed";
  mode: "cron" | "manual" | "test";
  sendEnabled: boolean;
  startedAt: number;
  attemptCount?: number;
  completedAt?: number;
  sentAt?: number;
  issueId?: string;
  storyCount: number;
  topStoryIds: number[];
  qualityScore?: number;
  inputTokens?: number;
  outputTokens?: number;
  resendBroadcastId?: string;
  errorMessage?: string;
  updatedAt: number;
};

export type PublicNewsletterIssueRecord = Omit<
  NewsletterIssueRecord,
  | "status"
  | "linkedPostSlug"
  | "scheduledAt"
  | "resendBroadcastId"
  | "errorMessage"
>;

export type NewsletterEditorialAnalyticsRecord = {
  issueId: string;
  slug: string;
  subject: string;
  status: NewsletterIssueRecord["status"];
  edition?: NewsletterIssueRecord["edition"];
  qualityScore?: number;
  sentAt?: number;
  delivered: number;
  opened: number;
  bounced: number;
  complained: number;
  clicked: number;
  archiveViews: number;
  sourceClicks: number;
  forumClicks: number;
  forumReplies: number;
  saves: number;
};

export type NewsletterSendLogRecord = {
  _id: string;
  _creationTime: number;
  runDate: string;
  issueId?: string;
  provider: "resend";
  status: "queued" | "sent" | "skipped" | "failed";
  resendBroadcastId?: string;
  errorMessage?: string;
  createdAt: number;
};

export type NewsSnapshotRecord = {
  _id: string;
  _creationTime: number;
  snapshotDate: string;
  status: "running" | "complete" | "failed";
  startedAt: number;
  completedAt?: number;
  storyCount: number;
  errorMessage?: string;
};

export type NewsStoryRecord = {
  hnItemId: number;
  snapshotDate?: string;
  rank: number;
  title: string;
  url?: string;
  host?: string;
  by?: string;
  score?: number;
  descendants?: number;
  timePosted?: number;
  fetchedAt?: number;
  platformStats?: {
    comments: number;
    score: number;
    saves: number;
  };
};

export type NewsTimelineRecord = {
  snapshots: NewsSnapshotRecord[];
  snapshot: NewsSnapshotRecord | null;
  stories: NewsStoryRecord[];
};

export type SystemLogRecord = {
  _id: string;
  _creationTime: number;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  occurrences: number;
  level: "info" | "warn" | "error";
  status: "open" | "reviewed" | "resolved";
  source: "client" | "server" | "api" | "convex";
  scope: string;
  eventType: string;
  message: string;
  name?: string;
  stack?: string;
  fingerprint: string;
  path?: string;
  url?: string;
  method?: string;
  statusCode?: number;
  requestId?: string;
  sessionId?: string;
  userAgent?: string;
  component?: string;
  action?: string;
  actorUserId?: string;
  apiKeyId?: string;
  entityType?: string;
  entityId?: string;
  metadataJson?: string;
};

export type AnalyticsSource = "client" | "server" | "api" | "convex";

export type AnalyticsEventRecord = {
  _id: string;
  _creationTime: number;
  name: string;
  source: AnalyticsSource;
  path?: string;
  route?: string;
  title?: string;
  referrer?: string;
  sessionId?: string;
  visitorId?: string;
  actorUserId?: string;
  userAgent?: string;
  device?: string;
  metadataJson?: string;
  createdAt: number;
};

export type AnalyticsSummaryRecord = {
  windowDays: number;
  sampleSize: number;
  totals: {
    events: number;
    pageViews: number;
    visitors: number;
    sessions: number;
    signedInEvents: number;
    todayEvents: number;
  };
  topEvents: Array<{ key: string; count: number }>;
  topPages: Array<{ key: string; count: number }>;
  referrers: Array<{ key: string; count: number }>;
  sources: Array<{ key: AnalyticsSource; count: number }>;
  daily: Array<{ date: string; events: number; pageViews: number }>;
  recent: AnalyticsEventRecord[];
};

export type GithubPortfolioSnapshotRecord = {
  _id: string;
  _creationTime: number;
  key: string;
  metricsJson: string;
  source: "cron" | "manual";
  refreshedAt: number;
  lastErrorMessage?: string;
  lastErrorAt?: number;
};

export type AdminOverviewRecord = {
  user: AdminUserRecord;
  totals: {
    posts: number;
    publishedPosts: number;
    commentsSample: number;
    interactionsSample: number;
    users: number;
    owners: number;
    admins: number;
    readers: number;
    newsletterSubscribers: number;
    confirmedSubscribers: number;
    newsletterIssues: number;
    portfolioProjects: number;
    sitePages: number;
    newsSnapshots: number;
    contactRequestsSample: number;
    openContactRequests: number;
    openSystemLogs: number;
    analyticsEventsSample: number;
  };
  recentComments: AdminCommentRecord[];
  recentInteractions: AdminInteractionRecord[];
};

export const convexRefs = {
  admin: {
    viewer: makeFunctionReference<
      "query",
      Record<string, never>,
      {
        user: AdminUserRecord | null;
        isOwner: boolean;
        canAccessAdmin: boolean;
        canModerateForum: boolean;
        canAdminForum: boolean;
        ownerExists: boolean;
      }
    >("admin:viewer"),
    overview: makeFunctionReference<
      "query",
      Record<string, never>,
      AdminOverviewRecord
    >("admin:overview"),
    claimInitialOwner: makeFunctionReference<
      "mutation",
      { bootstrapToken: string },
      AdminUserRecord
    >("admin:claimInitialOwner"),
    listUsers: makeFunctionReference<
      "query",
      Record<string, never>,
      AdminUserRecord[]
    >("admin:listUsers"),
    updateUserRole: makeFunctionReference<
      "mutation",
      { userId: string; role: UserRole },
      AdminUserRecord
    >("admin:updateUserRole"),
    updateUserForumRole: makeFunctionReference<
      "mutation",
      { userId: string; forumRole: ForumRole | null },
      AdminUserRecord
    >("admin:updateUserForumRole"),
    updateUserForumTrust: makeFunctionReference<
      "mutation",
      { userId: string; trusted: boolean },
      AdminUserRecord
    >("admin:updateUserForumTrust"),
    updateUserForumStatus: makeFunctionReference<
      "mutation",
      {
        userId: string;
        status: ForumAccountStatus;
        reason?: string;
        suspendedUntil?: number;
      },
      AdminUserRecord
    >("admin:updateUserForumStatus"),
    listPosts: makeFunctionReference<
      "query",
      Record<string, never>,
      ConvexPostRecord[]
    >("admin:listPosts"),
    upsertPost: makeFunctionReference<
      "mutation",
      {
        post: {
          slug?: string;
          title: string;
          excerpt: string;
          body: string;
          tags: string[];
          status: "draft" | "published";
          publishedAt: number;
          readingMinutes: number;
          featured: boolean;
          imageUrl?: string;
          imageAlt?: string;
          imageCredit?: string;
        };
      },
      ConvexPostRecord | null
    >("admin:upsertPost"),
    deletePost: makeFunctionReference<
      "mutation",
      { slug: string },
      { deleted: boolean }
    >("admin:deletePost"),
    generateUploadUrl: makeFunctionReference<
      "mutation",
      Record<string, never>,
      string
    >("admin:generateUploadUrl"),
    resolveStorageUrl: makeFunctionReference<
      "mutation",
      { storageId: string },
      string | null
    >("admin:resolveStorageUrl"),
    listSitePages: makeFunctionReference<
      "query",
      Record<string, never>,
      SitePageRecord[]
    >("admin:listSitePages"),
    upsertSitePage: makeFunctionReference<
      "mutation",
      {
        page: {
          slug?: string;
          title: string;
          subtitle: string;
          heroHeading: string;
          heroBody: string;
          body: string;
          status: "draft" | "published";
          showImage?: boolean;
          imageUrl?: string;
          imageLightUrl?: string;
          imageAlt?: string;
          imageCredit?: string;
        };
      },
      SitePageRecord | null
    >("admin:upsertSitePage"),
    deleteSitePage: makeFunctionReference<
      "mutation",
      { slug: string },
      { deleted: boolean }
    >("admin:deleteSitePage"),
    listPortfolioProjects: makeFunctionReference<
      "query",
      Record<string, never>,
      PortfolioProjectRecord[]
    >("admin:listPortfolioProjects"),
    upsertPortfolioProject: makeFunctionReference<
      "mutation",
      {
        project: {
          slug?: string;
          name: string;
          type: string;
          role: string;
          timeframe: string;
          summary: string;
          problem: string;
          approach: string;
          outcome: string;
          status: "draft" | "published" | "archived";
          order: number;
          tags: string[];
          imageUrl?: string;
          imageAlt?: string;
          homepageUrl?: string;
          repoUrl?: string;
          writeupUrl?: string;
        };
      },
      PortfolioProjectRecord | null
    >("admin:upsertPortfolioProject"),
    deletePortfolioProject: makeFunctionReference<
      "mutation",
      { slug: string },
      { deleted: boolean }
    >("admin:deletePortfolioProject"),
    listComments: makeFunctionReference<
      "query",
      { entityType?: CommentEntityType; entityId?: string },
      AdminCommentRecord[]
    >("admin:listComments"),
    deleteComment: makeFunctionReference<
      "mutation",
      { commentId: string },
      { deleted: boolean }
    >("admin:deleteComment"),
    listInteractions: makeFunctionReference<
      "query",
      { entityType?: AdminInteractionRecord["entityType"]; entityId?: string },
      AdminInteractionRecord[]
    >("admin:listInteractions"),
    deleteInteraction: makeFunctionReference<
      "mutation",
      { interactionId: string },
      { deleted: boolean }
    >("admin:deleteInteraction"),
    listApiKeys: makeFunctionReference<
      "query",
      Record<string, never>,
      AdminApiKeyRecord[]
    >("admin:listApiKeys"),
    createApiKey: makeFunctionReference<
      "mutation",
      { name: string; tokenHash: string; tokenPreview: string },
      AdminApiKeyRecord
    >("admin:createApiKey"),
    revokeApiKey: makeFunctionReference<
      "mutation",
      { keyId: string },
      { revoked: boolean }
    >("admin:revokeApiKey"),
    listContactRequests: makeFunctionReference<
      "query",
      { status?: ContactRequestStatus },
      ContactRequestRecord[]
    >("admin:listContactRequests"),
    updateContactRequestStatus: makeFunctionReference<
      "mutation",
      { requestId: string; status: ContactRequestStatus },
      { updated: boolean }
    >("admin:updateContactRequestStatus"),
    listForumCategories: makeFunctionReference<
      "query",
      { includeArchived?: boolean },
      AdminForumCategoryRecord[]
    >("forum:listCategoriesAdmin"),
    listForumCategoryModerators: makeFunctionReference<
      "query",
      { categoryId?: string },
      ForumCategoryModeratorRecord[]
    >("forum:listCategoryModeratorsAdmin"),
    listForumThreadPrefixes: makeFunctionReference<
      "query",
      { includeArchived?: boolean; categoryId?: string },
      AdminForumThreadPrefixRecord[]
    >("forum:listThreadPrefixesAdmin"),
    listForumAnnouncements: makeFunctionReference<
      "query",
      { includeArchived?: boolean; categoryId?: string },
      AdminForumAnnouncementRecord[]
    >("forum:listAnnouncementsAdmin"),
    listForumHelpDocuments: makeFunctionReference<
      "query",
      { includeArchived?: boolean },
      AdminForumHelpDocumentRecord[]
    >("forum:listHelpDocumentsAdmin"),
    listForumCalendarEvents: makeFunctionReference<
      "query",
      { includeArchived?: boolean; month?: string },
      AdminForumCalendarEventRecord[]
    >("forum:listCalendarEventsAdmin"),
    listForumBoardRules: makeFunctionReference<
      "query",
      { includeArchived?: boolean; categoryId?: string },
      AdminForumBoardRulesRecord[]
    >("forum:listBoardRulesAdmin"),
    forumOverview: makeFunctionReference<
      "query",
      Record<string, never>,
      AdminForumOverviewRecord
    >("forum:adminOverview"),
    upsertForumCategory: makeFunctionReference<
      "mutation",
      {
        categoryId?: string;
        slug?: string;
        name: string;
        description?: string;
        kind?: ForumCategoryKind;
        parentCategoryId?: string;
        status: ForumCategoryStatus;
        viewAccess?: ForumCategoryViewAccess;
        threadAccess?: ForumCategoryWriteAccess;
        replyAccess?: ForumCategoryWriteAccess;
        pollAccess?: ForumCategoryWriteAccess;
        position?: number;
      },
      AdminForumCategoryRecord
    >("forum:upsertForumCategory"),
    assignForumCategoryModerator: makeFunctionReference<
      "mutation",
      { categoryId: string; username: string },
      {
        assigned: boolean;
        moderator: ForumCategoryModeratorRecord;
        category: AdminForumCategoryRecord;
      }
    >("forum:assignCategoryModerator"),
    removeForumCategoryModerator: makeFunctionReference<
      "mutation",
      { moderatorId: string },
      { removed: boolean; category: AdminForumCategoryRecord | null }
    >("forum:removeCategoryModerator"),
    reorderForumCategories: makeFunctionReference<
      "mutation",
      { categoryIds: string[] },
      { updated: boolean }
    >("forum:reorderForumCategories"),
    ensureDefaultForumCategories: makeFunctionReference<
      "mutation",
      Record<string, never>,
      { created: boolean; categoryIds: string[] }
    >("forum:ensureDefaultForumCategories"),
    upsertForumThreadPrefix: makeFunctionReference<
      "mutation",
      {
        prefixId?: string;
        categoryId?: string;
        slug: string;
        label: string;
        description?: string;
        color?: string;
        status: ForumThreadPrefixStatus;
        position?: number;
      },
      AdminForumThreadPrefixRecord
    >("forum:upsertThreadPrefixAdmin"),
    upsertForumAnnouncement: makeFunctionReference<
      "mutation",
      {
        announcementId?: string;
        categoryId?: string;
        slug: string;
        title: string;
        body: string;
        status: ForumPageStatus;
        position?: number;
      },
      AdminForumAnnouncementRecord
    >("forum:upsertAnnouncementAdmin"),
    upsertForumHelpDocument: makeFunctionReference<
      "mutation",
      {
        helpDocumentId?: string;
        slug: string;
        title: string;
        body: string;
        status: ForumPageStatus;
        position?: number;
      },
      AdminForumHelpDocumentRecord
    >("forum:upsertHelpDocumentAdmin"),
    upsertForumCalendarEvent: makeFunctionReference<
      "mutation",
      {
        eventId?: string;
        slug: string;
        title: string;
        body: string;
        status: ForumCalendarEventStatus;
        startsAt: number;
        endsAt?: number;
        allDay?: boolean;
      },
      AdminForumCalendarEventRecord
    >("forum:upsertCalendarEventAdmin"),
    upsertForumBoardRules: makeFunctionReference<
      "mutation",
      {
        rulesId?: string;
        categoryId: string;
        title: string;
        body: string;
        status: ForumPageStatus;
      },
      AdminForumBoardRulesRecord
    >("forum:upsertBoardRulesAdmin"),
    listForumThreads: makeFunctionReference<
      "query",
      { categoryId?: string; status?: ForumThreadStatus; limit?: number },
      AdminForumThreadRecord[]
    >("forum:listForumThreads"),
    listForumPosts: makeFunctionReference<
      "query",
      { threadId?: string; status?: ForumPostStatus; limit?: number },
      AdminForumPostRecord[]
    >("forum:listForumPosts"),
    getForumThread: makeFunctionReference<
      "query",
      {
        threadId: string;
        paginationOpts: ConvexPaginationOpts;
        focusPostId?: string;
      },
      {
        category: AdminForumCategoryRecord;
        thread: AdminForumThreadRecord;
        poll: ForumPollRecord | null;
        replies: {
          page: AdminForumPostRecord[];
          isDone: boolean;
          continueCursor: string;
        };
        focusPost: AdminForumPostRecord | null;
      }
    >("forum:getForumThread"),
    listForumContentEdits: makeFunctionReference<
      "query",
      { threadId: string; postId?: string; limit?: number },
      AdminForumContentEditRecord[]
    >("forum:listForumContentEdits"),
    updateForumThreadModeration: makeFunctionReference<
      "mutation",
      {
        threadId: string;
        status?: ForumThreadStatus;
        pinned?: boolean;
        moderationReason?: string;
      },
      { updated: boolean; thread: AdminForumThreadRecord }
    >("forum:updateForumThreadModeration"),
    moveForumThread: makeFunctionReference<
      "mutation",
      {
        threadId: string;
        targetCategoryId: string;
        moderationReason?: string;
      },
      {
        updated: boolean;
        thread: AdminForumThreadRecord;
        previousCategorySlug: string;
        nextCategorySlug: string;
        threadSlug: string;
      }
    >("forum:moveForumThread"),
    moveForumPosts: makeFunctionReference<
      "mutation",
      {
        postIds: string[];
        targetThreadId: string;
        moderationReason?: string;
      },
      {
        moved: number;
        sourceThread: AdminForumThreadRecord;
        targetThread: AdminForumThreadRecord;
        postIds: string[];
        nextPostNumbers: number[];
      }
    >("forum:moveForumPosts"),
    splitForumPosts: makeFunctionReference<
      "mutation",
      {
        postIds: string[];
        targetCategoryId: string;
        title: string;
        prefixId?: string | null;
        moderationReason?: string;
      },
      {
        split: number;
        sourceThread: AdminForumThreadRecord;
        newThread: AdminForumThreadRecord;
        promotedPostId: string;
        postIds: string[];
        nextPostNumbers: number[];
      }
    >("forum:splitForumPosts"),
    mergeForumThread: makeFunctionReference<
      "mutation",
      {
        sourceThreadId: string;
        targetThreadId: string;
        moderationReason?: string;
      },
      {
        merged: number;
        sourceThread: AdminForumThreadRecord;
        targetThread: AdminForumThreadRecord;
        sourceOpenerPostId: string;
        postIds: string[];
        nextPostNumbers: number[];
      }
    >("forum:mergeForumThread"),
    updateForumPostModeration: makeFunctionReference<
      "mutation",
      {
        postId: string;
        status: ForumPostStatus;
        moderationReason?: string;
      },
      { updated: boolean; post: AdminForumPostRecord }
    >("forum:updateForumPostModeration"),
    listForumReports: makeFunctionReference<
      "query",
      { status?: ForumReportStatus; limit?: number },
      AdminForumReportRecord[]
    >("forum:listForumReports"),
    listForumModerationEvents: makeFunctionReference<
      "query",
      {
        entityType?: ForumModerationEventEntityType;
        entityId?: string;
        categoryId?: string;
        threadId?: string;
        limit?: number;
      },
      AdminForumModerationEventRecord[]
    >("forum:listForumModerationEvents"),
    updateForumReportStatus: makeFunctionReference<
      "mutation",
      {
        reportId: string;
        status: ForumReportStatus;
        moderationNote?: string;
      },
      { updated: boolean; report: AdminForumReportRecord }
    >("forum:updateForumReportStatus"),
    listForumWarnings: makeFunctionReference<
      "query",
      {
        targetUserId?: string;
        status?: ForumWarningStatus;
        limit?: number;
      },
      AdminForumWarningRecord[]
    >("forum:listForumWarnings"),
    issueForumWarning: makeFunctionReference<
      "mutation",
      {
        targetUserId: string;
        points: number;
        reason: string;
        moderationNote?: string;
        expiresAt?: number;
        categoryId?: string;
        threadId?: string;
        postId?: string;
        reportId?: string;
      },
      {
        issued: boolean;
        warning: AdminForumWarningRecord;
        report: AdminForumReportRecord | null;
      }
    >("forum:issueForumWarning"),
    updateForumWarningStatus: makeFunctionReference<
      "mutation",
      {
        warningId: string;
        status: ForumWarningStatus;
        moderationNote?: string;
      },
      { updated: boolean; warning: AdminForumWarningRecord }
    >("forum:updateForumWarningStatus"),
    updateForumPollStatus: makeFunctionReference<
      "mutation",
      { pollId: string; status: ForumPollStatus },
      { updated: boolean; poll: ForumPollRecord | null }
    >("forum:updateForumPollStatus"),
    listNewsletterSubscribers: makeFunctionReference<
      "query",
      Record<string, never>,
      NewsletterSubscriberRecord[]
    >("newsletter:listAdminSubscribers"),
    listNewsletterIssues: makeFunctionReference<
      "query",
      Record<string, never>,
      NewsletterIssueRecord[]
    >("newsletter:listAdminIssues"),
    upsertNewsletterIssue: makeFunctionReference<
      "mutation",
      {
        issue: {
          slug?: string;
          subject: string;
          previewText: string;
          body: string;
          status?: NewsletterIssueRecord["status"];
          linkedPostSlug?: string;
          scheduledAt?: number;
        };
      },
      NewsletterIssueRecord | null
    >("newsletter:upsertAdminIssue"),
    sendNewsletterIssueTest: makeFunctionReference<
      "mutation",
      { slug: string; to?: string },
      { queued: boolean }
    >("newsletter:sendAdminIssueTest"),
    sendNewsletterIssueNow: makeFunctionReference<
      "mutation",
      { slug: string },
      { queued: boolean }
    >("newsletter:sendAdminIssueNow"),
    scheduleNewsletterIssue: makeFunctionReference<
      "mutation",
      { slug: string; scheduledAt: number },
      { scheduled: boolean }
    >("newsletter:scheduleAdminIssue"),
    cancelNewsletterIssue: makeFunctionReference<
      "mutation",
      { slug: string },
      { cancelled: boolean }
    >("newsletter:cancelAdminIssue"),
    dailyNewsletterSettings: makeFunctionReference<
      "query",
      Record<string, never>,
      DailyNewsletterSettingsRecord
    >("dailyNewsletter:adminSettings"),
    updateDailyNewsletterSettings: makeFunctionReference<
      "mutation",
      {
        enabled?: boolean;
        testMode?: boolean;
        reviewRequired?: boolean;
        weeklyEnabled?: boolean;
        weeklyReviewRequired?: boolean;
        timeZone?: string;
        sendTimeLocal?: string;
        maxIndexedArticles?: number;
        maxNewsletterStories?: number;
        siteUrl?: string;
      },
      DailyNewsletterSettingsRecord
    >("dailyNewsletter:updateAdminSettings"),
    queueWeeklyFieldNote: makeFunctionReference<
      "mutation",
      { runDate?: string; force?: boolean },
      { queued: boolean }
    >("dailyNewsletter:queueAdminWeeklyFieldNote"),
    queueDailyNewsletter: makeFunctionReference<
      "mutation",
      {
        runDate?: string;
        force?: boolean;
        sendEnabled?: boolean;
        testMode?: boolean;
      },
      { queued: boolean }
    >("dailyNewsletter:queueAdminDailyNewsletter"),
    listDailyNewsletterRuns: makeFunctionReference<
      "query",
      Record<string, never>,
      DailyNewsletterRunRecord[]
    >("dailyNewsletter:listAdminRuns"),
    listNewsletterSendLogs: makeFunctionReference<
      "query",
      { runDate?: string },
      NewsletterSendLogRecord[]
    >("dailyNewsletter:listAdminSendLogs"),
    newsletterEditorialAnalytics: makeFunctionReference<
      "query",
      Record<string, never>,
      NewsletterEditorialAnalyticsRecord[]
    >("newsletter:adminEditorialAnalytics"),
    listSystemLogs: makeFunctionReference<
      "query",
      {
        status?: SystemLogRecord["status"];
        level?: SystemLogRecord["level"];
        source?: SystemLogRecord["source"];
        limit?: number;
      },
      SystemLogRecord[]
    >("systemLogs:listAdmin"),
    summarySystemLogs: makeFunctionReference<
      "query",
      Record<string, never>,
      {
        sampleSize: {
          open: number;
          reviewed: number;
          resolved: number;
          errors: number;
          warnings: number;
        };
        newestOpenAt: number | null;
      }
    >("systemLogs:summaryAdmin"),
    updateSystemLogStatus: makeFunctionReference<
      "mutation",
      { logId: string; status: SystemLogRecord["status"] },
      { updated: boolean }
    >("systemLogs:updateStatusAdmin"),
    deleteSystemLog: makeFunctionReference<
      "mutation",
      { logId: string },
      { deleted: boolean }
    >("systemLogs:deleteAdmin"),
    analyticsSummary: makeFunctionReference<
      "query",
      { days?: number },
      AnalyticsSummaryRecord
    >("analytics:summaryAdmin"),
    analyticsEvents: makeFunctionReference<
      "query",
      { name?: string; source?: AnalyticsSource; limit?: number },
      AnalyticsEventRecord[]
    >("analytics:listAdmin"),
  },
  contact: {
    submit: makeFunctionReference<
      "mutation",
      {
        request: {
          name: string;
          email: string;
          subject: string;
          description: string;
          source?: string;
          userAgent?: string;
        };
      },
      { ok: boolean; request: ContactRequestRecord }
    >("contact:submit"),
  },
  analytics: {
    record: makeFunctionReference<
      "mutation",
      {
        name: string;
        path?: string;
        route?: string;
        title?: string;
        referrer?: string;
        sessionId?: string;
        visitorId?: string;
        userAgent?: string;
        device?: string;
        metadataJson?: string;
      },
      { recorded: boolean; deduped: boolean; id: string | null }
    >("analytics:record"),
  },
  githubPortfolio: {
    latest: makeFunctionReference<
      "query",
      Record<string, never>,
      GithubPortfolioSnapshotRecord | null
    >("githubPortfolio:latest"),
  },
  systemLogs: {
    record: makeFunctionReference<
      "mutation",
      {
        level?: SystemLogRecord["level"];
        source?: SystemLogRecord["source"];
        scope?: string;
        eventType?: string;
        message: string;
        name?: string;
        stack?: string;
        fingerprint?: string;
        path?: string;
        url?: string;
        method?: string;
        statusCode?: number;
        requestId?: string;
        sessionId?: string;
        userAgent?: string;
        component?: string;
        action?: string;
        entityType?: string;
        entityId?: string;
        metadataJson?: string;
      },
      { logged: boolean; deduped: boolean; id: string | null }
    >("systemLogs:record"),
  },
  forum: {
    overview: makeFunctionReference<
      "query",
      Record<string, never>,
      ForumOverviewRecord
    >("forum:overview"),
    listCategories: makeFunctionReference<
      "query",
      { limit?: number },
      ForumCategoryRecord[]
    >("forum:listCategories"),
    listThreadPrefixes: makeFunctionReference<
      "query",
      { categorySlug: string },
      ForumThreadPrefixRecord[]
    >("forum:listThreadPrefixes"),
    routeStatus: makeFunctionReference<
      "query",
      { categorySlug: string; threadSlug?: string },
      | { exists: false; kind: "missing" }
      | { exists: true; kind: "category"; categorySlug: string }
      | {
          exists: true;
          kind: "thread";
          categorySlug: string;
          threadSlug: string;
        }
    >("forum:routeStatus"),
    listAnnouncements: makeFunctionReference<
      "query",
      {
        categorySlug?: string;
        includeBoardAnnouncements?: boolean;
      },
      ForumAnnouncementRecord[]
    >("forum:listAnnouncements"),
    getAnnouncement: makeFunctionReference<
      "query",
      { slug: string; categorySlug?: string },
      ForumAnnouncementRecord | null
    >("forum:getAnnouncement"),
    listHelpDocuments: makeFunctionReference<
      "query",
      { limit?: number },
      ForumHelpDocumentSummaryRecord[]
    >("forum:listHelpDocuments"),
    getHelpDocument: makeFunctionReference<
      "query",
      { slug: string },
      ForumHelpDocumentRecord | null
    >("forum:getHelpDocument"),
    listCalendarEvents: makeFunctionReference<
      "query",
      { month: string },
      ForumCalendarEventSummaryRecord[]
    >("forum:listCalendarEvents"),
    getCalendarEvent: makeFunctionReference<
      "query",
      { slug: string },
      ForumCalendarEventRecord | null
    >("forum:getCalendarEvent"),
    listThreads: makeFunctionReference<
      "query",
      {
        categorySlug: string;
        limit?: number;
        page?: number;
        pageSize?: number;
        prefixId?: string | null;
        sortKey?: ForumThreadListSortKey;
        sortOrder?: ForumThreadListSortOrder;
        days?: number;
      },
      {
        category: ForumCategoryRecord;
        announcements: ForumAnnouncementRecord[];
        rules: ForumBoardRulesRecord | null;
        activityThreads: ForumThreadRecord[];
        threads: ForumThreadRecord[];
        pagination: ForumPaginationRecord;
      }
    >("forum:listThreads"),
    listRecentThreads: makeFunctionReference<
      "query",
      {
        mode: ForumRecentThreadMode;
        limit?: number;
        page?: number;
        pageSize?: number;
      },
      ForumRecentThreadsRecord
    >("forum:listRecentThreads"),
    getThread: makeFunctionReference<
      "query",
      {
        categorySlug: string;
        threadSlug: string;
        paginationOpts?: ConvexPaginationOpts;
        page?: number;
        pageSize?: number;
      },
      {
        category: ForumCategoryRecord;
        announcements: ForumAnnouncementRecord[];
        rules: ForumBoardRulesRecord | null;
        thread: ForumThreadDetailRecord;
        poll: ForumPollRecord | null;
        replies: {
          page: ForumPostRecord[];
          isDone: boolean;
          pagination: ForumPaginationRecord;
        };
      }
    >("forum:getThread"),
    search: makeFunctionReference<
      "query",
      {
        query?: string;
        categorySlug?: string;
        limit?: number;
        page?: number;
        threadPage?: number;
        replyPage?: number;
        pageSize?: number;
        resultType?: "all" | "threads" | "replies";
        author?: string;
        target?: ForumSearchTarget;
        sortKey?: ForumSearchSortKey;
        days?: number;
      },
      {
        threads: Array<{
          _id: string;
          threadId: string;
          categoryId: string;
          categorySlug: string;
          prefixId?: string;
          prefix: ForumThreadPrefixRecord | null;
          slug: string;
          title: string;
          excerpt: string;
          status: ForumThreadStatus;
          pinned: boolean;
          replyCount: number;
          viewCount: number;
          createdAt: number;
          lastPostAt: number;
          author: string;
          lastPostAuthor: string;
        }>;
        posts: Array<{
          _id: string;
          postId: string;
          threadId: string;
          categoryId: string;
          categorySlug: string;
          prefixId?: string;
          prefix: ForumThreadPrefixRecord | null;
          threadSlug: string;
          threadTitle: string;
          body: string;
          excerpt: string;
          createdAt: number;
          threadLastPostAt: number;
          threadReplyCount: number;
          threadViewCount: number;
          author: string;
          postNumber?: number;
          postPage?: number;
        }>;
        pagination: ForumPaginationRecord;
        threadPagination: ForumPaginationRecord;
        postPagination: ForumPaginationRecord;
        limited: boolean;
        threadResultsLimited: boolean;
        postResultsLimited: boolean;
        filters: {
          resultType: "all" | "threads" | "replies";
          author: string | null;
          target: ForumSearchTarget;
          sortKey: ForumSearchSortKey;
          days?: number;
        };
      }
    >("forum:search"),
    listMyThreadSubscriptions: makeFunctionReference<
      "query",
      { limit?: number },
      { threads: ForumThreadRecord[] }
    >("forum:listMyThreadSubscriptions"),
    listMyCategorySubscriptions: makeFunctionReference<
      "query",
      { limit?: number },
      { categories: ForumCategoryRecord[] }
    >("forum:listMyCategorySubscriptions"),
    listMyNotifications: makeFunctionReference<
      "query",
      { limit?: number; status?: ForumNotificationStatus },
      {
        unreadCount: number;
        unreadCountLimited: boolean;
        notificationsLimited: boolean;
        notifications: ForumNotificationRecord[];
      }
    >("forum:listMyNotifications"),
    getMyForumNavState: makeFunctionReference<
      "query",
      Record<string, never>,
      ForumNavStateRecord
    >("forum:getMyForumNavState"),
    recordPresence: makeFunctionReference<
      "mutation",
      {
        locationType: ForumPresenceLocationType;
        path: string;
        label: string;
      },
      { recorded: boolean; presenceId?: string; lastSeenAt: number }
    >("forum:recordPresence"),
    markNotificationRead: makeFunctionReference<
      "mutation",
      { notificationId?: string; markAll?: boolean },
      { marked: number }
    >("forum:markNotificationRead"),
    listPrivateMessages: makeFunctionReference<
      "query",
      {
        box?: ForumPrivateMessageBox;
        limit?: number;
        page?: number;
        pageSize?: number;
        query?: string;
      },
      {
        box: ForumPrivateMessageBox;
        query: string;
        unreadCount: number;
        unreadCountLimited: boolean;
        messagesLimited: boolean;
        pagination: ForumPaginationRecord;
        quota: {
          used: number;
          limit: number;
          percent: number;
          limited: boolean;
        };
        messages: ForumPrivateMessageRecord[];
      }
    >("forum:listPrivateMessages"),
    getPrivateMessage: makeFunctionReference<
      "query",
      { messageId: string; box?: ForumPrivateMessageBox },
      ForumPrivateMessageRecord
    >("forum:getPrivateMessage"),
    sendPrivateMessage: makeFunctionReference<
      "mutation",
      { recipientUsername: string; subject: string; body: string },
      { messageId: string; createdAt: number }
    >("forum:sendPrivateMessage"),
    markPrivateMessageRead: makeFunctionReference<
      "mutation",
      { messageId: string },
      { marked: boolean }
    >("forum:markPrivateMessageRead"),
    deletePrivateMessage: makeFunctionReference<
      "mutation",
      { messageId: string; box: ForumPrivateMessageBox },
      { deleted: boolean }
    >("forum:deletePrivateMessage"),
    restorePrivateMessage: makeFunctionReference<
      "mutation",
      { messageId: string },
      { restored: boolean; box: Exclude<ForumPrivateMessageBox, "trash"> }
    >("forum:restorePrivateMessage"),
    listMembers: makeFunctionReference<
      "query",
      {
        limit?: number;
        page?: number;
        pageSize?: number;
        query?: string;
        sortKey?: ForumMemberSortKey;
      },
      {
        members: ForumMemberRecord[];
        pagination: ForumPaginationRecord;
        limited: boolean;
        filters: {
          query: string;
          sortKey: ForumMemberSortKey;
        };
      }
    >("forum:listMembers"),
    listOnlineMembers: makeFunctionReference<
      "query",
      { limit?: number; page?: number; pageSize?: number },
      ForumOnlineMembersRecord
    >("forum:listOnlineMembers"),
    getMyForumProfile: makeFunctionReference<
      "query",
      Record<string, never>,
      MyForumProfileRecord
    >("forum:getMyForumProfile"),
    getMyForumNotificationPreferences: makeFunctionReference<
      "query",
      Record<string, never>,
      ForumNotificationPreferencesRecord
    >("forum:getMyForumNotificationPreferences"),
    listMyForumWarnings: makeFunctionReference<
      "query",
      { limit?: number },
      MyForumWarningRecord[]
    >("forum:listMyForumWarnings"),
    listMyForumReputationHistory: makeFunctionReference<
      "query",
      { direction: ForumReputationHistoryDirection; limit?: number },
      MyForumReputationHistoryRecord[]
    >("forum:listMyForumReputationHistory"),
    listMyPendingForumContent: makeFunctionReference<
      "query",
      { limit?: number },
      MyPendingForumContentRecord
    >("forum:listMyPendingForumContent"),
    listMyForumRelationships: makeFunctionReference<
      "query",
      { limit?: number },
      MyForumRelationshipsRecord
    >("forum:listMyForumRelationships"),
    createThread: makeFunctionReference<
      "mutation",
      {
        categorySlug: string;
        prefixId?: string | null;
        title: string;
        body: string;
        attachments?: ForumAttachmentInput[];
        poll?: { question: string; options: string[] };
      },
      {
        threadId: string;
        categoryId: string;
        categorySlug: string;
        threadSlug: string;
        status: ForumThreadStatus;
        createdAt: number;
      }
    >("forum:createThread"),
    updateMyForumProfile: makeFunctionReference<
      "mutation",
      {
        avatarUrl?: string;
        bio?: string;
        birthday?: string;
        signature?: string;
        customTitle?: string;
        location?: string;
        showSignatures: boolean;
        timeZone?: string;
        websiteUrl?: string;
      },
      MyForumProfileRecord
    >("forum:updateMyForumProfile"),
    updateMyForumNotificationPreferences: makeFunctionReference<
      "mutation",
      {
        inAppReplies: boolean;
        inAppNewThreads: boolean;
        emailReplies: boolean;
        emailNewThreads: boolean;
      },
      ForumNotificationPreferencesRecord
    >("forum:updateMyForumNotificationPreferences"),
    updateForumRelationship: makeFunctionReference<
      "mutation",
      { username: string; kind: ForumRelationshipKind; enabled: boolean },
      {
        enabled: boolean;
        kind: ForumRelationshipKind;
        record?: ForumRelationshipRecord;
        targetUserId?: string;
        username?: string;
      }
    >("forum:updateForumRelationship"),
    createReply: makeFunctionReference<
      "mutation",
      { threadId: string; body: string; attachments?: ForumAttachmentInput[] },
      {
        postId: string;
        threadId: string;
        postNumber: number;
        postPage: number;
        status: ForumPostStatus;
        createdAt: number;
      }
    >("forum:createReply"),
    markThreadRead: makeFunctionReference<
      "mutation",
      { threadId: string; lastReadPostNumber?: number },
      { marked: boolean; readId: string; lastReadAt: number }
    >("forum:markThreadRead"),
    markCategoryRead: makeFunctionReference<
      "mutation",
      { categorySlug: string },
      { marked: boolean; threadCount: number; markedAt: number }
    >("forum:markCategoryRead"),
    markAllForumsRead: makeFunctionReference<
      "mutation",
      Record<string, never>,
      { marked: boolean; categoryCount: number; markedAt: number }
    >("forum:markAllForumsRead"),
    toggleThreadSubscription: makeFunctionReference<
      "mutation",
      { threadId: string },
      { subscribed: boolean; subscriptionId: string }
    >("forum:toggleThreadSubscription"),
    toggleCategorySubscription: makeFunctionReference<
      "mutation",
      { categorySlug: string },
      { subscribed: boolean; subscriptionId: string }
    >("forum:toggleCategorySubscription"),
    votePoll: makeFunctionReference<
      "mutation",
      { pollId: string; optionId: string },
      { voted: boolean; poll: ForumPollRecord | null }
    >("forum:votePoll"),
    updatePollContent: makeFunctionReference<
      "mutation",
      { pollId: string; question: string; options: string[] },
      { updated: boolean; poll: ForumPollRecord | null }
    >("forum:updatePollContent"),
    setForumReputation: makeFunctionReference<
      "mutation",
      {
        targetType: ForumReputationTargetType;
        threadId: string;
        postId?: string;
        score: -1 | 0 | 1;
        comment?: string;
      },
      {
        targetType: ForumReputationTargetType;
        threadId: string;
        postId?: string;
        viewerScore: -1 | 0 | 1;
        reputationScore: number;
      }
    >("forum:setForumReputation"),
    rateThread: makeFunctionReference<
      "mutation",
      {
        threadId: string;
        score: 1 | 2 | 3 | 4 | 5 | null;
      },
      {
        threadId: string;
        viewerRating: number;
        ratingCount: number;
        ratingAverage: number;
      }
    >("forum:rateThread"),
    updateThreadContent: makeFunctionReference<
      "mutation",
      {
        threadId: string;
        prefixId?: string | null;
        title: string;
        body: string;
        attachments?: ForumAttachmentInput[];
        attachmentIdsToKeep?: string[];
        editReason?: string;
      },
      { updated: boolean; thread: ForumThreadDetailRecord }
    >("forum:updateThreadContent"),
    updatePostContent: makeFunctionReference<
      "mutation",
      {
        postId: string;
        body: string;
        attachments?: ForumAttachmentInput[];
        attachmentIdsToKeep?: string[];
        editReason?: string;
      },
      { updated: boolean; post: ForumPostRecord }
    >("forum:updatePostContent"),
    deleteThread: makeFunctionReference<
      "mutation",
      { threadId: string },
      { deleted: boolean; categorySlug: string }
    >("forum:deleteThread"),
    deletePost: makeFunctionReference<
      "mutation",
      { postId: string },
      { deleted: boolean; threadId: string }
    >("forum:deletePost"),
    createReport: makeFunctionReference<
      "mutation",
      {
        entityType: ForumContentReportEntityType;
        threadId: string;
        postId?: string;
        reason: string;
        details?: string;
      },
      { reportId: string; created: boolean }
    >("forum:createReport"),
    createPrivateMessageReport: makeFunctionReference<
      "mutation",
      {
        messageId: string;
        reason: string;
        details?: string;
      },
      { reportId: string; created: boolean }
    >("forum:createPrivateMessageReport"),
    recordThreadView: makeFunctionReference<
      "mutation",
      { threadId: string },
      { recorded: boolean; viewCount: number | null }
    >("forum:recordThreadView"),
  },
  comments: {
    list: makeFunctionReference<
      "query",
      { entityType: CommentEntityType; entityId: string },
      Array<{
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
      }>
    >("comments:list"),
    add: makeFunctionReference<
      "mutation",
      {
        entityType: CommentEntityType;
        entityId: string;
        body: string;
        parentId?: string;
      },
      null
    >("comments:add"),
    softDelete: makeFunctionReference<
      "mutation",
      { commentId: string },
      { deleted: boolean }
    >("comments:softDelete"),
  },
  users: {
    maybeViewer: makeFunctionReference<
      "query",
      Record<string, never>,
      ViewerUserRecord | null
    >("users:maybeViewer"),
    publicProfile: makeFunctionReference<
      "query",
      { username: string },
      PublicProfileRecord | null
    >("users:publicProfile"),
  },
  newsletter: {
    listPublicIssues: makeFunctionReference<
      "query",
      { limit?: number },
      PublicNewsletterIssueRecord[]
    >("newsletter:listPublicIssues"),
    readPublicIssueBySlug: makeFunctionReference<
      "query",
      { slug: string },
      PublicNewsletterIssueRecord | null
    >("newsletter:readPublicIssueBySlug"),
    resolvePublicDestination: makeFunctionReference<
      "query",
      { slug: string; target: string },
      {
        url: string;
        eventType:
          | "source_click"
          | "discussion_click"
          | "forum_click"
          | "archive_click"
          | "news_index_click";
        hnItemId?: number;
      } | null
    >("newsletter:resolvePublicDestination"),
    recordPublicEngagement: makeFunctionReference<
      "mutation",
      {
        slug: string;
        eventType:
          | "archive_view"
          | "archive_click"
          | "source_click"
          | "discussion_click"
          | "forum_click"
          | "news_index_click";
        hnItemId?: number;
        visitorKey?: string;
      },
      { recorded: boolean }
    >("newsletter:recordPublicEngagement"),
    subscribe: makeFunctionReference<
      "mutation",
      {
        email: string;
        source?: string;
        token: string;
        tokenHash: string;
        siteUrl?: string;
      },
      NewsletterSubscriberRecord
    >("newsletter:subscribe"),
    viewerPreferences: makeFunctionReference<
      "query",
      Record<string, never>,
      {
        userEmail: string | null;
        subscriptions: NewsletterSubscriberRecord[];
      } | null
    >("newsletter:viewerPreferences"),
    requestViewerSubscription: makeFunctionReference<
      "mutation",
      {
        email: string;
        source?: string;
        token: string;
        tokenHash: string;
        siteUrl?: string;
      },
      NewsletterSubscriberRecord
    >("newsletter:requestViewerSubscription"),
    updateViewerTopics: makeFunctionReference<
      "mutation",
      {
        subscriberId: string;
        dailyOptIn: boolean;
        weeklyOptIn: boolean;
      },
      NewsletterSubscriberRecord | null
    >("newsletter:updateViewerTopics"),
    updateTopicsByToken: makeFunctionReference<
      "mutation",
      {
        tokenHash: string;
        dailyOptIn: boolean;
        weeklyOptIn: boolean;
      },
      NewsletterSubscriberRecord | null
    >("newsletter:updateTopicsByToken"),
    getByToken: makeFunctionReference<
      "query",
      { tokenHash: string },
      NewsletterSubscriberRecord | null
    >("newsletter:getByToken"),
    confirm: makeFunctionReference<
      "mutation",
      { tokenHash: string; siteUrl?: string },
      { ok: boolean; subscriber: NewsletterSubscriberRecord | null }
    >("newsletter:confirm"),
    unsubscribe: makeFunctionReference<
      "mutation",
      { tokenHash: string },
      { ok: boolean; subscriber: NewsletterSubscriberRecord | null }
    >("newsletter:unsubscribe"),
  },
  interactions: {
    summary: makeFunctionReference<
      "query",
      { entityType: "post" | "hnStory"; entityId: string },
      InteractionSummaryRecord
    >("interactions:summary"),
    summaries: makeFunctionReference<
      "query",
      { entityType: "post" | "hnStory"; entityIds: string[] },
      Record<string, InteractionSummaryRecord>
    >("interactions:summaries"),
    set: makeFunctionReference<
      "mutation",
      {
        entityType: "post" | "hnStory";
        entityId: string;
        vote: -1 | 0 | 1;
        saved: boolean;
      },
      null
    >("interactions:set"),
  },
  posts: {
    listPublished: makeFunctionReference<
      "query",
      Record<string, never>,
      ConvexPostRecord[]
    >("posts:listPublished"),
    featured: makeFunctionReference<
      "query",
      Record<string, never>,
      ConvexPostRecord | null
    >("posts:featured"),
    getBySlug: makeFunctionReference<
      "query",
      { slug: string },
      ConvexPostRecord | null
    >("posts:getBySlug"),
  },
  siteContent: {
    getPage: makeFunctionReference<
      "query",
      { slug: string },
      SitePageRecord | null
    >("siteContent:getPage"),
    listPortfolioProjects: makeFunctionReference<
      "query",
      Record<string, never>,
      PortfolioProjectRecord[]
    >("siteContent:listPortfolioProjects"),
  },
  news: {
    latest: makeFunctionReference<
      "query",
      Record<string, never>,
      {
        snapshot: NewsSnapshotRecord | null;
        stories: NewsStoryRecord[];
      }
    >("news:latest"),
    timeline: makeFunctionReference<
      "query",
      { snapshotDate?: string },
      NewsTimelineRecord
    >("news:timeline"),
    getStory: makeFunctionReference<
      "query",
      { hnItemId: number },
      {
        hnItemId: number;
        snapshotDate: string;
        rank: number;
        title: string;
        url?: string;
        host?: string;
        by?: string;
        text?: string;
        score?: number;
        descendants?: number;
        timePosted?: number;
        fetchedAt: number;
        platformStats: {
          comments: number;
          score: number;
          saves: number;
        };
      } | null
    >("news:getStory"),
  },
};
