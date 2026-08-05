import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  FORUM_REPLY_BODY_MAX_LENGTH,
  FORUM_THREAD_BODY_MAX_LENGTH,
} from "./forumLimits";

const categoryStatusValidator = v.union(
  v.literal("active"),
  v.literal("archived"),
);
const threadPrefixStatusValidator = v.union(
  v.literal("active"),
  v.literal("archived"),
);
const forumPageStatusValidator = v.union(
  v.literal("active"),
  v.literal("archived"),
);
const forumCalendarEventStatusValidator = v.union(
  v.literal("active"),
  v.literal("archived"),
);
const categoryKindValidator = v.union(v.literal("section"), v.literal("board"));
const categoryViewAccessValidator = v.union(
  v.literal("public"),
  v.literal("members"),
  v.literal("trusted"),
  v.literal("staff"),
);
const categoryWriteAccessValidator = v.union(
  v.literal("members"),
  v.literal("trusted"),
  v.literal("staff"),
  v.literal("closed"),
);
const threadStatusValidator = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("locked"),
  v.literal("hidden"),
  v.literal("deleted"),
);
const postStatusValidator = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("hidden"),
  v.literal("deleted"),
);
const reportStatusValidator = v.union(
  v.literal("open"),
  v.literal("reviewed"),
  v.literal("dismissed"),
);
const warningStatusValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("expired"),
);
const notificationStatusValidator = v.union(
  v.literal("unread"),
  v.literal("read"),
);
const forumNotificationEmailDeliveryStatusValidator = v.union(
  v.literal("queued"),
  v.literal("skipped"),
  v.literal("sent"),
  v.literal("failed"),
);
const privateMessageBoxValidator = v.union(
  v.literal("inbox"),
  v.literal("sent"),
  v.literal("trash"),
);
const forumRelationshipKindValidator = v.union(
  v.literal("buddy"),
  v.literal("ignore"),
);
const pollStatusValidator = v.union(v.literal("open"), v.literal("closed"));
const contentReportEntityTypeValidator = v.union(
  v.literal("thread"),
  v.literal("post"),
);
const reputationTargetTypeValidator = v.union(
  v.literal("thread"),
  v.literal("post"),
);
const reputationHistoryDirectionValidator = v.union(
  v.literal("received"),
  v.literal("given"),
);
const reputationScoreValidator = v.union(
  v.literal(-1),
  v.literal(0),
  v.literal(1),
);
const threadRatingScoreValidator = v.union(
  v.literal(1),
  v.literal(2),
  v.literal(3),
  v.literal(4),
  v.literal(5),
);
const attachmentInputValidator = v.object({
  storageId: v.id("_storage"),
  filename: v.string(),
});
const searchResultTypeValidator = v.union(
  v.literal("all"),
  v.literal("threads"),
  v.literal("replies"),
);
const searchTargetValidator = v.union(
  v.literal("all"),
  v.literal("titles"),
  v.literal("bodies"),
);
const searchSortKeyValidator = v.union(
  v.literal("relevance"),
  v.literal("newest"),
  v.literal("oldest"),
  v.literal("replies"),
  v.literal("views"),
);
const recentThreadModeValidator = v.union(v.literal("new"), v.literal("today"));
const threadListSortKeyValidator = v.union(
  v.literal("lastPostAt"),
  v.literal("createdAt"),
  v.literal("replies"),
  v.literal("views"),
  v.literal("rating"),
  v.literal("title"),
);
const threadListSortOrderValidator = v.union(
  v.literal("desc"),
  v.literal("asc"),
);
const memberSortKeyValidator = v.union(
  v.literal("posts-desc"),
  v.literal("threads-desc"),
  v.literal("reputation-desc"),
  v.literal("joined-desc"),
  v.literal("joined-asc"),
  v.literal("name-asc"),
  v.literal("online-desc"),
);
const presenceLocationTypeValidator = v.union(
  v.literal("index"),
  v.literal("board"),
  v.literal("thread"),
  v.literal("search"),
  v.literal("members"),
  v.literal("online"),
  v.literal("newPosts"),
  v.literal("help"),
  v.literal("calendar"),
  v.literal("userCp"),
  v.literal("messages"),
  v.literal("subscriptions"),
);
const moderationEventEntityTypeValidator = v.union(
  v.literal("forumThread"),
  v.literal("forumPost"),
  v.literal("forumReport"),
  v.literal("forumPoll"),
  v.literal("forumWarning"),
  v.literal("forumCategory"),
  v.literal("forumCategoryOrder"),
  v.literal("forumThreadPrefix"),
  v.literal("forumAnnouncement"),
  v.literal("forumHelpDocument"),
  v.literal("forumCalendarEvent"),
  v.literal("forumBoardRules"),
);
const threadMoveSyncPhaseValidator = v.union(
  v.literal("posts"),
  v.literal("attachments"),
  v.literal("polls"),
  v.literal("reports"),
  v.literal("notifications"),
  v.literal("notificationEmails"),
  v.literal("reputations"),
  v.literal("warnings"),
  v.literal("moderationEvents"),
  v.literal("views"),
  v.literal("reads"),
  v.literal("activeSubscriptions"),
  v.literal("mutedSubscriptions"),
);

const CATEGORY_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const THREAD_PREFIX_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;
const THREAD_PREFIX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const FORUM_ANNOUNCEMENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const FORUM_HELP_DOCUMENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const FORUM_CALENDAR_EVENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const FORUM_CALENDAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;
const FORUM_CALENDAR_TIME_ZONE = "America/Chicago";
const THREAD_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,95}$/;
const USERNAME_PATTERN = /^sym-\d{1,8}$|^[a-z0-9][a-z0-9_-]{2,31}$/;
const RESERVED_CATEGORY_SLUGS = new Set([
  "announcements",
  "calendar",
  "control-panel",
  "help",
  "members",
  "messages",
  "new-posts",
  "online",
  "search",
  "subscriptions",
  "todays-posts",
]);

const CATEGORY_NAME_MIN_LENGTH = 2;
const CATEGORY_NAME_MAX_LENGTH = 80;
const CATEGORY_DESCRIPTION_MAX_LENGTH = 280;
const THREAD_PREFIX_LABEL_MIN_LENGTH = 2;
const THREAD_PREFIX_LABEL_MAX_LENGTH = 24;
const THREAD_PREFIX_DESCRIPTION_MAX_LENGTH = 160;
const FORUM_ANNOUNCEMENT_TITLE_MIN_LENGTH = 2;
const FORUM_ANNOUNCEMENT_TITLE_MAX_LENGTH = 120;
const FORUM_ANNOUNCEMENT_BODY_MIN_LENGTH = 2;
const FORUM_ANNOUNCEMENT_BODY_MAX_LENGTH = 8_000;
const FORUM_HELP_DOCUMENT_TITLE_MIN_LENGTH = 2;
const FORUM_HELP_DOCUMENT_TITLE_MAX_LENGTH = 120;
const FORUM_HELP_DOCUMENT_BODY_MIN_LENGTH = 2;
const FORUM_HELP_DOCUMENT_BODY_MAX_LENGTH = 8_000;
const FORUM_HELP_DOCUMENT_EXCERPT_MAX_LENGTH = 240;
const FORUM_CALENDAR_EVENT_TITLE_MIN_LENGTH = 2;
const FORUM_CALENDAR_EVENT_TITLE_MAX_LENGTH = 120;
const FORUM_CALENDAR_EVENT_BODY_MIN_LENGTH = 2;
const FORUM_CALENDAR_EVENT_BODY_MAX_LENGTH = 8_000;
const FORUM_CALENDAR_EVENT_EXCERPT_MAX_LENGTH = 260;
const FORUM_BOARD_RULES_TITLE_MIN_LENGTH = 2;
const FORUM_BOARD_RULES_TITLE_MAX_LENGTH = 120;
const FORUM_BOARD_RULES_BODY_MIN_LENGTH = 2;
const FORUM_BOARD_RULES_BODY_MAX_LENGTH = 8_000;
const THREAD_TITLE_MIN_LENGTH = 3;
const THREAD_TITLE_MAX_LENGTH = 160;
const THREAD_BODY_MIN_LENGTH = 10;
const REPLY_BODY_MIN_LENGTH = 2;
const REPORT_REASON_MIN_LENGTH = 3;
const REPORT_REASON_MAX_LENGTH = 80;
const REPORT_DETAILS_MAX_LENGTH = 1_000;
const MODERATION_NOTE_MAX_LENGTH = 300;
const EDIT_REASON_MAX_LENGTH = 180;
const WARNING_REASON_MIN_LENGTH = 3;
const WARNING_REASON_MAX_LENGTH = 160;
const WARNING_POINTS_MIN = 1;
const WARNING_POINTS_MAX = 10;
const WARNING_PARTICIPATION_BLOCK_POINTS = 10;
const POLL_QUESTION_MIN_LENGTH = 4;
const POLL_QUESTION_MAX_LENGTH = 160;
const POLL_OPTION_MIN_LENGTH = 1;
const POLL_OPTION_MAX_LENGTH = 80;
const POLL_MIN_OPTIONS = 2;
const POLL_MAX_OPTIONS = 8;
const FORUM_SIGNATURE_MAX_LENGTH = 900;
const FORUM_CUSTOM_TITLE_MAX_LENGTH = 40;
const FORUM_PROFILE_AVATAR_URL_MAX_LENGTH = 500;
const FORUM_PROFILE_BIO_MAX_LENGTH = 800;
const FORUM_PROFILE_BIRTHDAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FORUM_PROFILE_LOCATION_MAX_LENGTH = 80;
const FORUM_PROFILE_TIME_ZONE_MAX_LENGTH = 64;
const FORUM_PROFILE_WEBSITE_URL_MAX_LENGTH = 240;
const PRIVATE_MESSAGE_SUBJECT_MIN_LENGTH = 2;
const PRIVATE_MESSAGE_SUBJECT_MAX_LENGTH = 120;
const PRIVATE_MESSAGE_BODY_MIN_LENGTH = 2;
const PRIVATE_MESSAGE_BODY_MAX_LENGTH = 6_000;
const PRIVATE_MESSAGE_SEARCH_MAX_LENGTH = 120;
const REPUTATION_COMMENT_MAX_LENGTH = 180;
const FORUM_ATTACHMENT_MAX_PER_POST = 5;
const FORUM_ATTACHMENT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const FORUM_ATTACHMENT_FILENAME_MAX_LENGTH = 120;
const FORUM_PENDING_ATTACHMENT_UPLOAD_TTL_MS = 60 * 60 * 1000;
const FORUM_PENDING_ATTACHMENT_UPLOAD_USER_LIMIT = 20;
const FORUM_ATTACHMENT_CLEANUP_BATCH_LIMIT = 50;
const FORUM_DELETED_ATTACHMENT_STORAGE_GRACE_MS = 24 * 60 * 60 * 1000;
const FORUM_ATTACHMENT_ALLOWED_CONTENT_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/zip",
] as const;

const CATEGORY_LIST_LIMIT = 200;
const THREAD_PREFIX_LIST_LIMIT = 80;
const THREAD_PREFIX_THREAD_SYNC_LIMIT = 100;
const FORUM_ANNOUNCEMENT_LIST_LIMIT = 60;
const FORUM_HELP_DOCUMENT_LIST_LIMIT = 80;
const FORUM_CALENDAR_EVENT_LIST_LIMIT = 120;
const FORUM_BOARD_RULES_LIST_LIMIT = 80;
const THREAD_LIST_LIMIT = 40;
const THREAD_PAGE_SIZE = 25;
const THREAD_PAGE_MAX_SIZE = 50;
const THREAD_PAGE_SCAN_LIMIT = 5_000;
const THREAD_LIST_DAY_MS = 86_400_000;
const THREAD_LIST_MAX_DAYS = 3_650;
const POST_PAGE_SIZE = 20;
const POST_PAGE_MAX_SIZE = 50;
const POST_PAGE_SCAN_LIMIT = 1_000;
const THREAD_ADMIN_LIST_LIMIT = 60;
const CONTENT_EDIT_LIST_LIMIT = 30;
const THREAD_MOVE_RELATED_RECORD_BATCH_LIMIT = 80;
const POST_MOVE_LIMIT = 20;
const POST_MOVE_RELATED_RECORD_BATCH_LIMIT = 160;
const SEARCH_RESULT_LIMIT = 12;
const SEARCH_PAGE_MAX_SIZE = 30;
const SEARCH_PAGE_SCAN_LIMIT = 120;
const SEARCH_VISIBILITY_SCAN_LIMIT = 480;
const RECENT_THREAD_SCAN_LIMIT = 500;
const NOTIFICATION_UNREAD_SCAN_LIMIT = 100;
const NOTIFICATION_MARK_READ_BATCH_LIMIT = 100;
const NOTIFICATION_VISIBILITY_SCAN_LIMIT = 1_000;
const PRIVATE_MESSAGE_UNREAD_SCAN_LIMIT = 500;
const PRIVATE_MESSAGE_PAGE_DEPTH_LIMIT = 20;
const PRIVATE_MESSAGE_SEARCH_SCAN_LIMIT = 500;
const PRIVATE_MESSAGE_QUOTA_LIMIT = 500;
const FORUM_RELATIONSHIP_LIST_LIMIT = 100;
const MEMBER_LIST_DEFAULT_PAGE_SIZE = 25;
const MEMBER_LIST_MAX_PAGE_SIZE = 50;
const MEMBER_LIST_PAGE_DEPTH_LIMIT = 20;
const MEMBER_LIST_SCAN_LIMIT = 240;
const MY_FORUM_REPUTATION_HISTORY_LIMIT = 12;
const MY_FORUM_REPUTATION_HISTORY_BATCH_SIZE = 16;
const MY_FORUM_REPUTATION_HISTORY_SCAN_LIMIT = 240;
const MY_FORUM_WARNING_LIST_LIMIT = 20;
const MY_PENDING_FORUM_CONTENT_LIMIT = 20;
const REPLY_NOTIFICATION_FANOUT_BATCH_LIMIT = 100;
const NEW_THREAD_NOTIFICATION_FANOUT_BATCH_LIMIT = 100;
const THREAD_VISIBILITY_PROFILE_DELTA_BATCH_LIMIT = 100;
const FORUM_PRESENCE_WINDOW_MS = 15 * 60 * 1_000;
const FORUM_PRESENCE_HEARTBEAT_MIN_MS = 60 * 1_000;
const FORUM_PRESENCE_SCAN_LIMIT = 120;
const FORUM_PRESENCE_DISPLAY_LIMIT = 18;
const FORUM_PRESENCE_PATH_MAX_LENGTH = 160;
const FORUM_PRESENCE_LABEL_MAX_LENGTH = 80;
const DEFAULT_FORUM_NOTIFICATION_PREFERENCES = {
  inAppReplies: true,
  inAppNewThreads: true,
  emailReplies: false,
  emailNewThreads: false,
} as const;

const SUKI_FORUM_TAXONOMY = [
  {
    slug: "general",
    name: "General",
    description: "Introductions, community talk, help, and everything between.",
    position: 10,
    children: [
      {
        slug: "general-introductions",
        name: "Introductions",
        description: "Say hello, share what you make, and meet the crew.",
        position: 11,
      },
      {
        slug: "general-lounge",
        name: "Lounge",
        description: "Loose conversation, curiosities, and off-topic finds.",
        position: 12,
      },
      {
        slug: "general-help-feedback",
        name: "Help & Feedback",
        description:
          "Ask for forum help or suggest ways to improve the community.",
        position: 13,
      },
    ],
  },
  {
    slug: "projects",
    name: "Projects",
    description:
      "Build logs, experiments, releases, and creative collaboration.",
    position: 20,
    children: [
      {
        slug: "projects-build-logs",
        name: "Build Logs",
        description: "Progress journals with decisions, failures, and lessons.",
        position: 21,
      },
      {
        slug: "projects-show-tell",
        name: "Show & Tell",
        description: "Share finished work, prototypes, demos, and artifacts.",
        position: 22,
      },
      {
        slug: "projects-collaboration",
        name: "Collaboration",
        description: "Find contributors, critique partners, and project help.",
        position: 23,
      },
      {
        slug: "projects-releases",
        name: "Releases",
        description:
          "Launch notes, changelogs, and meaningful project updates.",
        position: 24,
      },
    ],
  },
  {
    slug: "research",
    name: "Research",
    description:
      "Papers, experiments, data, and technical references worth keeping.",
    position: 30,
    children: [
      {
        slug: "research-papers",
        name: "Papers",
        description: "Readable breakdowns of papers and primary research.",
        position: 31,
      },
      {
        slug: "research-experiments",
        name: "Experiments",
        description:
          "Methods, observations, replications, and unexpected results.",
        position: 32,
      },
      {
        slug: "research-data",
        name: "Data",
        description: "Datasets, visualizations, benchmarks, and measurement.",
        position: 33,
      },
      {
        slug: "research-reading-list",
        name: "Reading List",
        description: "Curated references with notes on why each item matters.",
        position: 34,
      },
    ],
  },
  {
    slug: "forum-news",
    name: "News",
    description:
      "Reported developments, daily briefings, and source-led analysis with a point of view.",
    position: 35,
    children: [
      {
        slug: "news-hacker-news",
        name: "Hacker News",
        description:
          "Belle's daily Hacker News desk: the day's strongest threads, connected into one readable story.",
        position: 36,
      },
    ],
  },
  {
    slug: "ai",
    name: "AI",
    description:
      "Practical AI techniques, models, agents, and the tools around them.",
    position: 40,
    children: [
      {
        slug: "ai-prompts",
        name: "Prompts",
        description: "Tested prompts, prompt patterns, and evaluation notes.",
        position: 41,
      },
      {
        slug: "ai-skills",
        name: "Skills",
        description: "Reusable agent skills, tools, and capability design.",
        position: 42,
      },
      {
        slug: "ai-frameworks",
        name: "Frameworks",
        description:
          "Agent and application frameworks, SDKs, and architecture.",
        position: 43,
      },
      {
        slug: "ai-models",
        name: "Models",
        description: "Model releases, benchmarks, tradeoffs, and field tests.",
        position: 44,
      },
      {
        slug: "ai-agents",
        name: "Agents",
        description: "Agent workflows, orchestration, memory, and evaluation.",
        position: 45,
      },
      {
        slug: "ai-local",
        name: "Local AI",
        description:
          "Private inference, local models, hardware, and optimization.",
        position: 46,
      },
    ],
  },
  {
    slug: "hacking",
    name: "Hacking",
    description:
      "Defensive security, responsible research, privacy, and practical learning.",
    position: 50,
    children: [
      {
        slug: "hacking-security-news",
        name: "Security News",
        description:
          "Vulnerabilities and incidents with concrete defensive takeaways.",
        position: 51,
      },
      {
        slug: "hacking-web-security",
        name: "Web Security",
        description:
          "Secure web engineering, testing, and responsible disclosure.",
        position: 52,
      },
      {
        slug: "hacking-reverse-engineering",
        name: "Reverse Engineering",
        description:
          "File formats, binaries, protocols, and legal interoperability.",
        position: 53,
      },
      {
        slug: "hacking-ctf",
        name: "CTFs",
        description:
          "Capture-the-flag learning, writeups, and safe practice labs.",
        position: 54,
      },
      {
        slug: "hacking-privacy-opsec",
        name: "Privacy & OPSEC",
        description: "Personal privacy, threat modeling, and safer defaults.",
        position: 55,
      },
      {
        slug: "hacking-tools",
        name: "Tools",
        description:
          "Defensive utilities, analysis tools, and verified workflows.",
        position: 56,
      },
    ],
  },
  {
    slug: "gaming",
    name: "Gaming",
    description:
      "Games, communities, servers, modding, guides, and useful downloads.",
    position: 60,
    children: [
      {
        slug: "gaming-hacks",
        name: "Hacks",
        description:
          "Game mods, accessibility tweaks, and legitimate customization.",
        position: 61,
      },
      {
        slug: "gaming-hosting",
        name: "Hosting",
        description:
          "Server hosting, administration, performance, and communities.",
        position: 62,
      },
      {
        slug: "gaming-guides",
        name: "Guides",
        description:
          "Walkthroughs, setup notes, strategy, and troubleshooting.",
        position: 63,
      },
      {
        slug: "gaming-downloads",
        name: "Downloads",
        description:
          "Official and verified tools, patches, mods, and resources.",
        position: 64,
      },
    ],
  },
  {
    slug: "music",
    name: "Music",
    description:
      "New sounds, production craft, instruments, and scenes worth hearing.",
    position: 70,
    children: [
      {
        slug: "music-new-releases",
        name: "New Releases",
        description: "Notable releases with context beyond the press copy.",
        position: 71,
      },
      {
        slug: "music-production",
        name: "Production",
        description: "Recording, synthesis, mixing, mastering, and workflow.",
        position: 72,
      },
      {
        slug: "music-gear",
        name: "Instruments & Gear",
        description:
          "Instruments, studio tools, repair, and practical buying notes.",
        position: 73,
      },
      {
        slug: "music-scenes",
        name: "Scene Reports",
        description: "Labels, local scenes, movements, and music culture.",
        position: 74,
      },
      {
        slug: "music-playlists",
        name: "Playlists",
        description: "Curated listening paths organized around a useful idea.",
        position: 75,
      },
    ],
  },
] as const;

const THREAD_RATE_LIMIT_MS = 15_000;
const REPLY_RATE_LIMIT_MS = 2_500;
const THREAD_DUPLICATE_WINDOW_MS = 60_000;
const REPLY_DUPLICATE_WINDOW_MS = 15_000;
const REPORT_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1_000;
const THREAD_VIEW_DEDUP_MS = 6 * 60 * 60 * 1_000;
const REPORT_RATE_LIMIT_MS = 60_000;
const REPORT_OPEN_LIMIT = 5;
const PRIVATE_MESSAGE_RATE_LIMIT_MS = 5_000;
const PRIVATE_MESSAGE_RECIPIENT_RATE_LIMIT_MS = 60_000;
const PRIVATE_MESSAGE_DUPLICATE_WINDOW_MS = 10 * 60 * 1_000;
const REPUTATION_RATE_LIMIT_MS = 2_000;
const SUKI_REPLY_DAILY_LIMIT = 12;
const BELLE_REPLY_DAILY_LIMIT = 8;
const SUKI_REPLY_SCAN_LIMIT = 40;
const SUKI_REPLY_MIN_AGE_MS = 2 * 60 * 1_000;
const SUKI_REPLY_MAX_AGE_MS = 48 * 60 * 60 * 1_000;
const SUKI_REPLY_STALE_RUN_MS = 15 * 60 * 1_000;
const FORUM_AGENT_SOURCE_REUSE_COOLDOWN_MS = 72 * 60 * 60 * 1_000;

type UserDoc = Doc<"users">;
type ForumCategoryDoc = Doc<"forumCategories">;
type ForumCategoryModeratorDoc = Doc<"forumCategoryModerators">;
type ForumThreadPrefixDoc = Doc<"forumThreadPrefixes">;
type ForumAnnouncementDoc = Doc<"forumAnnouncements">;
type ForumHelpDocumentDoc = Doc<"forumHelpDocuments">;
type ForumCalendarEventDoc = Doc<"forumCalendarEvents">;
type ForumBoardRulesDoc = Doc<"forumBoardRules">;
type ForumThreadDoc = Doc<"forumThreads">;
type ForumPostDoc = Doc<"forumPosts">;
type ForumAgentReplyRunDoc = Doc<"forumAgentReplyRuns">;
type ForumAgentSourceUseDoc = Doc<"forumAgentSourceUses">;
type ForumAttachmentDoc = Doc<"forumAttachments">;
type ForumStorageMetadata = {
  _id: Id<"_storage">;
  _creationTime: number;
  contentType?: string;
  size: number;
};
type NormalizedForumAttachmentInput = {
  pendingUploadId: Id<"forumPendingUploads">;
  storageId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};
type ForumAttachmentEditPlan = {
  currentAttachments: ForumAttachmentDoc[];
  attachmentIdsToKeep: Set<Id<"forumAttachments">>;
  newAttachments: NormalizedForumAttachmentInput[];
  changed: boolean;
};
type ForumContentEditDoc = Doc<"forumContentEdits">;
type ForumPollDoc = Doc<"forumPolls">;
type ForumUserProfileDoc = Doc<"forumUserProfiles">;
type ForumThreadReadDoc = Doc<"forumThreadReads">;
type ForumCategoryReadDoc = Doc<"forumCategoryReads">;
type ForumCategorySubscriptionDoc = Doc<"forumCategorySubscriptions">;
type ForumThreadRatingDoc = Doc<"forumThreadRatings">;
type ForumNotificationPreferencesDoc = Doc<"forumNotificationPreferences">;
type ForumNotificationDoc = Doc<"forumNotifications">;
type ForumNotificationEmailDeliveryDoc =
  Doc<"forumNotificationEmailDeliveries">;
type ForumPrivateMessageDoc = Doc<"forumPrivateMessages">;
type ForumUserRelationshipDoc = Doc<"forumUserRelationships">;
type ForumPrivateMessageBox = "inbox" | "sent" | "trash";
type ForumPrivateMessageSide = "inbox" | "sent";
type ForumReportDoc = Doc<"forumReports">;
type ForumReputationDoc = Doc<"forumReputations">;
type ForumWarningDoc = Doc<"forumWarnings">;
type ForumPresenceDoc = Doc<"forumPresence">;
type ForumModerationEventDoc = Doc<"forumModerationEvents">;
type ForumThreadStatus = ForumThreadDoc["status"];
type SukiReplySourceKind = ForumAgentReplyRunDoc["sourceKind"];
type SukiReplyRunSource = Pick<
  ForumAgentReplyRunDoc,
  "authorId" | "categoryId" | "sourceKind" | "sourcePostId" | "threadId"
>;
type SukiReplyCandidate = {
  sourceKind: SukiReplySourceKind;
  sourcePostId?: Id<"forumPosts">;
  sourcePostNumber: number;
  sourceCreatedAt: number;
  threadId: Id<"forumThreads">;
  categoryId: Id<"forumCategories">;
  authorId: Id<"users">;
  authorName: string;
  categoryName: string;
  categorySlug: string;
  threadTitle: string;
  threadBody: string;
  sourceBody: string;
  recentPosts: Array<{
    authorName: string;
    body: string;
    postNumber: number;
  }>;
};
type ForumModerationEventType = ForumModerationEventDoc["eventType"];
type ForumModerationEntityType = ForumModerationEventDoc["entityType"];
type ForumCategoryKind = NonNullable<ForumCategoryDoc["kind"]>;
type ForumCategoryViewAccess = NonNullable<ForumCategoryDoc["viewAccess"]>;
type ForumCategoryWriteAccess = NonNullable<ForumCategoryDoc["threadAccess"]>;
type ThreadMoveSyncPhase =
  | "posts"
  | "attachments"
  | "polls"
  | "reports"
  | "notifications"
  | "notificationEmails"
  | "reputations"
  | "warnings"
  | "moderationEvents"
  | "views"
  | "reads"
  | "activeSubscriptions"
  | "mutedSubscriptions";
type ForumReadSnapshot = {
  lastReadAt: number;
  lastReadPostNumber?: number;
};
type ForumLastPostTarget = {
  lastPostNumber?: number;
  lastPostPage?: number;
};

export const listCategories = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampLimit(
      args.limit,
      CATEGORY_LIST_LIMIT,
      CATEGORY_LIST_LIMIT,
    );
    const viewer = await maybeCurrentUser(ctx);
    const categoryRows = await ctx.db
      .query("forumCategories")
      .withIndex("by_status_and_position", (q) => q.eq("status", "active"))
      .take(CATEGORY_LIST_LIMIT);
    const visibleCategoryRows = await visibleCategoriesForUser(
      ctx,
      categoryRows,
      viewer,
    );
    const categories = visibleCategoryRows
      .filter(isBoardCategory)
      .slice(0, limit);

    const lastThreadsById = await loadThreadsById(
      ctx,
      categories.flatMap((category) =>
        category.lastThreadId === undefined ? [] : [category.lastThreadId],
      ),
    );
    const lastPostTargetsByThreadId = await loadThreadLastPostTargets(
      ctx,
      Array.from(lastThreadsById.values()),
    );
    const categoryReadsById =
      viewer === null
        ? new Map<Id<"forumCategories">, ForumCategoryReadDoc>()
        : await loadCategoryReads(
            ctx,
            viewer._id,
            categories.map((category) => category._id),
          );

    return categories.map((category) => {
      const lastThread =
        category.lastThreadId === undefined
          ? undefined
          : lastThreadsById.get(category.lastThreadId);
      return publicCategoryRecord(
        category,
        lastThread,
        lastThread === undefined
          ? undefined
          : lastPostTargetsByThreadId.get(lastThread._id),
        {
          viewerHasRead:
            viewer === null
              ? undefined
              : hasReadCategory(category, categoryReadsById.get(category._id)),
        },
      );
    });
  },
});

export const listThreadPrefixes = query({
  args: {
    categorySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await maybeCurrentUser(ctx);
    const category = await requireVisibleCategory(
      ctx,
      args.categorySlug,
      viewer,
    );
    const prefixes = await activeThreadPrefixesForCategory(ctx, category._id);
    return prefixes.map(publicThreadPrefixRecord);
  },
});

export const routeStatus = query({
  args: {
    categorySlug: v.string(),
    threadSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await maybeCurrentUser(ctx);
    const categorySlug = args.categorySlug.trim().toLowerCase();
    if (!CATEGORY_SLUG_PATTERN.test(categorySlug)) {
      return { exists: false, kind: "missing" as const };
    }

    const category = await ctx.db
      .query("forumCategories")
      .withIndex("by_slug", (q) => q.eq("slug", categorySlug))
      .unique();
    if (
      category === null ||
      !isBoardCategory(category) ||
      !(await canViewCategoryWithAncestors(ctx, viewer, category))
    ) {
      return { exists: false, kind: "missing" as const };
    }

    if (args.threadSlug === undefined) {
      return {
        exists: true,
        kind: "category" as const,
        categorySlug: category.slug,
      };
    }

    const threadSlug = args.threadSlug.trim().toLowerCase();
    if (!THREAD_SLUG_PATTERN.test(threadSlug)) {
      return { exists: false, kind: "missing" as const };
    }

    const thread = await ctx.db
      .query("forumThreads")
      .withIndex("by_categorySlug_and_slug", (q) =>
        q.eq("categorySlug", category.slug).eq("slug", threadSlug),
      )
      .unique();
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      return { exists: false, kind: "missing" as const };
    }

    return {
      exists: true,
      kind: "thread" as const,
      categorySlug: category.slug,
      threadSlug: thread.slug,
    };
  },
});

export const listAnnouncements = query({
  args: {
    categorySlug: v.optional(v.string()),
    includeBoardAnnouncements: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const viewer = await maybeCurrentUser(ctx);
    const status = "active" as const;

    if (args.categorySlug !== undefined) {
      const category = await requireVisibleCategory(
        ctx,
        args.categorySlug,
        viewer,
      );
      const announcements = await announcementsForCategory(
        ctx,
        category._id,
        status,
      );
      return announcements.map((announcement) =>
        publicForumAnnouncementRecord(
          announcement,
          announcement.categoryId === undefined ? undefined : category,
        ),
      );
    }

    const globalRows = await globalAnnouncements(ctx, status);
    if (args.includeBoardAnnouncements !== true) {
      return globalRows.map((announcement) =>
        publicForumAnnouncementRecord(announcement),
      );
    }

    const categoryRows = await ctx.db
      .query("forumCategories")
      .withIndex("by_status_and_position", (q) => q.eq("status", "active"))
      .take(CATEGORY_LIST_LIMIT);
    const visibleCategories = await visibleCategoriesForUser(
      ctx,
      categoryRows,
      viewer,
    );
    const boardCategories = visibleCategories.filter(isBoardCategory);
    const categoryIds = new Set(
      boardCategories.map((category) => category._id),
    );
    const categoryAnnouncements = (
      await ctx.db
        .query("forumAnnouncements")
        .withIndex("by_status_and_position", (q) => q.eq("status", status))
        .take(FORUM_ANNOUNCEMENT_LIST_LIMIT)
    ).filter(
      (announcement) =>
        announcement.categoryId !== undefined &&
        categoryIds.has(announcement.categoryId),
    );
    const categoriesById = new Map(
      boardCategories.map((category) => [category._id, category]),
    );

    return [...globalRows, ...categoryAnnouncements]
      .sort(compareForumPageRecords)
      .slice(0, FORUM_ANNOUNCEMENT_LIST_LIMIT)
      .map((announcement) =>
        publicForumAnnouncementRecord(
          announcement,
          announcement.categoryId === undefined
            ? undefined
            : categoriesById.get(announcement.categoryId),
        ),
      );
  },
});

export const getAnnouncement = query({
  args: {
    slug: v.string(),
    categorySlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = normalizeForumAnnouncementSlug(args.slug);
    const viewer = await maybeCurrentUser(ctx);
    const category =
      args.categorySlug === undefined
        ? null
        : await requireVisibleCategory(ctx, args.categorySlug, viewer);
    const matches = await ctx.db
      .query("forumAnnouncements")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .take(FORUM_ANNOUNCEMENT_LIST_LIMIT);
    if (category === null) {
      const globalMatch = matches.find(
        (candidate) =>
          candidate.status === "active" && candidate.categoryId === undefined,
      );
      if (globalMatch !== undefined) {
        return publicForumAnnouncementRecord(globalMatch);
      }
      for (const candidate of matches) {
        if (candidate.status !== "active") {
          continue;
        }
        if (candidate.categoryId === undefined) {
          continue;
        }
        const candidateCategory = await ctx.db.get(candidate.categoryId);
        if (
          candidateCategory !== null &&
          (await canViewCategoryWithAncestors(ctx, viewer, candidateCategory))
        ) {
          return publicForumAnnouncementRecord(candidate, candidateCategory);
        }
      }
      return null;
    }
    const announcement = matches.find(
      (candidate) =>
        candidate.status === "active" && candidate.categoryId === category._id,
    );
    if (announcement === undefined) {
      return null;
    }
    return publicForumAnnouncementRecord(announcement, category);
  },
});

export const listHelpDocuments = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampLimit(
      args.limit,
      FORUM_HELP_DOCUMENT_LIST_LIMIT,
      FORUM_HELP_DOCUMENT_LIST_LIMIT,
    );
    const documents = await ctx.db
      .query("forumHelpDocuments")
      .withIndex("by_status_and_position_and_title", (q) =>
        q.eq("status", "active"),
      )
      .take(limit);

    return documents.map(publicForumHelpDocumentSummaryRecord);
  },
});

export const getHelpDocument = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const slug = normalizeForumHelpDocumentSlug(args.slug);
    const document = await ctx.db
      .query("forumHelpDocuments")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (document === null || document.status !== "active") {
      return null;
    }

    return publicForumHelpDocumentRecord(document);
  },
});

export const listCalendarEvents = query({
  args: {
    month: v.string(),
  },
  handler: async (ctx, args) => {
    const month = normalizeForumCalendarMonth(args.month);
    const events = await ctx.db
      .query("forumCalendarEvents")
      .withIndex("by_status_and_month_and_startsAt_and_title", (q) =>
        q.eq("status", "active").eq("month", month),
      )
      .take(FORUM_CALENDAR_EVENT_LIST_LIMIT);

    return events.map(publicForumCalendarEventSummaryRecord);
  },
});

export const getCalendarEvent = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const slug = normalizeForumCalendarEventSlug(args.slug);
    const event = await ctx.db
      .query("forumCalendarEvents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (event === null || event.status !== "active") {
      return null;
    }

    return publicForumCalendarEventRecord(event);
  },
});

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await maybeCurrentUser(ctx);
    const categoryRows = await ctx.db
      .query("forumCategories")
      .withIndex("by_status_and_position", (q) => q.eq("status", "active"))
      .take(CATEGORY_LIST_LIMIT);
    const visibleCategories = await visibleCategoriesForUser(
      ctx,
      categoryRows,
      viewer,
    );
    const boardCategories = visibleCategories.filter(isBoardCategory);

    const lastThreadsById = await loadThreadsById(
      ctx,
      visibleCategories.flatMap((category) =>
        category.lastThreadId === undefined ? [] : [category.lastThreadId],
      ),
    );
    const lastPostTargetsByThreadId = await loadThreadLastPostTargets(
      ctx,
      Array.from(lastThreadsById.values()),
    );
    const categoryReadsById =
      viewer === null
        ? new Map<Id<"forumCategories">, ForumCategoryReadDoc>()
        : await loadCategoryReads(
            ctx,
            viewer._id,
            visibleCategories.map((category) => category._id),
          );
    const categoryRecords = boardCategories.map((category) => {
      const lastThread =
        category.lastThreadId === undefined
          ? undefined
          : lastThreadsById.get(category.lastThreadId);
      return publicCategoryRecord(
        category,
        lastThread,
        lastThread === undefined
          ? undefined
          : lastPostTargetsByThreadId.get(lastThread._id),
        {
          viewerHasRead:
            viewer === null
              ? undefined
              : hasReadCategory(category, categoryReadsById.get(category._id)),
        },
      );
    });
    const allCategoryRecords = visibleCategories.map((category) => {
      const lastThread =
        category.lastThreadId === undefined
          ? undefined
          : lastThreadsById.get(category.lastThreadId);
      return publicCategoryRecord(
        category,
        lastThread,
        lastThread === undefined
          ? undefined
          : lastPostTargetsByThreadId.get(lastThread._id),
        {
          viewerHasRead:
            viewer === null
              ? undefined
              : hasReadCategory(category, categoryReadsById.get(category._id)),
        },
      );
    });

    const [activeThreads, lockedThreads] = await Promise.all([
      ctx.db
        .query("forumThreads")
        .withIndex("by_status_and_lastPostAt", (q) => q.eq("status", "active"))
        .order("desc")
        .take(SEARCH_RESULT_LIMIT),
      ctx.db
        .query("forumThreads")
        .withIndex("by_status_and_lastPostAt", (q) => q.eq("status", "locked"))
        .order("desc")
        .take(SEARCH_RESULT_LIMIT),
    ]);
    const newestThreads = (
      await filterThreadsForPublicCategory(
        ctx,
        [...activeThreads, ...lockedThreads],
        null,
        viewer,
      )
    )
      .sort((left, right) => right.lastPostAt - left.lastPostAt)
      .slice(0, SEARCH_RESULT_LIMIT);
    const authorsById = await loadUserNamesById(ctx, [
      ...newestThreads.map((thread) => thread.authorId),
      ...newestThreads.map((thread) => thread.lastPostUserId),
    ]);
    const newestLastPostTargetsByThreadId = await loadThreadLastPostTargets(
      ctx,
      newestThreads,
    );
    const online = await onlineForumSummary(
      ctx,
      Date.now(),
      FORUM_PRESENCE_DISPLAY_LIMIT,
    );
    const statistics = await forumBoardStatistics(ctx);
    const announcements = await activeGlobalAnnouncements(ctx);

    return {
      categories: categoryRecords,
      sections: buildPublicCategorySections(allCategoryRecords),
      announcements: announcements.map((announcement) =>
        publicForumAnnouncementRecord(announcement),
      ),
      newestThreads: newestThreads.map((thread) =>
        publicThreadListRecord(thread, authorsById.get(thread.authorId), {
          lastPostAuthor: authorsById.get(thread.lastPostUserId),
          lastPostTarget: newestLastPostTargetsByThreadId.get(thread._id),
        }),
      ),
      totals: {
        categories: boardCategories.length,
        threads: boardCategories.reduce(
          (total, category) => total + category.threadCount,
          0,
        ),
        posts: boardCategories.reduce(
          (total, category) => total + category.postCount,
          0,
        ),
      },
      online,
      statistics,
    };
  },
});

export const listThreads = query({
  args: {
    categorySlug: v.string(),
    limit: v.optional(v.number()),
    page: v.optional(v.number()),
    threadPage: v.optional(v.number()),
    replyPage: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    prefixId: v.optional(v.union(v.id("forumThreadPrefixes"), v.null())),
    sortKey: v.optional(threadListSortKeyValidator),
    sortOrder: v.optional(threadListSortOrderValidator),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await maybeCurrentUser(ctx);
    const category = await requireVisibleCategory(
      ctx,
      args.categorySlug,
      viewer,
    );
    const pageSize = normalizePageSize(
      args.pageSize ?? args.limit,
      THREAD_PAGE_SIZE,
      THREAD_PAGE_MAX_SIZE,
    );
    const prefixFilter = await resolveThreadListPrefixFilter(
      ctx,
      category,
      args.prefixId,
    );
    const sortKey = args.sortKey ?? "lastPostAt";
    const sortOrder = args.sortOrder ?? "desc";
    const days = normalizeThreadListDays(args.days);
    const requestedPage = normalizePage(args.page);
    const usesDefaultThreadListWindow =
      sortKey === "lastPostAt" && sortOrder === "desc" && days === undefined;
    const unfilteredReachableTotalThreads = Math.min(
      category.threadCount,
      THREAD_PAGE_SCAN_LIMIT,
    );
    const unfilteredPage = Math.min(
      requestedPage,
      pageCount(unfilteredReachableTotalThreads, pageSize),
    );
    const fetchLimit =
      prefixFilter.kind === "all" && usesDefaultThreadListWindow
        ? Math.min(
            Math.max(unfilteredPage * pageSize, 5),
            THREAD_PAGE_SCAN_LIMIT,
          )
        : THREAD_PAGE_SCAN_LIMIT;

    const [activePinned, activeUnpinned, lockedPinned, lockedUnpinned] =
      await Promise.all([
        loadThreadListBucket(
          ctx,
          category._id,
          prefixFilter,
          "active",
          true,
          fetchLimit,
        ),
        loadThreadListBucket(
          ctx,
          category._id,
          prefixFilter,
          "active",
          false,
          fetchLimit,
        ),
        loadThreadListBucket(
          ctx,
          category._id,
          prefixFilter,
          "locked",
          true,
          fetchLimit,
        ),
        loadThreadListBucket(
          ctx,
          category._id,
          prefixFilter,
          "locked",
          false,
          fetchLimit,
        ),
      ]);

    const orderedThreads = sortThreadListRecords(
      filterThreadListByDays(
        [
          ...activePinned,
          ...lockedPinned,
          ...activeUnpinned,
          ...lockedUnpinned,
        ],
        days,
      ),
      sortKey,
      sortOrder,
    );
    const scannedThreads =
      prefixFilter.kind === "all" && usesDefaultThreadListWindow
        ? orderedThreads
        : orderedThreads.slice(0, THREAD_PAGE_SCAN_LIMIT);
    const scanLimited =
      !usesDefaultThreadListWindow &&
      orderedThreads.length > scannedThreads.length;
    const totalThreads =
      prefixFilter.kind === "all" && usesDefaultThreadListWindow
        ? category.threadCount
        : scannedThreads.length;
    const reachableTotalThreads = Math.min(
      totalThreads,
      THREAD_PAGE_SCAN_LIMIT,
    );
    const page = Math.min(
      requestedPage,
      pageCount(reachableTotalThreads, pageSize),
    );
    const startIndex = (page - 1) * pageSize;
    const threads = scannedThreads.slice(startIndex, startIndex + pageSize);
    const activityThreads = sortThreadListRecords(
      scannedThreads,
      "lastPostAt",
      "desc",
    ).slice(0, 5);
    const hydratedThreadsById = new Map(
      [...threads, ...activityThreads].map((thread) => [thread._id, thread]),
    );
    const hydratedThreads = Array.from(hydratedThreadsById.values());

    const authorsById = await loadUserNamesById(ctx, [
      ...hydratedThreads.map((thread) => thread.authorId),
      ...hydratedThreads.map((thread) => thread.lastPostUserId),
    ]);
    const lastPostTargetsByThreadId = await loadThreadLastPostTargets(
      ctx,
      hydratedThreads,
    );
    const readsByThreadId =
      viewer === null
        ? new Map<Id<"forumThreads">, ForumThreadReadDoc>()
        : await loadThreadReads(
            ctx,
            viewer._id,
            hydratedThreads.map((thread) => thread._id),
          );
    const categoryRead =
      viewer === null
        ? null
        : await loadCategoryRead(ctx, viewer._id, category._id);
    const categoryReadsById =
      categoryRead === null
        ? new Map<Id<"forumCategories">, ForumCategoryReadDoc>()
        : new Map([[category._id, categoryRead]]);
    const firstUnreadByThreadId =
      viewer === null
        ? new Map<Id<"forumThreads">, number>()
        : await loadFirstUnreadPostNumbers(
            ctx,
            hydratedThreads,
            readsByThreadId,
            categoryReadsById,
          );
    const [announcements, rules] = await Promise.all([
      activeAnnouncementsForCategory(ctx, category._id),
      activeBoardRulesForCategory(ctx, category._id),
    ]);
    return {
      category: await publicCategoryRecordWithNavigation(ctx, category, viewer),
      announcements: announcements.map((announcement) =>
        publicForumAnnouncementRecord(
          announcement,
          announcement.categoryId === undefined ? undefined : category,
        ),
      ),
      rules:
        rules === null ? null : publicForumBoardRulesRecord(rules, category),
      activityThreads: activityThreads.map((thread) =>
        publicThreadListRecord(thread, authorsById.get(thread.authorId), {
          lastPostAuthor: authorsById.get(thread.lastPostUserId),
          lastPostTarget: lastPostTargetsByThreadId.get(thread._id),
          viewerHasRead:
            viewer === null
              ? undefined
              : hasReadThread(
                  thread,
                  readsByThreadId.get(thread._id),
                  categoryRead,
                ),
          firstUnreadPostNumber: firstUnreadByThreadId.get(thread._id),
        }),
      ),
      threads: threads.map((thread) =>
        publicThreadListRecord(thread, authorsById.get(thread.authorId), {
          lastPostAuthor: authorsById.get(thread.lastPostUserId),
          lastPostTarget: lastPostTargetsByThreadId.get(thread._id),
          viewerHasRead:
            viewer === null
              ? undefined
              : hasReadThread(
                  thread,
                  readsByThreadId.get(thread._id),
                  categoryRead,
                ),
          firstUnreadPostNumber: firstUnreadByThreadId.get(thread._id),
        }),
      ),
      pagination: paginationRecord({
        page,
        pageSize,
        totalItems: reachableTotalThreads,
        actualTotalItems:
          prefixFilter.kind === "all"
            ? category.threadCount
            : scanLimited
              ? reachableTotalThreads + 1
              : undefined,
      }),
    };
  },
});

export const listRecentThreads = query({
  args: {
    mode: recentThreadModeValidator,
    limit: v.optional(v.number()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await maybeCurrentUser(ctx);
    const now = Date.now();
    const pageSize = normalizePageSize(
      args.pageSize ?? args.limit,
      THREAD_PAGE_SIZE,
      THREAD_PAGE_MAX_SIZE,
    );
    const requestedPage = normalizePage(args.page);
    const since = args.mode === "today" ? startOfCurrentDay(now) : undefined;
    const [activeThreads, lockedThreads] = await Promise.all([
      ctx.db
        .query("forumThreads")
        .withIndex("by_status_and_lastPostAt", (q) => q.eq("status", "active"))
        .order("desc")
        .take(RECENT_THREAD_SCAN_LIMIT),
      ctx.db
        .query("forumThreads")
        .withIndex("by_status_and_lastPostAt", (q) => q.eq("status", "locked"))
        .order("desc")
        .take(RECENT_THREAD_SCAN_LIMIT),
    ]);
    const scanLimited =
      activeThreads.length >= RECENT_THREAD_SCAN_LIMIT ||
      lockedThreads.length >= RECENT_THREAD_SCAN_LIMIT;
    const candidateThreads = [...activeThreads, ...lockedThreads]
      .filter((thread) => since === undefined || thread.lastPostAt >= since)
      .sort(compareThreadsByLastPostAtDesc);
    const visibleCandidates = await filterThreadsForPublicCategory(
      ctx,
      candidateThreads,
      null,
      viewer,
    );
    const readsByThreadId =
      viewer === null
        ? new Map<Id<"forumThreads">, ForumThreadReadDoc>()
        : await loadThreadReads(
            ctx,
            viewer._id,
            visibleCandidates.map((thread) => thread._id),
          );
    const categoryReadsById =
      viewer === null
        ? new Map<Id<"forumCategories">, ForumCategoryReadDoc>()
        : await loadCategoryReads(
            ctx,
            viewer._id,
            visibleCandidates.map((thread) => thread.categoryId),
          );
    const unreadThreads =
      viewer === null
        ? []
        : visibleCandidates.filter(
            (thread) =>
              !hasReadThread(
                thread,
                readsByThreadId.get(thread._id),
                categoryReadsById.get(thread.categoryId),
              ),
          );
    const visibleThreads =
      args.mode === "new" && viewer !== null
        ? unreadThreads
        : visibleCandidates;
    const totalItems = visibleThreads.length;
    const pagination = paginationRecord({
      page: requestedPage,
      pageSize,
      totalItems,
      actualTotalItems: scanLimited ? totalItems + 1 : undefined,
    });
    const startIndex = (pagination.page - 1) * pageSize;
    const pageThreads = visibleThreads.slice(startIndex, startIndex + pageSize);
    const authorsById = await loadUserNamesById(ctx, [
      ...pageThreads.map((thread) => thread.authorId),
      ...pageThreads.map((thread) => thread.lastPostUserId),
    ]);
    const categoriesById = await loadCategoriesById(
      ctx,
      pageThreads.map((thread) => thread.categoryId),
    );
    const firstUnreadByThreadId =
      viewer === null
        ? new Map<Id<"forumThreads">, number>()
        : await loadFirstUnreadPostNumbers(
            ctx,
            pageThreads,
            readsByThreadId,
            categoryReadsById,
          );
    const lastPostTargetsByThreadId = await loadThreadLastPostTargets(
      ctx,
      pageThreads,
    );

    return {
      mode: args.mode,
      label: args.mode === "new" ? "New Posts" : "Today's Posts",
      since,
      visibleThreadCount: totalItems,
      unreadThreadCount: viewer === null ? undefined : unreadThreads.length,
      limited: scanLimited,
      threads: pageThreads.map((thread) =>
        publicThreadListRecord(thread, authorsById.get(thread.authorId), {
          lastPostAuthor: authorsById.get(thread.lastPostUserId),
          lastPostTarget: lastPostTargetsByThreadId.get(thread._id),
          categoryName: categoriesById.get(thread.categoryId)?.name,
          viewerHasRead:
            viewer === null
              ? undefined
              : hasReadThread(
                  thread,
                  readsByThreadId.get(thread._id),
                  categoryReadsById.get(thread.categoryId),
                ),
          firstUnreadPostNumber: firstUnreadByThreadId.get(thread._id),
        }),
      ),
      pagination,
    };
  },
});

export const getThread = query({
  args: {
    categorySlug: v.string(),
    threadSlug: v.string(),
    paginationOpts: v.optional(paginationOptsValidator),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await maybeCurrentUser(ctx);
    const category = await requireVisibleCategory(
      ctx,
      args.categorySlug,
      viewer,
    );
    const thread = await requirePublicThread(
      ctx,
      category.slug,
      args.threadSlug,
    );
    const pageSize = normalizePageSize(
      args.pageSize ?? args.paginationOpts?.numItems,
      POST_PAGE_SIZE,
      POST_PAGE_MAX_SIZE,
    );
    const requestedPage = normalizePage(args.page);
    const totalPosts = visibleThreadPostCount(thread);
    const totalPages = pageCount(totalPosts, pageSize);
    const page = Math.min(requestedPage, totalPages);
    const startPostNumber = (page - 1) * pageSize + 1;
    const endPostNumber = Math.min(totalPosts, page * pageSize);
    const replyStartVisibleNumber = Math.max(2, startPostNumber);
    const replyLimit = Math.max(0, endPostNumber - replyStartVisibleNumber + 1);
    const replyOffset = Math.max(0, replyStartVisibleNumber - 2);
    const replyFetchLimit =
      replyLimit === 0
        ? 0
        : Math.min(replyOffset + replyLimit, POST_PAGE_SCAN_LIMIT);

    const activeReplyRows =
      replyFetchLimit === 0
        ? []
        : await ctx.db
            .query("forumPosts")
            .withIndex("by_threadId_and_status_and_postNumber", (q) =>
              q.eq("threadId", thread._id).eq("status", "active"),
            )
            .order("asc")
            .take(replyFetchLimit);
    const pagePosts = activeReplyRows.slice(
      replyOffset,
      replyOffset + replyLimit,
    );

    const readState =
      viewer === null
        ? null
        : await loadThreadRead(ctx, viewer._id, thread._id);
    const categoryRead =
      viewer === null
        ? null
        : await loadCategoryRead(ctx, viewer._id, category._id);
    const effectiveRead = effectiveThreadRead(readState, categoryRead);
    const subscription =
      viewer === null
        ? null
        : await loadThreadSubscription(ctx, viewer._id, thread._id);
    const viewerThreadRating =
      viewer === null
        ? null
        : await loadThreadRating(ctx, viewer._id, thread._id);
    const viewerCanModerateCategory = await canModerateCategory(
      ctx,
      viewer,
      category,
    );
    const poll = await loadPublicPollForThread(
      ctx,
      thread,
      viewer,
      category,
      canVoteInCategory(viewer, category, viewerCanModerateCategory),
      viewerCanModerateCategory,
    );
    const authorsById = await loadUserNamesById(ctx, [
      thread.authorId,
      thread.lastPostUserId,
      ...(thread.lastEditedBy === undefined ? [] : [thread.lastEditedBy]),
      ...pagePosts.map((post) => post.authorId),
      ...pagePosts.flatMap((post) =>
        post.lastEditedBy === undefined ? [] : [post.lastEditedBy],
      ),
    ]);
    const authorIdentitiesById = await loadPublicUserIdentitiesById(ctx, [
      thread.authorId,
      ...pagePosts.map((post) => post.authorId),
    ]);
    const forumProfilesByUserId = await loadForumUserProfilesByUserIds(ctx, [
      thread.authorId,
      ...pagePosts.map((post) => post.authorId),
    ]);
    const targetKeys = [
      buildThreadReputationTargetKey(thread._id),
      ...pagePosts.map((post) => buildPostReputationTargetKey(post._id)),
    ];
    const viewerReputationsByTargetKey =
      viewer === null
        ? new Map<string, ForumReputationDoc>()
        : await loadForumReputationsByTargetKey(ctx, viewer._id, targetKeys);
    const viewerCanUseReputation =
      viewer !== null && (await canUseForumParticipation(ctx, viewer));
    const firstUnreadNumber =
      viewer === null || effectiveRead === null
        ? viewer === null
          ? undefined
          : 1
        : await resolveFirstUnreadPostNumber(ctx, thread, effectiveRead);
    const [announcements, rules] = await Promise.all([
      activeAnnouncementsForCategory(ctx, category._id),
      activeBoardRulesForCategory(ctx, category._id),
    ]);
    const attachmentsByPostKey = new Map<
      string,
      Awaited<ReturnType<typeof hydrateForumAttachments>>
    >();
    attachmentsByPostKey.set(
      "root",
      await hydrateForumAttachments(
        ctx,
        await loadActiveForumAttachmentsForPost(ctx, thread._id, undefined),
      ),
    );
    const replyAttachmentEntries = await Promise.all(
      pagePosts.map(
        async (post) =>
          [
            post._id,
            await hydrateForumAttachments(
              ctx,
              await loadActiveForumAttachmentsForPost(
                ctx,
                thread._id,
                post._id,
              ),
            ),
          ] as const,
      ),
    );
    for (const [postId, attachments] of replyAttachmentEntries) {
      attachmentsByPostKey.set(postId, attachments);
    }

    return {
      category: await publicCategoryRecordWithAncestors(ctx, category, viewer),
      announcements: announcements.map((announcement) =>
        publicForumAnnouncementRecord(
          announcement,
          announcement.categoryId === undefined ? undefined : category,
        ),
      ),
      rules:
        rules === null ? null : publicForumBoardRulesRecord(rules, category),
      thread: publicThreadDetailRecord(
        thread,
        authorsById.get(thread.authorId),
        authorsById.get(thread.lastPostUserId),
        {
          viewerCanModerate: viewerCanModerateCategory,
          viewerCanReply:
            thread.status === "active" &&
            canReplyInCategory(viewer, category, viewerCanModerateCategory),
          viewerCanEdit: canEditThread(
            viewer,
            thread,
            category,
            viewerCanModerateCategory,
          ),
          viewerCanDelete: canDeleteThread(
            viewer,
            thread,
            category,
            viewerCanModerateCategory,
          ),
          viewerHasRead:
            viewer === null
              ? undefined
              : hasReadThread(thread, readState, categoryRead),
          viewerSubscribed: subscription?.status === "active",
          viewerCanRateThread:
            viewer !== null &&
            viewer._id !== thread.authorId &&
            isTrustedForumUser(viewer) &&
            (await canUseForumParticipation(ctx, viewer)),
          viewerRating: viewerThreadRating?.score ?? 0,
          viewerCanGiveReputation:
            viewerCanUseReputation &&
            canGiveForumReputation(viewer, thread.authorId),
          viewerReputationScore:
            viewerReputationsByTargetKey.get(
              buildThreadReputationTargetKey(thread._id),
            )?.score ?? 0,
          authorProfile: forumProfilesByUserId.get(thread.authorId),
          authorIdentity: authorIdentitiesById.get(thread.authorId),
          firstUnreadPostNumber: firstUnreadNumber,
          attachments: attachmentsByPostKey.get("root"),
          lastEditedByName:
            thread.lastEditedBy === undefined
              ? undefined
              : authorsById.get(thread.lastEditedBy),
        },
      ),
      poll,
      replies: {
        page: pagePosts.map((post, index) =>
          publicPostRecord(post, authorsById.get(post.authorId), {
            viewerCanEdit: canEditPost(
              viewer,
              post,
              thread,
              category,
              viewerCanModerateCategory,
            ),
            viewerCanDelete: canDeletePost(
              viewer,
              post,
              thread,
              category,
              viewerCanModerateCategory,
            ),
            viewerCanGiveReputation:
              viewerCanUseReputation &&
              canGiveForumReputation(viewer, post.authorId),
            viewerReputationScore:
              viewerReputationsByTargetKey.get(
                buildPostReputationTargetKey(post._id),
              )?.score ?? 0,
            authorProfile: forumProfilesByUserId.get(post.authorId),
            authorIdentity: authorIdentitiesById.get(post.authorId),
            postNumberFallback: replyStartVisibleNumber + index,
            attachments: attachmentsByPostKey.get(post._id),
            lastEditedByName:
              post.lastEditedBy === undefined
                ? undefined
                : authorsById.get(post.lastEditedBy),
          }),
        ),
        isDone: page >= totalPages,
        pagination: paginationRecord({
          page,
          pageSize,
          totalItems: totalPosts,
          actualTotalItems: totalPosts,
        }),
      },
    };
  },
});

export const search = query({
  args: {
    query: v.optional(v.string()),
    categorySlug: v.optional(v.string()),
    limit: v.optional(v.number()),
    page: v.optional(v.number()),
    threadPage: v.optional(v.number()),
    replyPage: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    resultType: v.optional(searchResultTypeValidator),
    author: v.optional(v.string()),
    target: v.optional(searchTargetValidator),
    sortKey: v.optional(searchSortKeyValidator),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const searchQuery = normalizeOptionalSearchQuery(args.query);
    const target = args.target ?? "all";
    const sortKey = args.sortKey ?? "relevance";
    const days = normalizeSearchDays(args.days);
    const pageSize = normalizePageSize(
      args.pageSize ?? args.limit,
      SEARCH_RESULT_LIMIT,
      SEARCH_PAGE_MAX_SIZE,
    );
    const requestedPage = normalizePage(args.page);
    const threadPageNumber = normalizePage(args.threadPage ?? args.page);
    const postPageNumber = normalizePage(args.replyPage ?? args.page);
    const useAdvancedSearchScan =
      target !== "all" || sortKey !== "relevance" || days !== undefined;
    const requestedThreadFetchLimit = searchRequestedFetchLimit(
      threadPageNumber,
      pageSize,
      useAdvancedSearchScan,
    );
    const requestedPostFetchLimit = searchRequestedFetchLimit(
      postPageNumber,
      pageSize,
      useAdvancedSearchScan,
    );
    const threadFetchLimit = Math.min(
      requestedThreadFetchLimit,
      SEARCH_PAGE_SCAN_LIMIT,
    );
    const postFetchLimit = Math.min(
      requestedPostFetchLimit,
      SEARCH_PAGE_SCAN_LIMIT,
    );
    const resultType = args.resultType ?? "all";
    const viewer = await maybeCurrentUser(ctx);
    const category =
      args.categorySlug === undefined
        ? null
        : await requireVisibleCategory(ctx, args.categorySlug, viewer);
    const author = await searchAuthor(ctx, args.author);
    const authorId = author?.userId;

    if (author?.notFound === true) {
      const emptyPagination = searchPaginationRecord(
        requestedPage,
        pageSize,
        0,
        false,
      );
      return {
        threads: [],
        posts: [],
        pagination: emptyPagination,
        threadPagination: emptyPagination,
        postPagination: emptyPagination,
        limited: false,
        threadResultsLimited: false,
        postResultsLimited: false,
        filters: searchFiltersRecord(
          resultType,
          searchAuthorLabel(args.author),
          target,
          sortKey,
          days,
        ),
      };
    }
    if (searchQuery === null && authorId === undefined) {
      const emptyPagination = searchPaginationRecord(
        requestedPage,
        pageSize,
        0,
        false,
      );
      return {
        threads: [],
        posts: [],
        pagination: emptyPagination,
        threadPagination: emptyPagination,
        postPagination: emptyPagination,
        limited: false,
        threadResultsLimited: false,
        postResultsLimited: false,
        filters: searchFiltersRecord(
          resultType,
          searchAuthorLabel(args.author),
          target,
          sortKey,
          days,
        ),
      };
    }
    const searchThreads = resultType !== "replies";
    const searchPosts = resultType !== "threads";

    const threadSearch = !searchThreads
      ? { items: [], limited: false }
      : searchQuery === null && authorId !== undefined
        ? await searchVisibleThreadsByAuthor(
            ctx,
            threadFetchLimit,
            category,
            viewer,
            authorId,
            { days, sortKey },
          )
        : await searchVisibleThreads(
            ctx,
            searchQuery ?? "",
            threadFetchLimit,
            category,
            viewer,
            authorId,
            { days, sortKey, target: searchQuery === null ? "all" : target },
          );
    const threadHits = threadSearch.items;
    const threadPage = pageSearchHits(threadHits, threadPageNumber, pageSize);
    const threadAuthors = await loadUserNamesById(ctx, [
      ...threadPage.items.map((thread) => thread.authorId),
      ...threadPage.items.map((thread) => thread.lastPostUserId),
    ]);

    const postSearch = !searchPosts
      ? { items: [], limited: false }
      : searchQuery === null && authorId !== undefined
        ? await searchVisiblePostsByAuthor(
            ctx,
            postFetchLimit,
            category,
            viewer,
            authorId,
            { days, sortKey },
          )
        : await searchVisiblePosts(
            ctx,
            searchQuery ?? "",
            postFetchLimit,
            category,
            viewer,
            authorId,
            { days, sortKey, target: searchQuery === null ? "all" : target },
          );
    const postHits = postSearch.items;
    const postPage = pageSearchHits(postHits, postPageNumber, pageSize);
    const postAuthors = await loadUserNamesById(
      ctx,
      postPage.items.map((hit) => hit.post.authorId),
    );
    const postHitPositions = await Promise.all(
      postPage.items.map(
        async ({ post }) => await postNumberForPost(ctx, post),
      ),
    );
    const threadResultsLimited =
      searchThreads &&
      (threadSearch.limited ||
        requestedThreadFetchLimit > SEARCH_PAGE_SCAN_LIMIT);
    const postResultsLimited =
      searchPosts &&
      (postSearch.limited || requestedPostFetchLimit > SEARCH_PAGE_SCAN_LIMIT);

    return {
      threads: threadPage.items.map((thread) => ({
        _id: thread._id,
        threadId: thread._id,
        categoryId: thread.categoryId,
        categorySlug: thread.categorySlug,
        prefixId: thread.prefixId,
        prefix: publicThreadPrefixRecordFromThread(thread),
        slug: thread.slug,
        title: thread.title,
        excerpt: excerpt(thread.body, 220),
        status: thread.status,
        pinned: thread.pinned,
        replyCount: thread.replyCount,
        viewCount: thread.viewCount,
        createdAt: thread.createdAt,
        lastPostAt: thread.lastPostAt,
        author: threadAuthors.get(thread.authorId) ?? UNKNOWN_AUTHOR,
        lastPostAuthor:
          threadAuthors.get(thread.lastPostUserId) ?? UNKNOWN_AUTHOR,
      })),
      posts: postPage.items.map(({ post, thread }, index) => {
        const postNumber = postHitPositions[index];
        return {
          _id: post._id,
          postId: post._id,
          threadId: thread._id,
          categoryId: thread.categoryId,
          categorySlug: thread.categorySlug,
          prefixId: thread.prefixId,
          prefix: publicThreadPrefixRecordFromThread(thread),
          threadSlug: thread.slug,
          threadTitle: thread.title,
          body: excerpt(post.body, 220),
          excerpt: excerpt(post.body, 220),
          createdAt: post.createdAt,
          threadLastPostAt: thread.lastPostAt,
          threadReplyCount: thread.replyCount,
          threadViewCount: thread.viewCount,
          author: postAuthors.get(post.authorId) ?? UNKNOWN_AUTHOR,
          postNumber,
          postPage:
            postNumber === undefined
              ? undefined
              : pageForPostNumber(postNumber, POST_PAGE_SIZE),
        };
      }),
      pagination: searchPaginationRecord(
        requestedPage,
        pageSize,
        resultType === "replies"
          ? postPage.items.length
          : threadPage.items.length,
        resultType === "replies"
          ? postPage.hasNextPage
          : threadPage.hasNextPage,
        resultType === "replies" ? postResultsLimited : threadResultsLimited,
      ),
      threadPagination: searchPaginationRecord(
        threadPageNumber,
        pageSize,
        threadPage.items.length,
        threadPage.hasNextPage,
        threadResultsLimited,
      ),
      postPagination: searchPaginationRecord(
        postPageNumber,
        pageSize,
        postPage.items.length,
        postPage.hasNextPage,
        postResultsLimited,
      ),
      limited: threadResultsLimited || postResultsLimited,
      threadResultsLimited,
      postResultsLimited,
      filters: searchFiltersRecord(
        resultType,
        searchAuthorLabel(args.author),
        target,
        sortKey,
        days,
      ),
    };
  },
});

export const listMyThreadSubscriptions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to view subscribed forum threads.",
    );
    const limit = clampLimit(args.limit, THREAD_LIST_LIMIT, THREAD_LIST_LIMIT);
    const subscriptions = await ctx.db
      .query("forumThreadSubscriptions")
      .withIndex("by_userId_and_status_and_updatedAt", (q) =>
        q.eq("userId", user._id).eq("status", "active"),
      )
      .order("desc")
      .take(Math.min(limit * 3, THREAD_PAGE_SCAN_LIMIT));
    const threadsById = await loadThreadsById(
      ctx,
      subscriptions.map((subscription) => subscription.threadId),
    );
    const threads = subscriptions
      .map((subscription) => threadsById.get(subscription.threadId))
      .filter(
        (thread): thread is ForumThreadDoc =>
          thread !== undefined && isVisibleThreadStatus(thread.status),
      );
    const categoriesById = await loadCategoriesById(
      ctx,
      threads.map((thread) => thread.categoryId),
    );
    const categoryVisibility = new Map(
      await Promise.all(
        Array.from(categoriesById.values()).map(
          async (category) =>
            [
              category._id,
              isBoardCategory(category) &&
                (await canViewCategoryWithAncestors(ctx, user, category)),
            ] as const,
        ),
      ),
    );
    const visibleThreads = threads
      .filter((thread) => categoryVisibility.get(thread.categoryId) === true)
      .slice(0, limit);
    const authorsById = await loadUserNamesById(ctx, [
      ...visibleThreads.map((thread) => thread.authorId),
      ...visibleThreads.map((thread) => thread.lastPostUserId),
    ]);
    const readsByThreadId = await loadThreadReads(
      ctx,
      user._id,
      visibleThreads.map((thread) => thread._id),
    );
    const categoryReadsById = await loadCategoryReads(
      ctx,
      user._id,
      visibleThreads.map((thread) => thread.categoryId),
    );
    const firstUnreadByThreadId = await loadFirstUnreadPostNumbers(
      ctx,
      visibleThreads,
      readsByThreadId,
      categoryReadsById,
    );
    const lastPostTargetsByThreadId = await loadThreadLastPostTargets(
      ctx,
      visibleThreads,
    );

    return {
      threads: visibleThreads.map((thread) =>
        publicThreadListRecord(thread, authorsById.get(thread.authorId), {
          lastPostAuthor: authorsById.get(thread.lastPostUserId),
          lastPostTarget: lastPostTargetsByThreadId.get(thread._id),
          viewerHasRead: hasReadThread(
            thread,
            readsByThreadId.get(thread._id),
            categoryReadsById.get(thread.categoryId),
          ),
          firstUnreadPostNumber: firstUnreadByThreadId.get(thread._id),
        }),
      ),
    };
  },
});

export const listMyCategorySubscriptions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to view subscribed forum boards.",
    );
    const limit = clampLimit(args.limit, THREAD_LIST_LIMIT, THREAD_LIST_LIMIT);
    const subscriptions = await ctx.db
      .query("forumCategorySubscriptions")
      .withIndex("by_userId_and_status_and_updatedAt", (q) =>
        q.eq("userId", user._id).eq("status", "active"),
      )
      .order("desc")
      .take(Math.min(limit * 3, CATEGORY_LIST_LIMIT));
    const categoriesById = await loadCategoriesById(
      ctx,
      subscriptions.map((subscription) => subscription.categoryId),
    );
    const categories = subscriptions
      .map((subscription) => categoriesById.get(subscription.categoryId))
      .filter(
        (category): category is ForumCategoryDoc =>
          category !== undefined &&
          isBoardCategory(category) &&
          category.status === "active",
      );
    const visibleCategories = (
      await visibleCategoriesForUser(ctx, categories, user)
    ).slice(0, limit);
    const lastThreadsById = await loadThreadsById(
      ctx,
      visibleCategories.flatMap((category) =>
        category.lastThreadId === undefined ? [] : [category.lastThreadId],
      ),
    );
    const lastPostTargetsByThreadId = await loadThreadLastPostTargets(
      ctx,
      Array.from(lastThreadsById.values()),
    );

    return {
      categories: visibleCategories.map((category) => {
        const lastThread =
          category.lastThreadId === undefined
            ? undefined
            : lastThreadsById.get(category.lastThreadId);
        return publicCategoryRecord(
          category,
          lastThread,
          lastThread === undefined
            ? undefined
            : lastPostTargetsByThreadId.get(lastThread._id),
        );
      }),
    };
  },
});

export const listMyNotifications = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(notificationStatusValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to view forum notifications.",
    );
    const limit = clampLimit(args.limit, 20, 80);
    const status = args.status;
    const visibleNotificationScan = await loadVisibleForumNotifications(ctx, {
      user,
      status,
      scanLimit: NOTIFICATION_VISIBILITY_SCAN_LIMIT,
      visibleLimit: limit,
    });
    const visibleNotifications = visibleNotificationScan.visible;
    const visibleUnreadScan = await loadVisibleForumNotifications(ctx, {
      user,
      status: "unread",
      scanLimit: NOTIFICATION_VISIBILITY_SCAN_LIMIT,
      visibleLimit: NOTIFICATION_UNREAD_SCAN_LIMIT + 1,
    });
    const visibleUnreadCount = Math.min(
      visibleUnreadScan.visible.length,
      NOTIFICATION_UNREAD_SCAN_LIMIT,
    );
    const [postsById, actorsById] = await Promise.all([
      loadPostsById(
        ctx,
        visibleNotifications.flatMap(({ notification }) =>
          notification.postId === undefined ? [] : [notification.postId],
        ),
      ),
      loadUserNamesById(
        ctx,
        visibleNotifications.map(
          ({ notification }) => notification.actorUserId,
        ),
      ),
    ]);

    return {
      unreadCount: visibleUnreadCount,
      unreadCountLimited:
        visibleUnreadScan.visible.length > NOTIFICATION_UNREAD_SCAN_LIMIT ||
        visibleUnreadScan.limited,
      notificationsLimited: visibleNotificationScan.limited,
      notifications: visibleNotifications.map(
        ({ category, notification, thread }) => {
          const post =
            notification.postId === undefined
              ? undefined
              : postsById.get(notification.postId);
          return publicNotificationRecord(
            notification,
            thread,
            category,
            actorsById.get(notification.actorUserId),
            post,
          );
        },
      ),
    };
  },
});

export const getMyForumNavState = query({
  args: {},
  handler: async (ctx) => {
    const user = await maybeCurrentUser(ctx);
    if (user === null) {
      return {
        authenticated: false,
        trusted: false,
        canModerate: false,
        canAdmin: false,
        canManageBoards: false,
        username: null,
        rank: null,
        postCount: 0,
        reputationScore: 0,
        unreadNotifications: 0,
        unreadNotificationsLimited: false,
        unreadPrivateMessages: 0,
        unreadPrivateMessagesLimited: false,
      };
    }

    const profile = await loadForumUserProfile(ctx, user._id);
    const postCount = profile?.postCount ?? 0;
    const notificationSummary = await visibleUnreadForumNotificationSummary(
      ctx,
      user,
    );
    const privateMessageSummary = isTrustedForumUser(user)
      ? await unreadPrivateMessageSummary(ctx, user._id)
      : { unreadCount: 0, unreadCountLimited: false };
    const canModerateForum = await canModerateAnyForumCategory(ctx, user);

    return {
      authenticated: true,
      trusted: isTrustedForumUser(user),
      canModerate: canModerateForum,
      canAdmin: canAdminForum(user),
      canManageBoards: canAdminForum(user),
      username: displayName(user),
      rank: forumRankForPostCount(postCount),
      postCount,
      reputationScore: profileReputationScore(profile),
      unreadNotifications: notificationSummary.unreadCount,
      unreadNotificationsLimited: notificationSummary.unreadCountLimited,
      unreadPrivateMessages: privateMessageSummary.unreadCount,
      unreadPrivateMessagesLimited: privateMessageSummary.unreadCountLimited,
    };
  },
});

export const recordPresence = mutation({
  args: {
    locationType: presenceLocationTypeValidator,
    path: v.string(),
    label: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to appear in the forum online list.",
    );
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before appearing online.",
    );
    const now = Date.now();
    const path = cleanRequired(
      args.path,
      1,
      FORUM_PRESENCE_PATH_MAX_LENGTH,
      "Forum path",
    );
    const forumPath = path.startsWith("/forum") ? path : "/forum";
    const label = cleanRequired(
      args.label,
      1,
      FORUM_PRESENCE_LABEL_MAX_LENGTH,
      "Forum location",
    );
    const existing = await ctx.db
      .query("forumPresence")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    if (
      existing !== null &&
      existing.locationType === args.locationType &&
      existing.path === forumPath &&
      now - existing.lastSeenAt < FORUM_PRESENCE_HEARTBEAT_MIN_MS
    ) {
      return { recorded: false, lastSeenAt: existing.lastSeenAt };
    }

    if (existing === null) {
      const presenceId = await ctx.db.insert("forumPresence", {
        userId: user._id,
        locationType: args.locationType,
        path: forumPath,
        label,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return { recorded: true, presenceId, lastSeenAt: now };
    }

    await ctx.db.patch(existing._id, {
      locationType: args.locationType,
      path: forumPath,
      label,
      lastSeenAt: now,
      updatedAt: now,
    });
    return { recorded: true, presenceId: existing._id, lastSeenAt: now };
  },
});

export const markNotificationRead = mutation({
  args: {
    notificationId: v.optional(v.id("forumNotifications")),
    markAll: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to update forum notifications.",
    );
    const now = Date.now();

    if (args.markAll === true) {
      const unread = await loadVisibleForumNotifications(ctx, {
        user,
        status: "unread",
        scanLimit: NOTIFICATION_VISIBILITY_SCAN_LIMIT,
        visibleLimit: NOTIFICATION_MARK_READ_BATCH_LIMIT,
      });
      const visibleUnread = unread.visible;
      for (const { notification } of visibleUnread) {
        await ctx.db.patch(notification._id, {
          status: "read",
          readAt: now,
          updatedAt: now,
        });
      }
      return { marked: visibleUnread.length };
    }

    if (args.notificationId === undefined) {
      throw forumError(
        "INVALID_NOTIFICATION",
        "Choose a notification to mark read.",
      );
    }
    const notification = await ctx.db.get(args.notificationId);
    if (notification === null || notification.recipientUserId !== user._id) {
      throw forumError(
        "NOTIFICATION_NOT_FOUND",
        "That notification is not available.",
      );
    }
    if (notification.status === "read") {
      return { marked: 0 };
    }
    await ctx.db.patch(notification._id, {
      status: "read",
      readAt: now,
      updatedAt: now,
    });
    return { marked: 1 };
  },
});

export const listPrivateMessages = query({
  args: {
    box: v.optional(privateMessageBoxValidator),
    limit: v.optional(v.number()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to read forum private messages.",
    );
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before using private messages.",
    );
    const box = args.box ?? "inbox";
    const pageSize = normalizePageSize(args.pageSize ?? args.limit, 30, 50);
    const requestedPage = normalizePage(args.page);
    const page = Math.min(requestedPage, PRIVATE_MESSAGE_PAGE_DEPTH_LIMIT);
    const pageDepthLimited = requestedPage > PRIVATE_MESSAGE_PAGE_DEPTH_LIMIT;
    const searchQuery = normalizePrivateMessageSearchQuery(args.query);
    const fetchLimit =
      searchQuery.length > 0
        ? PRIVATE_MESSAGE_SEARCH_SCAN_LIMIT
        : Math.min(
            page * pageSize + 1,
            PRIVATE_MESSAGE_PAGE_DEPTH_LIMIT * pageSize + 1,
          );
    const { limited: rawMessagesLimited, rows } = await loadPrivateMailboxRows(
      ctx,
      user._id,
      box,
      fetchLimit,
    );
    const usersById = await loadPublicUserIdentitiesById(ctx, [
      ...rows.map((message) => message.senderUserId),
      ...rows.map((message) => message.recipientUserId),
    ]);
    const filteredRows =
      searchQuery.length === 0
        ? rows
        : rows.filter((message) =>
            privateMessageMatchesQuery(
              message,
              user._id,
              usersById,
              searchQuery,
              box,
            ),
          );
    const knownTotalItems =
      filteredRows.length > page * pageSize
        ? page * pageSize + 1
        : filteredRows.length;
    const startIndex = (page - 1) * pageSize;
    const messages = filteredRows.slice(startIndex, startIndex + pageSize);
    const [unreadSummary, quota] = await Promise.all([
      unreadPrivateMessageSummary(ctx, user._id),
      privateMessageQuotaSummary(ctx, user._id),
    ]);

    return {
      box,
      query: searchQuery,
      unreadCount: unreadSummary.unreadCount,
      unreadCountLimited: unreadSummary.unreadCountLimited,
      messagesLimited:
        knownTotalItems > messages.length ||
        pageDepthLimited ||
        rawMessagesLimited,
      pagination: paginationRecord({
        page,
        pageSize,
        totalItems: knownTotalItems,
        actualTotalItems:
          pageDepthLimited || rawMessagesLimited
            ? knownTotalItems + 1
            : undefined,
      }),
      quota,
      messages: messages.map((message) =>
        privateMessageListRecord(message, user._id, usersById, box),
      ),
    };
  },
});

export const getPrivateMessage = query({
  args: {
    messageId: v.id("forumPrivateMessages"),
    box: v.optional(privateMessageBoxValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to read forum private messages.",
    );
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before using private messages.",
    );
    const message = await requirePrivateMessageForUser(
      ctx,
      args.messageId,
      user,
      args.box,
    );
    const usersById = await loadPublicUserIdentitiesById(ctx, [
      message.senderUserId,
      message.recipientUserId,
    ]);
    return privateMessageDetailRecord(message, user._id, usersById, args.box);
  },
});

export const sendPrivateMessage = mutation({
  args: {
    recipientUsername: v.string(),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const sender = await requireSignedInUser(
      ctx,
      "Sign in with a SYM handle to send private messages.",
    );
    requireTrustedForumUser(
      sender,
      "Ask the site owner to approve your forum access before sending private messages.",
    );
    await assertForumParticipationAllowed(ctx, sender, "send private messages");
    const recipientUsername = normalizeRequiredForumUsername(
      args.recipientUsername,
    );
    const recipient = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", recipientUsername),
      )
      .unique();
    if (recipient === null || !isTrustedForumUser(recipient)) {
      throw forumError(
        "RECIPIENT_NOT_FOUND",
        "That forum member is not available.",
      );
    }
    if (recipient._id === sender._id) {
      throw forumError(
        "INVALID_RECIPIENT",
        "Send private messages to another member.",
      );
    }
    const recipientIgnoresSender = await loadForumUserRelationship(
      ctx,
      recipient._id,
      sender._id,
      "ignore",
    );
    if (recipientIgnoresSender !== null) {
      throw forumError(
        "PRIVATE_MESSAGE_IGNORED",
        "That member is not accepting private messages from you.",
      );
    }
    const [senderQuota, recipientQuota] = await Promise.all([
      privateMessageQuotaSummary(ctx, sender._id),
      privateMessageQuotaSummary(ctx, recipient._id),
    ]);
    if (senderQuota.used >= senderQuota.limit) {
      throw forumError(
        "PRIVATE_MESSAGE_QUOTA_FULL",
        "Your private message box is full.",
      );
    }
    if (recipientQuota.used >= recipientQuota.limit) {
      throw forumError(
        "PRIVATE_MESSAGE_QUOTA_FULL",
        "That member's private message box is full.",
      );
    }

    const subject = normalizePrivateMessageSubject(args.subject);
    const body = normalizePrivateMessageBody(args.body);
    const now = Date.now();
    const recent = await ctx.db
      .query("forumPrivateMessages")
      .withIndex("by_senderUserId_and_createdAt", (q) =>
        q.eq("senderUserId", sender._id),
      )
      .order("desc")
      .take(5);
    const lastMessage = recent[0];
    if (
      lastMessage !== undefined &&
      now - lastMessage.createdAt < PRIVATE_MESSAGE_RATE_LIMIT_MS
    ) {
      throw forumError(
        "PRIVATE_MESSAGE_RATE_LIMITED",
        "Give the inbox a moment, then send again.",
      );
    }
    const recentToRecipient = await ctx.db
      .query("forumPrivateMessages")
      .withIndex("by_senderUserId_and_recipientUserId_and_createdAt", (q) =>
        q.eq("senderUserId", sender._id).eq("recipientUserId", recipient._id),
      )
      .order("desc")
      .take(10);
    const lastMessageToRecipient = recentToRecipient[0];
    if (
      lastMessageToRecipient !== undefined &&
      now - lastMessageToRecipient.createdAt <
        PRIVATE_MESSAGE_RECIPIENT_RATE_LIMIT_MS
    ) {
      throw forumError(
        "PRIVATE_MESSAGE_RECIPIENT_RATE_LIMITED",
        "Give that member's inbox a minute, then send again.",
      );
    }
    const duplicate = recentToRecipient.find(
      (message) =>
        message.subject === subject &&
        message.body === body &&
        now - message.createdAt < PRIVATE_MESSAGE_DUPLICATE_WINDOW_MS,
    );
    if (duplicate !== undefined) {
      throw forumError(
        "DUPLICATE_PRIVATE_MESSAGE",
        "That private message already landed.",
      );
    }

    const messageId = await ctx.db.insert("forumPrivateMessages", {
      senderUserId: sender._id,
      recipientUserId: recipient._id,
      subject,
      body,
      createdAt: now,
      updatedAt: now,
    });

    return { messageId, createdAt: now };
  },
});

export const markPrivateMessageRead = mutation({
  args: {
    messageId: v.id("forumPrivateMessages"),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to update private messages.",
    );
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before using private messages.",
    );
    const message = await ctx.db.get(args.messageId);
    if (
      message === null ||
      message.recipientUserId !== user._id ||
      message.recipientDeletedAt !== undefined
    ) {
      throw forumError(
        "PRIVATE_MESSAGE_NOT_FOUND",
        "That private message is not available.",
      );
    }
    if (message.readAt !== undefined) {
      return { marked: false };
    }
    await ctx.db.patch(message._id, {
      readAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { marked: true };
  },
});

export const deletePrivateMessage = mutation({
  args: {
    messageId: v.id("forumPrivateMessages"),
    box: privateMessageBoxValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to update private messages.",
    );
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before using private messages.",
    );
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      throw forumError(
        "PRIVATE_MESSAGE_NOT_FOUND",
        "That private message is not available.",
      );
    }
    const now = Date.now();
    if (args.box === "sent") {
      if (
        message.senderUserId !== user._id ||
        message.senderPurgedAt !== undefined ||
        message.senderDeletedAt !== undefined
      ) {
        throw forumError(
          "PRIVATE_MESSAGE_NOT_FOUND",
          "That private message is not available.",
        );
      }
      await ctx.db.patch(message._id, {
        senderDeletedAt: now,
        updatedAt: now,
      });
      return { deleted: true };
    }

    if (args.box === "trash") {
      if (
        message.recipientUserId === user._id &&
        message.recipientDeletedAt !== undefined &&
        message.recipientPurgedAt === undefined
      ) {
        await ctx.db.patch(message._id, {
          recipientPurgedAt: now,
          updatedAt: now,
        });
        return { deleted: true };
      }
      if (
        message.senderUserId === user._id &&
        message.senderDeletedAt !== undefined &&
        message.senderPurgedAt === undefined
      ) {
        await ctx.db.patch(message._id, {
          senderPurgedAt: now,
          updatedAt: now,
        });
        return { deleted: true };
      }
      throw forumError(
        "PRIVATE_MESSAGE_NOT_FOUND",
        "That private message is not available.",
      );
    }

    if (
      message.recipientUserId !== user._id ||
      message.recipientPurgedAt !== undefined ||
      message.recipientDeletedAt !== undefined
    ) {
      throw forumError(
        "PRIVATE_MESSAGE_NOT_FOUND",
        "That private message is not available.",
      );
    }
    await ctx.db.patch(message._id, {
      recipientDeletedAt: now,
      readAt: message.readAt ?? now,
      updatedAt: now,
    });
    return { deleted: true };
  },
});

export const restorePrivateMessage = mutation({
  args: {
    messageId: v.id("forumPrivateMessages"),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to update private messages.",
    );
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before using private messages.",
    );
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      throw forumError(
        "PRIVATE_MESSAGE_NOT_FOUND",
        "That private message is not available.",
      );
    }
    const now = Date.now();
    if (
      message.recipientUserId === user._id &&
      message.recipientDeletedAt !== undefined &&
      message.recipientPurgedAt === undefined
    ) {
      await ctx.db.patch(message._id, {
        recipientDeletedAt: undefined,
        updatedAt: now,
      });
      return { restored: true, box: "inbox" as const };
    }
    if (
      message.senderUserId === user._id &&
      message.senderDeletedAt !== undefined &&
      message.senderPurgedAt === undefined
    ) {
      await ctx.db.patch(message._id, {
        senderDeletedAt: undefined,
        updatedAt: now,
      });
      return { restored: true, box: "sent" as const };
    }
    throw forumError(
      "PRIVATE_MESSAGE_NOT_FOUND",
      "That private message is not available.",
    );
  },
});

export const listMembers = query({
  args: {
    limit: v.optional(v.number()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    query: v.optional(v.string()),
    sortKey: v.optional(memberSortKeyValidator),
  },
  handler: async (ctx, args) => {
    const pageSize = normalizePageSize(
      args.pageSize ?? args.limit,
      MEMBER_LIST_DEFAULT_PAGE_SIZE,
      MEMBER_LIST_MAX_PAGE_SIZE,
    );
    const requestedPage = normalizePage(args.page);
    const page = Math.min(requestedPage, MEMBER_LIST_PAGE_DEPTH_LIMIT);
    const query = normalizeMemberSearchQuery(args.query);
    const sortKey = args.sortKey ?? "posts-desc";
    const [profiles, directoryUsers] = await Promise.all([
      loadForumMemberProfilesForList(ctx, sortKey),
      loadForumDirectoryUsers(ctx),
    ]);
    const directoryProfilesByUserId = await loadForumUserProfilesByUserIds(
      ctx,
      directoryUsers.map((user) => user._id),
    );
    const candidateUserIds = [
      ...profiles.map((profile) => profile.userId),
      ...directoryUsers.map((user) => user._id),
    ];
    const activePresenceByUserId = await loadActivePresenceByUserIds(
      ctx,
      candidateUserIds,
      Date.now(),
    );
    const rowsByUserId = new Map<Id<"users">, ForumMemberListRecord>();
    const profileRows = await Promise.all(
      profiles.map(async (profile) => {
        const user = await ctx.db.get(profile.userId);
        return { profile, user };
      }),
    );
    for (const { profile, user } of profileRows) {
      if (user === null || !isTrustedForumUser(user)) {
        continue;
      }
      const member = publicForumMemberRecord(
        user,
        profile,
        profile,
        activePresenceByUserId.get(profile.userId),
      );
      if (memberMatchesServerQuery(member, query)) {
        rowsByUserId.set(user._id, member);
      }
    }
    for (const user of directoryUsers) {
      if (rowsByUserId.has(user._id)) {
        continue;
      }
      const profile = directoryProfilesByUserId.get(user._id) ?? null;
      const member = publicForumMemberRecord(
        user,
        profile,
        profile ?? { threadCount: 0, postCount: 0 },
        activePresenceByUserId.get(user._id),
      );
      if (memberMatchesServerQuery(member, query)) {
        rowsByUserId.set(user._id, member);
      }
    }
    const memberRows = [...rowsByUserId.values()];
    const sortedMembers = sortForumMemberRecords(memberRows, sortKey);
    const totalItems = sortedMembers.length;
    const pagination = paginationRecord({
      page,
      pageSize,
      totalItems,
      actualTotalItems:
        profiles.length >= MEMBER_LIST_SCAN_LIMIT ||
        directoryUsers.length >= MEMBER_LIST_SCAN_LIMIT ||
        requestedPage > MEMBER_LIST_PAGE_DEPTH_LIMIT
          ? totalItems + 1
          : undefined,
    });
    const startIndex = (pagination.page - 1) * pageSize;

    return {
      members: sortedMembers.slice(startIndex, startIndex + pageSize),
      pagination,
      limited: pagination.limited,
      filters: {
        query,
        sortKey,
      },
    };
  },
});

export const listOnlineMembers = query({
  args: {
    limit: v.optional(v.number()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const pageSize = normalizePageSize(
      args.pageSize ?? args.limit,
      MEMBER_LIST_DEFAULT_PAGE_SIZE,
      MEMBER_LIST_MAX_PAGE_SIZE,
    );
    const requestedPage = normalizePage(args.page);
    const presences = await ctx.db
      .query("forumPresence")
      .withIndex("by_lastSeenAt")
      .order("desc")
      .take(FORUM_PRESENCE_SCAN_LIMIT);
    const activePresences = presences.filter((presence) =>
      isActiveForumPresence(presence, now),
    );
    const activePresenceUsers = await Promise.all(
      activePresences.map(
        async (presence) =>
          [presence, await ctx.db.get(presence.userId)] as const,
      ),
    );
    const visiblePresenceUsers = activePresenceUsers.flatMap(
      ([presence, user]) =>
        user !== null && isTrustedForumUser(user)
          ? [[presence, user] as const]
          : [],
    );
    const totalItems = visiblePresenceUsers.length;
    const pagination = paginationRecord({
      page: requestedPage,
      pageSize,
      totalItems,
      actualTotalItems:
        presences.length >= FORUM_PRESENCE_SCAN_LIMIT
          ? totalItems + 1
          : undefined,
    });
    const startIndex = (pagination.page - 1) * pageSize;
    const displayPresenceUsers = visiblePresenceUsers.slice(
      startIndex,
      startIndex + pageSize,
    );
    const profilesByUserId = await loadForumUserProfilesByUserIds(
      ctx,
      displayPresenceUsers.map(([presence]) => presence.userId),
    );

    return {
      activeSince: now - FORUM_PRESENCE_WINDOW_MS,
      registeredCount: totalItems,
      registeredCountLimited: presences.length >= FORUM_PRESENCE_SCAN_LIMIT,
      members: displayPresenceUsers.map(([presence, user]) =>
        publicForumPresenceMemberRecord(
          presence,
          user,
          profilesByUserId.get(presence.userId),
        ),
      ),
      pagination,
    };
  },
});

export const getMyForumProfile = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to edit forum profile settings.",
    );
    const profile = await loadForumUserProfile(ctx, user._id);
    const warningSummary = await activeWarningSummaryForUser(
      ctx,
      user._id,
      Date.now(),
    );
    return myForumProfileRecord(user, profile, warningSummary);
  },
});

export const getMyForumNotificationPreferences = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to edit forum notification settings.",
    );
    const preferences = await loadForumNotificationPreferences(ctx, user._id);
    return myForumNotificationPreferencesRecord(user, preferences);
  },
});

export const listMyForumReputationHistory = query({
  args: {
    direction: reputationHistoryDirectionValidator,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to review forum reputation history.",
    );
    const limit = clampLimit(
      args.limit,
      MY_FORUM_REPUTATION_HISTORY_LIMIT,
      MY_FORUM_REPUTATION_HISTORY_LIMIT,
    );
    const query =
      args.direction === "received"
        ? ctx.db
            .query("forumReputations")
            .withIndex("by_toUserId_and_createdAt", (q) =>
              q.eq("toUserId", user._id),
            )
            .order("desc")
        : ctx.db
            .query("forumReputations")
            .withIndex("by_fromUserId_and_createdAt", (q) =>
              q.eq("fromUserId", user._id),
            )
            .order("desc");

    return await loadVisibleMyForumReputationHistory(ctx, query, user, limit);
  },
});

export const listMyForumWarnings = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to review forum warning history.",
    );
    const limit = clampLimit(
      args.limit,
      MY_FORUM_WARNING_LIST_LIMIT,
      MY_FORUM_WARNING_LIST_LIMIT,
    );
    const warnings = await ctx.db
      .query("forumWarnings")
      .withIndex("by_targetUserId_and_createdAt", (q) =>
        q.eq("targetUserId", user._id),
      )
      .order("desc")
      .take(limit);

    return await hydrateMyForumWarnings(ctx, warnings, user, Date.now());
  },
});

export const listMyPendingForumContent = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to review pending forum content.",
    );
    const limit = clampLimit(
      args.limit,
      MY_PENDING_FORUM_CONTENT_LIMIT,
      MY_PENDING_FORUM_CONTENT_LIMIT,
    );
    const [pendingThreads, pendingPosts] = await Promise.all([
      ctx.db
        .query("forumThreads")
        .withIndex("by_authorId_and_status_and_createdAt", (q) =>
          q.eq("authorId", user._id).eq("status", "pending"),
        )
        .order("desc")
        .take(limit),
      ctx.db
        .query("forumPosts")
        .withIndex("by_authorId_and_status_and_createdAt", (q) =>
          q.eq("authorId", user._id).eq("status", "pending"),
        )
        .order("desc")
        .take(limit),
    ]);

    return await hydrateMyPendingForumContent(
      ctx,
      pendingThreads,
      pendingPosts,
      user,
    );
  },
});

export const listMyForumRelationships = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to manage forum buddies and ignored members.",
    );
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before managing buddies and ignored members.",
    );
    const limit = clampLimit(
      args.limit,
      FORUM_RELATIONSHIP_LIST_LIMIT,
      FORUM_RELATIONSHIP_LIST_LIMIT,
    );
    const [buddyRows, ignoredRows] = await Promise.all([
      ctx.db
        .query("forumUserRelationships")
        .withIndex("by_userId_and_kind_and_createdAt", (q) =>
          q.eq("userId", user._id).eq("kind", "buddy"),
        )
        .order("desc")
        .take(limit),
      ctx.db
        .query("forumUserRelationships")
        .withIndex("by_userId_and_kind_and_createdAt", (q) =>
          q.eq("userId", user._id).eq("kind", "ignore"),
        )
        .order("desc")
        .take(limit),
    ]);
    const rows = [...buddyRows, ...ignoredRows];
    const targetUserEntries = await Promise.all(
      [...new Set(rows.map((row) => row.targetUserId))].map(
        async (targetUserId) =>
          [targetUserId, await ctx.db.get(targetUserId)] as const,
      ),
    );
    const targetUsersById = new Map(
      targetUserEntries.flatMap(([targetUserId, targetUser]) =>
        targetUser === null ? [] : [[targetUserId, targetUser] as const],
      ),
    );
    const profilesByUserId = await loadForumUserProfilesByUserIds(
      ctx,
      rows.map((row) => row.targetUserId),
    );

    return {
      buddies: publicForumRelationshipRecords(
        buddyRows,
        targetUsersById,
        profilesByUserId,
      ),
      ignored: publicForumRelationshipRecords(
        ignoredRows,
        targetUsersById,
        profilesByUserId,
      ),
    };
  },
});

export const authorizeForumAttachmentUpload = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to upload forum attachments.",
    );
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before uploading attachments.",
    );
    await assertForumParticipationAllowed(
      ctx,
      user,
      "upload forum attachments",
    );
    await assertForumPendingUploadCapacity(ctx, user._id);
    return { ok: true };
  },
});

export const claimStoredForumAttachmentUpload = internalMutation({
  args: {
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to claim forum attachments.",
    );
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before uploading attachments.",
    );
    await assertForumParticipationAllowed(
      ctx,
      user,
      "upload forum attachments",
    );
    await assertForumPendingUploadCapacity(ctx, user._id);

    const now = Date.now();
    const metadata = await loadForumAttachmentStorageMetadata(
      ctx,
      args.storageId,
    );
    const normalized = normalizeForumAttachmentUpload(
      args.storageId,
      args.filename,
      metadata,
      args.contentType,
    );
    const existing = (
      await ctx.db
        .query("forumPendingUploads")
        .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
        .take(1)
    )[0];
    if (existing !== undefined) {
      if (existing.userId !== user._id || existing.status !== "pending") {
        throw forumError(
          "INVALID_ATTACHMENT",
          "That attachment upload is not available.",
        );
      }
      await ctx.db.patch(existing._id, {
        filename: normalized.filename,
        contentType: normalized.contentType,
        size: normalized.size,
        expiresAt: now + FORUM_PENDING_ATTACHMENT_UPLOAD_TTL_MS,
        updatedAt: now,
      });
      return normalized;
    }

    await ctx.db.insert("forumPendingUploads", {
      userId: user._id,
      storageId: args.storageId,
      filename: normalized.filename,
      contentType: normalized.contentType,
      size: normalized.size,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + FORUM_PENDING_ATTACHMENT_UPLOAD_TTL_MS,
    });
    return normalized;
  },
});

export const cleanupForumAttachmentStorage = internalMutation({
  args: {
    limit: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = clampLimit(
      args.limit,
      FORUM_ATTACHMENT_CLEANUP_BATCH_LIMIT,
      FORUM_ATTACHMENT_CLEANUP_BATCH_LIMIT,
    );
    const expiredPendingUploads = await ctx.db
      .query("forumPendingUploads")
      .withIndex("by_status_and_expiresAt", (q) =>
        q.eq("status", "pending").lt("expiresAt", now),
      )
      .take(limit);
    const deletedAttachments = await ctx.db
      .query("forumAttachments")
      .withIndex("by_status_and_deletedAt", (q) =>
        q
          .eq("status", "deleted")
          .lt("deletedAt", now - FORUM_DELETED_ATTACHMENT_STORAGE_GRACE_MS),
      )
      .take(Math.max(0, limit - expiredPendingUploads.length));

    for (const pendingUpload of expiredPendingUploads) {
      await deleteForumStorageObjectIfPresent(ctx, pendingUpload.storageId);
      await ctx.db.delete(pendingUpload._id);
    }

    for (const attachment of deletedAttachments) {
      await deleteForumStorageObjectIfPresent(ctx, attachment.storageId);
      await ctx.db.delete(attachment._id);
    }

    return {
      expiredPendingUploadsDeleted: expiredPendingUploads.length,
      deletedAttachmentsPurged: deletedAttachments.length,
    };
  },
});

export const createThread = mutation({
  args: {
    categorySlug: v.string(),
    prefixId: v.optional(v.union(v.id("forumThreadPrefixes"), v.null())),
    title: v.string(),
    body: v.string(),
    attachments: v.optional(v.array(attachmentInputValidator)),
    poll: v.optional(
      v.object({
        question: v.string(),
        options: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in with a SYM handle to start a thread.",
    );
    const category = await requireWritableCategory(
      ctx,
      args.categorySlug,
      user,
      "thread",
    );
    const userCanModerateCategory = await canModerateCategory(
      ctx,
      user,
      category,
    );
    if (!userCanModerateCategory) {
      await assertForumParticipationAllowed(ctx, user, "start new threads");
    }
    const title = normalizeTitle(args.title);
    const body = normalizeThreadBody(args.body);
    const poll = normalizePollInput(args.poll);
    if (
      poll !== null &&
      !canVoteInCategory(user, category, userCanModerateCategory)
    ) {
      throw forumError(
        "FORUM_PERMISSION_REQUIRED",
        categoryPermissionMessage(category, "poll"),
      );
    }
    const attachments = await normalizeForumAttachmentInputs(
      ctx,
      user._id,
      args.attachments,
    );
    const prefix = await resolveThreadPrefixForCategory(
      ctx,
      args.prefixId ?? null,
      category,
    );
    const prefixSnapshot = threadPrefixSnapshot(prefix);
    const now = Date.now();

    const recent = await ctx.db
      .query("forumThreads")
      .withIndex("by_authorId_and_createdAt", (q) => q.eq("authorId", user._id))
      .order("desc")
      .take(5);
    const lastThread = recent[0];

    if (
      lastThread !== undefined &&
      now - lastThread.createdAt < THREAD_RATE_LIMIT_MS
    ) {
      throw forumError(
        "THREAD_RATE_LIMITED",
        "Give the board a breath, then try that topic again.",
      );
    }

    const duplicate = recent.find(
      (thread) =>
        thread.categoryId === category._id &&
        (thread.prefixId ?? null) === (prefix?._id ?? null) &&
        thread.title.trim() === title &&
        thread.body.trim() === body &&
        now - thread.createdAt < THREAD_DUPLICATE_WINDOW_MS,
    );
    if (duplicate !== undefined) {
      throw forumError("DUPLICATE_THREAD", "That thread already landed.");
    }

    const slug = await generateUniqueThreadSlug(ctx, category.slug, title);
    const searchBodyParts = [
      prefix?.label,
      body,
      ...(poll === null ? [] : [poll.question, ...poll.options]),
    ].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    const searchBody = searchBodyParts.join("\n");
    const initialStatus: ForumThreadStatus =
      shouldHoldForumSubmissionForApproval(user) ? "pending" : "active";
    const threadId = await ctx.db.insert("forumThreads", {
      categoryId: category._id,
      categorySlug: category.slug,
      ...prefixSnapshot,
      slug,
      title,
      body,
      authorId: user._id,
      status: initialStatus,
      pinned: false,
      replyCount: 0,
      lastAssignedPostNumber: 1,
      viewCount: 0,
      lastPostAt: now,
      lastPostUserId: user._id,
      searchText: buildThreadSearchText(
        category,
        title,
        searchBody,
        displayName(user),
      ),
      createdAt: now,
      updatedAt: now,
    });

    if (poll !== null) {
      const pollId = await ctx.db.insert("forumPolls", {
        threadId,
        categoryId: category._id,
        question: poll.question,
        status: "open",
        optionCount: poll.options.length,
        totalVotes: 0,
        createdAt: now,
        updatedAt: now,
      });
      for (const [position, label] of poll.options.entries()) {
        await ctx.db.insert("forumPollOptions", {
          pollId,
          threadId,
          label,
          position,
          voteCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    await insertForumAttachments(ctx, {
      attachments,
      authorId: user._id,
      categoryId: category._id,
      threadId,
      now,
    });
    if (initialStatus === "active") {
      await ensureThreadParticipantSubscription(ctx, {
        userId: user._id,
        threadId,
        categoryId: category._id,
        now,
      });

      await ctx.db.patch(category._id, {
        threadCount: category.threadCount + 1,
        postCount: category.postCount + 1,
        lastThreadId: threadId,
        lastPostId: undefined,
        lastPostAt: now,
        updatedAt: now,
      });
      await bumpForumUserProfileStats(ctx, user._id, {
        threadDelta: 1,
        postDelta: 1,
        now,
      });
      await createNewThreadNotifications(ctx, {
        actorUserId: user._id,
        categoryId: category._id,
        threadId,
        now,
      });
      await scheduleForumAgentReview(ctx, {
        sourceKind: "thread",
        threadId,
        categoryId: category._id,
        authorId: user._id,
        now,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.forumAgentMemory.indexForumThread,
        { threadId },
      );
    } else {
      await recordModerationLog(ctx, {
        actorUserId: user._id,
        entityType: "forumThread",
        entityId: threadId,
        eventType: "forum_thread_submitted",
        message: "Forum thread submitted for approval",
        categoryId: category._id,
        threadId,
        metadata: {
          categoryId: category._id,
          categorySlug: category.slug,
          title,
          status: initialStatus,
          actorWasModerator: false,
        },
      });
    }

    return {
      threadId,
      categoryId: category._id,
      categorySlug: category.slug,
      threadSlug: slug,
      status: initialStatus,
      createdAt: now,
    };
  },
});

export const updateMyForumProfile = mutation({
  args: {
    avatarUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
    birthday: v.optional(v.string()),
    signature: v.optional(v.string()),
    customTitle: v.optional(v.string()),
    location: v.optional(v.string()),
    showSignatures: v.boolean(),
    timeZone: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to update forum profile settings.",
    );
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before updating your forum profile.",
    );
    await assertForumParticipationAllowed(ctx, user, "update forum profile");
    const avatarUrl = cleanOptionalForumUrl(
      args.avatarUrl,
      FORUM_PROFILE_AVATAR_URL_MAX_LENGTH,
      "Avatar URL",
    );
    const bio = cleanOptional(args.bio, FORUM_PROFILE_BIO_MAX_LENGTH);
    const birthday = cleanOptionalForumBirthday(args.birthday);
    const signature = cleanOptional(args.signature, FORUM_SIGNATURE_MAX_LENGTH);
    const customTitle = cleanOptional(
      args.customTitle,
      FORUM_CUSTOM_TITLE_MAX_LENGTH,
    );
    const location = cleanOptional(
      args.location,
      FORUM_PROFILE_LOCATION_MAX_LENGTH,
    );
    const timeZone = cleanOptional(
      args.timeZone,
      FORUM_PROFILE_TIME_ZONE_MAX_LENGTH,
    );
    const websiteUrl = cleanOptionalForumUrl(
      args.websiteUrl,
      FORUM_PROFILE_WEBSITE_URL_MAX_LENGTH,
      "Website URL",
    );
    const now = Date.now();
    const profile = await loadForumUserProfile(ctx, user._id);

    if (profile === null) {
      const profileId = await ctx.db.insert("forumUserProfiles", {
        userId: user._id,
        avatarUrl,
        bio,
        birthday,
        signature,
        customTitle,
        location,
        showSignatures: args.showSignatures,
        timeZone,
        threadCount: 0,
        postCount: 0,
        websiteUrl,
        createdAt: now,
        updatedAt: now,
      });
      const created = await ctx.db.get(profileId);
      if (created === null) {
        throw new Error("Forum profile could not be reloaded");
      }
      const warningSummary = await activeWarningSummaryForUser(
        ctx,
        user._id,
        now,
      );
      return myForumProfileRecord(user, created, warningSummary);
    }

    await ctx.db.patch(profile._id, {
      avatarUrl,
      bio,
      birthday,
      signature,
      customTitle,
      location,
      showSignatures: args.showSignatures,
      timeZone,
      websiteUrl,
      updatedAt: now,
    });
    const updated = await ctx.db.get(profile._id);
    if (updated === null) {
      throw new Error("Forum profile could not be reloaded");
    }
    const warningSummary = await activeWarningSummaryForUser(
      ctx,
      user._id,
      now,
    );
    return myForumProfileRecord(user, updated, warningSummary);
  },
});

export const updateMyForumNotificationPreferences = mutation({
  args: {
    inAppReplies: v.boolean(),
    inAppNewThreads: v.boolean(),
    emailReplies: v.boolean(),
    emailNewThreads: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to update forum notification settings.",
    );
    const now = Date.now();
    const existing = await loadForumNotificationPreferences(ctx, user._id);
    const nextSettings = {
      inAppReplies: args.inAppReplies,
      inAppNewThreads: args.inAppNewThreads,
      emailReplies: args.emailReplies,
      emailNewThreads: args.emailNewThreads,
    };

    if (existing === null) {
      const preferencesId = await ctx.db.insert(
        "forumNotificationPreferences",
        {
          userId: user._id,
          ...nextSettings,
          createdAt: now,
          updatedAt: now,
        },
      );
      const created = await ctx.db.get(preferencesId);
      if (created === null) {
        throw new Error("Forum notification preferences could not be reloaded");
      }
      return myForumNotificationPreferencesRecord(user, created);
    }

    await ctx.db.patch(existing._id, {
      ...nextSettings,
      updatedAt: now,
    });
    const updated = await ctx.db.get(existing._id);
    if (updated === null) {
      throw new Error("Forum notification preferences could not be reloaded");
    }
    return myForumNotificationPreferencesRecord(user, updated);
  },
});

export const updateForumRelationship = mutation({
  args: {
    username: v.string(),
    kind: forumRelationshipKindValidator,
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to manage forum buddies and ignored members.",
    );
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before managing buddies and ignored members.",
    );
    const username = normalizeRequiredForumUsername(args.username);
    const target = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", username),
      )
      .unique();
    if (target === null || target.usernameNormalized === undefined) {
      throw forumError(
        "FORUM_MEMBER_NOT_FOUND",
        "That forum member is not available.",
      );
    }
    if (target._id === user._id) {
      throw forumError(
        "INVALID_RELATIONSHIP_TARGET",
        "Choose another forum member.",
      );
    }

    const existing = await loadForumUserRelationship(
      ctx,
      user._id,
      target._id,
      args.kind,
    );
    const now = Date.now();
    if (args.enabled) {
      if (existing !== null) {
        return {
          enabled: true,
          kind: args.kind,
          record: publicForumRelationshipRecord(
            existing,
            target,
            await loadForumUserProfile(ctx, target._id),
          ),
        };
      }
      const currentRows = await ctx.db
        .query("forumUserRelationships")
        .withIndex("by_userId_and_kind_and_createdAt", (q) =>
          q.eq("userId", user._id).eq("kind", args.kind),
        )
        .take(FORUM_RELATIONSHIP_LIST_LIMIT + 1);
      if (currentRows.length >= FORUM_RELATIONSHIP_LIST_LIMIT) {
        throw forumError(
          "RELATIONSHIP_LIST_FULL",
          `Remove a ${args.kind === "buddy" ? "buddy" : "member from your ignored list"} before adding another one.`,
        );
      }
      const relationshipId = await ctx.db.insert("forumUserRelationships", {
        userId: user._id,
        targetUserId: target._id,
        kind: args.kind,
        createdAt: now,
        updatedAt: now,
      });
      const record = await ctx.db.get(relationshipId);
      if (record === null) {
        throw new Error("Forum relationship record could not be reloaded");
      }
      return {
        enabled: true,
        kind: args.kind,
        record: publicForumRelationshipRecord(
          record,
          target,
          await loadForumUserProfile(ctx, target._id),
        ),
      };
    }

    if (existing !== null) {
      await ctx.db.delete(existing._id);
    }
    return {
      enabled: false,
      kind: args.kind,
      targetUserId: target._id,
      username: publicForumUsername(target),
    };
  },
});

export const createReply = mutation({
  args: {
    threadId: v.id("forumThreads"),
    body: v.string(),
    attachments: v.optional(v.array(attachmentInputValidator)),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in with a SYM handle to reply.",
    );
    const thread = await ctx.db.get(args.threadId);
    if (thread === null) {
      throw forumError(
        "THREAD_NOT_FOUND",
        "That thread is no longer available.",
      );
    }
    const category = await requireVisibleCategoryById(
      ctx,
      thread.categoryId,
      user,
    );
    const userCanModerateCategory = await canModerateCategory(
      ctx,
      user,
      category,
    );
    if (!canReplyInCategory(user, category, userCanModerateCategory)) {
      throw forumError(
        "FORUM_PERMISSION_REQUIRED",
        categoryPermissionMessage(category, "reply"),
      );
    }
    if (thread.status === "locked") {
      throw forumError("THREAD_LOCKED", "That thread is locked.");
    }
    if (!isVisibleThreadStatus(thread.status)) {
      throw forumError(
        "THREAD_NOT_FOUND",
        "That thread is no longer available.",
      );
    }

    if (!userCanModerateCategory) {
      await assertForumParticipationAllowed(ctx, user, "reply to threads");
    }
    const body = normalizeReplyBody(args.body);
    const attachments = await normalizeForumAttachmentInputs(
      ctx,
      user._id,
      args.attachments,
    );
    const now = Date.now();
    const recent = await ctx.db
      .query("forumPosts")
      .withIndex("by_authorId_and_createdAt", (q) => q.eq("authorId", user._id))
      .order("desc")
      .take(5);
    const lastPost = recent[0];

    if (
      lastPost !== undefined &&
      now - lastPost.createdAt < REPLY_RATE_LIMIT_MS
    ) {
      throw forumError(
        "REPLY_RATE_LIMITED",
        "Give the thread a breath, then try again.",
      );
    }

    const duplicate = recent.find(
      (post) =>
        post.threadId === thread._id &&
        (post.status === "active" || post.status === "pending") &&
        post.body.trim() === body &&
        now - post.createdAt < REPLY_DUPLICATE_WINDOW_MS,
    );
    if (duplicate !== undefined) {
      throw forumError("DUPLICATE_REPLY", "That reply already landed.");
    }

    const postNumber = await nextPostNumberForThread(ctx, thread);
    const initialStatus: ForumPostDoc["status"] =
      shouldHoldForumSubmissionForApproval(user) ? "pending" : "active";
    const postId = await ctx.db.insert("forumPosts", {
      threadId: thread._id,
      categoryId: category._id,
      authorId: user._id,
      body,
      postNumber,
      status: initialStatus,
      createdAt: now,
      updatedAt: now,
    });
    await insertForumAttachments(ctx, {
      attachments,
      authorId: user._id,
      categoryId: category._id,
      postId,
      threadId: thread._id,
      now,
    });

    if (initialStatus === "pending") {
      await ctx.db.patch(thread._id, {
        lastAssignedPostNumber: postNumber,
        updatedAt: now,
      });
      await recordModerationLog(ctx, {
        actorUserId: user._id,
        entityType: "forumPost",
        entityId: postId,
        eventType: "forum_post_submitted",
        message: "Forum reply submitted for approval",
        categoryId: category._id,
        threadId: thread._id,
        postId,
        metadata: {
          categoryId: category._id,
          threadId: thread._id,
          postNumber,
          status: initialStatus,
          actorWasModerator: false,
        },
      });

      return {
        postId,
        threadId: thread._id,
        postNumber,
        postPage: pageForPostNumber(postNumber, POST_PAGE_SIZE),
        status: initialStatus,
        createdAt: now,
      };
    }

    await ctx.db.patch(thread._id, {
      replyCount: thread.replyCount + 1,
      lastAssignedPostNumber: postNumber,
      lastPostId: postId,
      lastPostAt: now,
      lastPostUserId: user._id,
      updatedAt: now,
    });
    await ctx.db.patch(category._id, {
      postCount: category.postCount + 1,
      lastThreadId: thread._id,
      lastPostId: postId,
      lastPostAt: now,
      updatedAt: now,
    });
    await bumpForumUserProfileStats(ctx, user._id, {
      postDelta: 1,
      now,
    });
    await ensureThreadParticipantSubscription(ctx, {
      userId: user._id,
      threadId: thread._id,
      categoryId: category._id,
      now,
    });
    await createReplyNotifications(ctx, {
      actorUserId: user._id,
      categoryId: category._id,
      postId,
      threadId: thread._id,
      now,
    });
    await scheduleForumAgentReview(ctx, {
      sourceKind: "reply",
      sourcePostId: postId,
      threadId: thread._id,
      categoryId: category._id,
      authorId: user._id,
      now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.forumAgentMemory.indexForumThread,
      { threadId: thread._id },
    );

    return {
      postId,
      threadId: thread._id,
      postNumber,
      postPage: pageForPostNumber(postNumber, POST_PAGE_SIZE),
      status: initialStatus,
      createdAt: now,
    };
  },
});

export const continueReplyNotifications = internalMutation({
  args: {
    actorUserId: v.id("users"),
    categoryId: v.id("forumCategories"),
    postId: v.id("forumPosts"),
    threadId: v.id("forumThreads"),
    now: v.number(),
    cursor: v.string(),
  },
  handler: async (ctx, args) => {
    await createReplyNotifications(ctx, {
      actorUserId: args.actorUserId,
      categoryId: args.categoryId,
      postId: args.postId,
      threadId: args.threadId,
      now: args.now,
      cursor: args.cursor,
    });
    return null;
  },
});

export const continueNewThreadNotifications = internalMutation({
  args: {
    actorUserId: v.id("users"),
    categoryId: v.id("forumCategories"),
    threadId: v.id("forumThreads"),
    now: v.number(),
    cursor: v.string(),
  },
  handler: async (ctx, args) => {
    await createNewThreadNotifications(ctx, {
      actorUserId: args.actorUserId,
      categoryId: args.categoryId,
      threadId: args.threadId,
      now: args.now,
      cursor: args.cursor,
    });
    return null;
  },
});

export const readForumNotificationEmailDelivery = internalQuery({
  args: {
    deliveryId: v.id("forumNotificationEmailDeliveries"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.deliveryId);
  },
});

export const readForumNotificationEmailDeliveryContext = internalQuery({
  args: {
    deliveryId: v.id("forumNotificationEmailDeliveries"),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (delivery === null) {
      return forumNotificationEmailNotReady(
        "Forum email delivery no longer exists",
      );
    }
    if (delivery.status !== "queued") {
      return forumNotificationEmailNotReady(
        "Forum email delivery is not queued",
      );
    }

    const [recipient, actor, category, thread] = await Promise.all([
      ctx.db.get(delivery.recipientUserId),
      ctx.db.get(delivery.actorUserId),
      ctx.db.get(delivery.categoryId),
      ctx.db.get(delivery.threadId),
    ]);
    if (recipient === null) {
      return forumNotificationEmailNotReady("Forum email recipient is missing");
    }
    if (actor === null) {
      return forumNotificationEmailNotReady("Forum email actor is missing");
    }
    if (category === null || category.status !== "active") {
      return forumNotificationEmailNotReady("Forum board is no longer active");
    }
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      return forumNotificationEmailNotReady(
        "Forum thread is no longer visible",
      );
    }
    if (thread.categoryId !== category._id) {
      return forumNotificationEmailNotReady("Forum thread moved boards");
    }
    if (!(await canViewCategoryWithAncestors(ctx, recipient, category))) {
      return forumNotificationEmailNotReady(
        "Forum email recipient can no longer view this board",
      );
    }
    const currentToEmail = forumEmailDestination(recipient);
    if (currentToEmail === null) {
      return forumNotificationEmailNotReady(
        "Forum email recipient no longer has an eligible email address",
      );
    }
    if (currentToEmail !== delivery.toEmail) {
      return forumNotificationEmailNotReady(
        "Forum email recipient address changed before delivery",
      );
    }
    const preferences = forumNotificationPreferenceSettings(
      await loadForumNotificationPreferences(ctx, recipient._id),
    );
    if (
      (delivery.type === "reply" && !preferences.emailReplies) ||
      (delivery.type === "newThread" && !preferences.emailNewThreads)
    ) {
      return forumNotificationEmailNotReady(
        "Forum email notification preference is disabled",
      );
    }
    const activeSubscription =
      delivery.type === "reply"
        ? await loadThreadSubscription(ctx, recipient._id, thread._id)
        : await loadCategorySubscription(ctx, recipient._id, category._id);
    if (activeSubscription?.status !== "active") {
      return forumNotificationEmailNotReady(
        "Forum email subscription is no longer active",
      );
    }

    const post =
      delivery.postId === undefined ? null : await ctx.db.get(delivery.postId);
    if (delivery.type === "reply") {
      if (post === null || post.status !== "active") {
        return forumNotificationEmailNotReady(
          "Forum reply is no longer visible",
        );
      }
      if (post.threadId !== thread._id || post.categoryId !== category._id) {
        return forumNotificationEmailNotReady(
          "Forum reply moved from this thread",
        );
      }
    }

    return forumNotificationEmailReady(delivery, {
      actorName: displayName(actor),
      body:
        delivery.type === "reply" && post !== null ? post.body : thread.body,
      categoryName: category.name,
      categorySlug: category.slug,
      post,
      recipientName: displayName(recipient),
      threadSlug: thread.slug,
      threadTitle: thread.title,
    });
  },
});

export const markForumNotificationEmailDeliveryState = internalMutation({
  args: {
    deliveryId: v.id("forumNotificationEmailDeliveries"),
    status: forumNotificationEmailDeliveryStatusValidator,
    reason: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (delivery === null) {
      return null;
    }
    await ctx.db.patch(args.deliveryId, {
      status: args.status,
      reason: args.reason,
      sentAt: args.sentAt,
      failedAt: args.failedAt,
      error: args.error,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const continueThreadVisibilityProfileDeltas = internalMutation({
  args: {
    threadId: v.id("forumThreads"),
    isVisible: v.boolean(),
    now: v.number(),
    token: v.string(),
    cursor: v.string(),
  },
  handler: async (ctx, args) => {
    await applyThreadVisibilityReplyProfileDeltaBatch(ctx, {
      threadId: args.threadId,
      isVisible: args.isVisible,
      now: args.now,
      token: args.token,
      cursor: args.cursor,
    });
    return null;
  },
});

export const continueMovedThreadCategoryReferenceSync = internalMutation({
  args: {
    threadId: v.id("forumThreads"),
    targetCategoryId: v.id("forumCategories"),
    now: v.number(),
    token: v.string(),
    phase: threadMoveSyncPhaseValidator,
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await syncMovedThreadCategoryReferenceBatch(ctx, args);
    return null;
  },
});

export const recordThreadView = mutation({
  args: {
    threadId: v.id("forumThreads"),
  },
  handler: async (ctx, args) => {
    const user = await maybeCurrentUser(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      return { recorded: false, viewCount: null };
    }
    const category = await visibleCategoryById(ctx, thread.categoryId, user);
    if (category === null) {
      return { recorded: false, viewCount: null };
    }
    if (user === null || !isTrustedForumUser(user)) {
      return { recorded: false, viewCount: thread.viewCount };
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("forumThreadViews")
      .withIndex("by_userId_and_threadId", (q) =>
        q.eq("userId", user._id).eq("threadId", thread._id),
      )
      .unique();
    if (
      existing !== null &&
      now - existing.lastViewedAt < THREAD_VIEW_DEDUP_MS
    ) {
      return { recorded: false, viewCount: thread.viewCount };
    }

    const nextViewCount = thread.viewCount + 1;
    if (existing === null) {
      await ctx.db.insert("forumThreadViews", {
        userId: user._id,
        threadId: thread._id,
        categoryId: category._id,
        lastViewedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(existing._id, {
        lastViewedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(thread._id, {
      viewCount: nextViewCount,
      updatedAt: now,
    });
    return { recorded: true, viewCount: nextViewCount };
  },
});

export const markThreadRead = mutation({
  args: {
    threadId: v.id("forumThreads"),
    lastReadPostNumber: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to mark forum threads read.",
    );
    const thread = await ctx.db.get(args.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    const category = await requireVisibleCategoryById(
      ctx,
      thread.categoryId,
      user,
    );

    const totalPosts = threadPostNumberCeiling(thread);
    const lastReadPostNumber = Math.min(
      totalPosts,
      Math.max(1, Math.floor(args.lastReadPostNumber ?? totalPosts)),
    );
    const viewedPostAt = await timestampForPostNumber(
      ctx,
      thread,
      lastReadPostNumber,
    );
    const existing = await loadThreadRead(ctx, user._id, thread._id);
    const readThroughAt =
      lastReadPostNumber >= totalPosts
        ? Math.max(viewedPostAt, threadReadActivityAt(thread))
        : viewedPostAt;
    const lastReadAt = Math.max(existing?.lastReadAt ?? 0, readThroughAt);
    const storedPostNumber = Math.max(
      existing?.lastReadPostNumber ?? 0,
      lastReadPostNumber,
    );
    const readId = await upsertThreadRead(
      ctx,
      user._id,
      category._id,
      thread._id,
      {
        lastPostAt: lastReadAt,
        lastReadAt,
        lastReadPostNumber: storedPostNumber,
      },
    );
    return { marked: true, readId, lastReadAt };
  },
});

export const markCategoryRead = mutation({
  args: {
    categorySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to mark a board read.",
    );
    const category = await requireVisibleCategory(ctx, args.categorySlug, user);
    const now = Date.now();
    await upsertCategoryRead(ctx, user._id, category._id, {
      lastPostAt: categoryReadActivityAt(category),
      lastReadAt: now,
    });

    return { marked: true, threadCount: category.threadCount, markedAt: now };
  },
});

export const markAllForumsRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to mark all forums read.",
    );
    const categories = await ctx.db
      .query("forumCategories")
      .withIndex("by_status_and_position", (q) => q.eq("status", "active"))
      .take(CATEGORY_LIST_LIMIT);
    const visibleBoards = (
      await visibleCategoriesForUser(ctx, categories, user)
    ).filter(isBoardCategory);
    const now = Date.now();

    for (const category of visibleBoards) {
      await upsertCategoryRead(ctx, user._id, category._id, {
        lastPostAt: categoryReadActivityAt(category),
        lastReadAt: now,
      });
    }

    return {
      marked: true,
      categoryCount: visibleBoards.length,
      markedAt: now,
    };
  },
});

export const toggleThreadSubscription = mutation({
  args: {
    threadId: v.id("forumThreads"),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to subscribe to threads.",
    );
    const thread = await ctx.db.get(args.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    const category = await requireVisibleCategoryById(
      ctx,
      thread.categoryId,
      user,
    );

    const existing = await loadThreadSubscription(ctx, user._id, thread._id);
    const now = Date.now();
    if (existing === null) {
      const subscriptionId = await ctx.db.insert("forumThreadSubscriptions", {
        userId: user._id,
        threadId: thread._id,
        categoryId: category._id,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return { subscribed: true, subscriptionId };
    }

    const nextStatus = existing.status === "active" ? "muted" : "active";
    await ctx.db.patch(existing._id, {
      status: nextStatus,
      updatedAt: now,
    });
    return {
      subscribed: nextStatus === "active",
      subscriptionId: existing._id,
    };
  },
});

export const toggleCategorySubscription = mutation({
  args: {
    categorySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to subscribe to boards.",
    );
    const category = await requireVisibleCategory(ctx, args.categorySlug, user);
    const existing = await loadCategorySubscription(
      ctx,
      user._id,
      category._id,
    );
    const now = Date.now();
    if (existing === null) {
      const subscriptionId = await ctx.db.insert("forumCategorySubscriptions", {
        userId: user._id,
        categoryId: category._id,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return { subscribed: true, subscriptionId };
    }

    const nextStatus = existing.status === "active" ? "muted" : "active";
    await ctx.db.patch(existing._id, {
      status: nextStatus,
      updatedAt: now,
    });
    return {
      subscribed: nextStatus === "active",
      subscriptionId: existing._id,
    };
  },
});

export const votePoll = mutation({
  args: {
    pollId: v.id("forumPolls"),
    optionId: v.id("forumPollOptions"),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in with a SYM handle to vote.",
    );
    const poll = await ctx.db.get(args.pollId);
    if (poll === null) {
      throw forumError("POLL_NOT_FOUND", "That poll is not available.");
    }
    const thread = await ctx.db.get(poll.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    const category = await requireVisibleCategoryById(
      ctx,
      poll.categoryId,
      user,
    );
    const userCanModerateCategory = await canModerateCategory(
      ctx,
      user,
      category,
    );
    if (!canVoteInCategory(user, category, userCanModerateCategory)) {
      throw forumError(
        "FORUM_PERMISSION_REQUIRED",
        categoryPermissionMessage(category, "poll"),
      );
    }
    if (thread.status !== "active" || poll.status !== "open") {
      throw forumError("POLL_CLOSED", "That poll is closed.");
    }

    const option = await ctx.db.get(args.optionId);
    if (
      option === null ||
      option.pollId !== poll._id ||
      option.threadId !== thread._id
    ) {
      throw forumError(
        "POLL_OPTION_NOT_FOUND",
        "That poll option is not available.",
      );
    }

    const existingVote = await loadPollVote(ctx, poll._id, user._id);
    if (existingVote !== null) {
      if (existingVote.optionId === option._id) {
        const currentPoll = await ctx.db.get(poll._id);
        const currentThread = await ctx.db.get(thread._id);
        return {
          voted: false,
          poll:
            currentPoll === null || currentThread === null
              ? null
              : await publicPollRecord(
                  ctx,
                  currentPoll,
                  currentThread,
                  user._id,
                ),
        };
      }
      throw forumError("POLL_ALREADY_VOTED", "You already voted in this poll.");
    }

    const now = Date.now();
    await ctx.db.insert("forumPollVotes", {
      pollId: poll._id,
      optionId: option._id,
      threadId: thread._id,
      userId: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(option._id, {
      voteCount: option.voteCount + 1,
      updatedAt: now,
    });
    await ctx.db.patch(poll._id, {
      totalVotes: poll.totalVotes + 1,
      updatedAt: now,
    });

    const updatedPoll = await ctx.db.get(poll._id);
    if (updatedPoll === null) {
      throw new Error("Poll could not be reloaded");
    }
    return {
      voted: true,
      poll: await publicPollRecord(ctx, updatedPoll, thread, user._id),
    };
  },
});

export const updatePollContent = mutation({
  args: {
    pollId: v.id("forumPolls"),
    question: v.string(),
    options: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(ctx, "Sign in to edit this poll.");
    const poll = await ctx.db.get(args.pollId);
    if (poll === null) {
      throw forumError("POLL_NOT_FOUND", "That poll is not available.");
    }
    const thread = await ctx.db.get(poll.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    const category = await requireVisibleCategoryById(
      ctx,
      poll.categoryId,
      user,
    );
    const userCanModerateCategory = await canModerateCategory(
      ctx,
      user,
      category,
    );
    if (!canEditThread(user, thread, category, userCanModerateCategory)) {
      throw forumError(
        "UNAUTHORIZED",
        "You can only edit polls on threads you can edit.",
      );
    }
    if (poll.status !== "open") {
      throw forumError("POLL_CLOSED", "Closed polls cannot be edited.");
    }

    const normalized = normalizePollInput({
      question: args.question,
      options: args.options,
    });
    if (normalized === null) {
      throw forumError("INVALID_POLL", "Poll details are required.");
    }

    const existingOptions = await ctx.db
      .query("forumPollOptions")
      .withIndex("by_pollId_and_position", (q) => q.eq("pollId", poll._id))
      .take(POLL_MAX_OPTIONS);
    const existingVote = await ctx.db
      .query("forumPollVotes")
      .withIndex("by_pollId_and_userId", (q) => q.eq("pollId", poll._id))
      .take(1);
    if (
      poll.totalVotes > 0 ||
      existingVote.length > 0 ||
      existingOptions.some((option) => option.voteCount > 0)
    ) {
      throw forumError(
        "POLL_LOCKED",
        "Poll options cannot be edited after voting has started.",
      );
    }

    const currentLabels = existingOptions.map((option) => option.label);
    const unchanged =
      poll.question === normalized.question &&
      currentLabels.length === normalized.options.length &&
      currentLabels.every(
        (label, index) => label === normalized.options[index],
      );
    if (unchanged) {
      return {
        updated: false,
        poll: await publicPollRecord(
          ctx,
          poll,
          thread,
          user._id,
          canVoteInCategory(user, category, userCanModerateCategory),
          true,
        ),
      };
    }

    const now = Date.now();
    await ctx.db.patch(poll._id, {
      question: normalized.question,
      optionCount: normalized.options.length,
      updatedAt: now,
    });
    for (const option of existingOptions) {
      await ctx.db.delete(option._id);
    }
    for (const [position, label] of normalized.options.entries()) {
      await ctx.db.insert("forumPollOptions", {
        pollId: poll._id,
        threadId: thread._id,
        label,
        position,
        voteCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    const author = displayName(await ctx.db.get(thread.authorId));
    await ctx.db.patch(thread._id, {
      searchText: buildThreadSearchText(
        category,
        thread.title,
        threadSearchBodyWithPrefix(
          [thread.body, normalized.question, ...normalized.options].join("\n"),
          thread.prefixLabel,
        ),
        author,
      ),
      updatedAt: now,
    });

    const updatedPoll = await ctx.db.get(poll._id);
    if (updatedPoll === null) {
      throw new Error("Poll could not be reloaded");
    }
    return {
      updated: true,
      poll: await publicPollRecord(
        ctx,
        updatedPoll,
        thread,
        user._id,
        canVoteInCategory(user, category, userCanModerateCategory),
        true,
      ),
    };
  },
});

export const setForumReputation = mutation({
  args: {
    targetType: reputationTargetTypeValidator,
    threadId: v.id("forumThreads"),
    postId: v.optional(v.id("forumPosts")),
    score: reputationScoreValidator,
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(ctx, "Sign in to rate forum posts.");
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before rating posts.",
    );
    await assertForumParticipationAllowed(ctx, user, "rate forum posts");
    const thread = await ctx.db.get(args.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    const category = await requireVisibleCategoryById(
      ctx,
      thread.categoryId,
      user,
    );

    let targetAuthorId = thread.authorId;
    let targetKey = buildThreadReputationTargetKey(thread._id);
    let post: ForumPostDoc | null = null;

    if (args.targetType === "post") {
      if (args.postId === undefined) {
        throw forumError("POST_NOT_FOUND", "Choose a reply to rate.");
      }
      post = await ctx.db.get(args.postId);
      if (
        post === null ||
        post.threadId !== thread._id ||
        post.categoryId !== category._id ||
        post.status !== "active"
      ) {
        throw forumError("POST_NOT_FOUND", "That reply is not available.");
      }
      targetAuthorId = post.authorId;
      targetKey = buildPostReputationTargetKey(post._id);
    } else if (args.postId !== undefined) {
      throw forumError(
        "INVALID_REPUTATION_TARGET",
        "Thread ratings cannot include a reply id.",
      );
    }

    if (targetAuthorId === user._id) {
      throw forumError(
        "INVALID_REPUTATION_TARGET",
        "You cannot rate your own post.",
      );
    }

    const now = Date.now();
    const latestRatings = await ctx.db
      .query("forumReputations")
      .withIndex("by_fromUserId_and_updatedAt", (q) =>
        q.eq("fromUserId", user._id),
      )
      .order("desc")
      .take(1);
    const existing = await loadForumReputation(ctx, user._id, targetKey);
    if (
      latestRatings[0] !== undefined &&
      latestRatings[0]._id !== existing?._id &&
      now - latestRatings[0].updatedAt < REPUTATION_RATE_LIMIT_MS
    ) {
      throw forumError(
        "REPUTATION_RATE_LIMITED",
        "Give reputation a moment before rating another post.",
      );
    }

    const comment = cleanOptional(args.comment, REPUTATION_COMMENT_MAX_LENGTH);
    const previousScore = existing?.score ?? 0;
    const nextScore = args.score;

    if (existing === null && nextScore !== 0) {
      await ctx.db.insert("forumReputations", {
        fromUserId: user._id,
        toUserId: targetAuthorId,
        targetType: args.targetType,
        targetKey,
        threadId: thread._id,
        postId: post?._id,
        categoryId: category._id,
        score: nextScore,
        comment,
        createdAt: now,
        updatedAt: now,
      });
    } else if (existing !== null && nextScore === 0) {
      await ctx.db.delete(existing._id);
    } else if (existing !== null && nextScore !== 0) {
      await ctx.db.patch(existing._id, {
        score: nextScore,
        comment,
        updatedAt: now,
      });
    }

    const delta = nextScore - previousScore;
    const reputationScore =
      delta === 0
        ? await forumUserReputationScore(ctx, targetAuthorId)
        : await bumpForumUserProfileReputation(ctx, targetAuthorId, delta, now);

    return {
      targetType: args.targetType,
      threadId: thread._id,
      postId: post?._id,
      viewerScore: nextScore,
      reputationScore,
    };
  },
});

export const rateThread = mutation({
  args: {
    threadId: v.id("forumThreads"),
    score: v.union(threadRatingScoreValidator, v.null()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(ctx, "Sign in to rate this thread.");
    requireTrustedForumUser(
      user,
      "Ask the site owner to approve your forum access before rating threads.",
    );
    await assertForumParticipationAllowed(ctx, user, "rate threads");

    const thread = await ctx.db.get(args.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    const category = await requireVisibleCategoryById(
      ctx,
      thread.categoryId,
      user,
    );
    if (thread.authorId === user._id) {
      throw forumError(
        "INVALID_THREAD_RATING_TARGET",
        "You cannot rate your own thread.",
      );
    }

    const now = Date.now();
    const existing = await loadThreadRating(ctx, user._id, thread._id);
    const previousScore = existing?.score ?? 0;
    const nextStoredScore = args.score;
    const nextScore = nextStoredScore ?? 0;

    if (existing === null && nextStoredScore !== null) {
      await ctx.db.insert("forumThreadRatings", {
        userId: user._id,
        threadId: thread._id,
        categoryId: category._id,
        score: nextStoredScore,
        createdAt: now,
        updatedAt: now,
      });
    } else if (existing !== null && nextStoredScore === null) {
      await ctx.db.delete(existing._id);
    } else if (existing !== null && nextStoredScore !== null) {
      await ctx.db.patch(existing._id, {
        score: nextStoredScore,
        categoryId: category._id,
        updatedAt: now,
      });
    }

    const previousCount = thread.ratingCount ?? 0;
    const previousTotal = thread.ratingTotal ?? 0;
    const nextCount = Math.max(
      0,
      previousCount +
        (previousScore === 0 && nextScore > 0
          ? 1
          : previousScore > 0 && nextScore === 0
            ? -1
            : 0),
    );
    const nextTotal = Math.max(0, previousTotal - previousScore + nextScore);
    await ctx.db.patch(thread._id, {
      ratingCount: nextCount,
      ratingTotal: nextTotal,
    });

    return {
      threadId: thread._id,
      viewerRating: nextScore,
      ratingCount: nextCount,
      ratingAverage: ratingAverage(nextCount, nextTotal),
    };
  },
});

export const updateThreadContent = mutation({
  args: {
    threadId: v.id("forumThreads"),
    prefixId: v.optional(v.union(v.id("forumThreadPrefixes"), v.null())),
    title: v.string(),
    body: v.string(),
    attachments: v.optional(v.array(attachmentInputValidator)),
    attachmentIdsToKeep: v.optional(v.array(v.id("forumAttachments"))),
    editReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(ctx, "Sign in to edit this thread.");
    const thread = await ctx.db.get(args.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    const category = await requireVisibleCategoryById(
      ctx,
      thread.categoryId,
      user,
    );
    const userCanModerateCategory = await canModerateCategory(
      ctx,
      user,
      category,
    );
    if (!canEditThread(user, thread, category, userCanModerateCategory)) {
      throw forumError("UNAUTHORIZED", "You cannot edit this thread.");
    }
    if (!userCanModerateCategory) {
      await assertForumParticipationAllowed(ctx, user, "edit forum threads");
    }

    const title = normalizeTitle(args.title);
    const body = normalizeThreadBody(args.body);
    const editReason = cleanOptional(args.editReason, EDIT_REASON_MAX_LENGTH);
    const nextPrefixSnapshot =
      args.prefixId === undefined
        ? threadPrefixSnapshotFromThread(thread)
        : threadPrefixSnapshot(
            await resolveThreadPrefixForCategory(ctx, args.prefixId, category),
          );
    const prefixChanged = hasThreadPrefixSnapshotChanged(
      thread,
      nextPrefixSnapshot,
    );
    const attachmentEditPlan = await planForumAttachmentEdit(ctx, {
      threadId: thread._id,
      postId: undefined,
      userId: user._id,
      attachments: args.attachments,
      attachmentIdsToKeep: args.attachmentIdsToKeep,
    });
    if (
      title === thread.title &&
      body === thread.body &&
      !prefixChanged &&
      attachmentEditPlan?.changed !== true
    ) {
      const author = displayName(await ctx.db.get(thread.authorId));
      const lastPostAuthor = displayName(
        await ctx.db.get(thread.lastPostUserId),
      );
      const lastEditedByName =
        thread.lastEditedBy === undefined
          ? undefined
          : displayName(await ctx.db.get(thread.lastEditedBy));
      const attachments = await hydrateForumAttachments(
        ctx,
        attachmentEditPlan?.currentAttachments ??
          (await loadActiveForumAttachmentsForPost(ctx, thread._id, undefined)),
      );
      return {
        updated: false,
        thread: publicThreadDetailRecord(thread, author, lastPostAuthor, {
          viewerCanReply:
            thread.status === "active" &&
            canReplyInCategory(user, category, userCanModerateCategory),
          viewerCanModerate: userCanModerateCategory,
          viewerCanEdit: canEditThread(
            user,
            thread,
            category,
            userCanModerateCategory,
          ),
          viewerCanDelete: canDeleteThread(
            user,
            thread,
            category,
            userCanModerateCategory,
          ),
          lastEditedByName,
          attachments,
        }),
      };
    }

    const now = Date.now();
    const threadAuthorName = displayName(await ctx.db.get(thread.authorId));
    await recordForumContentEdit(ctx, {
      entityType: "thread",
      threadId: thread._id,
      actorUserId: user._id,
      targetUserId: thread.authorId,
      previousTitle: thread.title,
      nextTitle: title,
      previousPrefixId: thread.prefixId,
      nextPrefixId: nextPrefixSnapshot.prefixId,
      previousPrefixLabel: thread.prefixLabel,
      nextPrefixLabel: nextPrefixSnapshot.prefixLabel,
      previousBody: thread.body,
      nextBody: body,
      editReason,
      createdAt: now,
    });
    await ctx.db.patch(thread._id, {
      ...nextPrefixSnapshot,
      title,
      body,
      searchText: buildThreadSearchText(
        category,
        title,
        threadSearchBodyWithPrefix(body, nextPrefixSnapshot.prefixLabel),
        threadAuthorName,
      ),
      updatedAt: now,
      lastEditedAt: now,
      lastEditedBy: user._id,
      editCount: (thread.editCount ?? 0) + 1,
      lastEditReason: editReason,
    });
    if (attachmentEditPlan !== null) {
      await applyForumAttachmentEditPlan(ctx, {
        plan: attachmentEditPlan,
        actorUserId: user._id,
        authorId: user._id,
        categoryId: category._id,
        threadId: thread._id,
        postId: undefined,
        now,
      });
    }

    const updated = await ctx.db.get(thread._id);
    if (updated === null) {
      throw new Error("Thread could not be reloaded");
    }
    const author = threadAuthorName;
    const lastPostAuthor = displayName(
      await ctx.db.get(updated.lastPostUserId),
    );
    const attachments = await hydrateForumAttachments(
      ctx,
      await loadActiveForumAttachmentsForPost(ctx, updated._id, undefined),
    );
    return {
      updated: true,
      thread: publicThreadDetailRecord(updated, author, lastPostAuthor, {
        viewerCanReply:
          updated.status === "active" &&
          canReplyInCategory(user, category, userCanModerateCategory),
        viewerCanModerate: userCanModerateCategory,
        viewerCanEdit: canEditThread(
          user,
          updated,
          category,
          userCanModerateCategory,
        ),
        viewerCanDelete: canDeleteThread(
          user,
          updated,
          category,
          userCanModerateCategory,
        ),
        lastEditedByName: displayName(user),
        attachments,
      }),
    };
  },
});

export const updatePostContent = mutation({
  args: {
    postId: v.id("forumPosts"),
    body: v.string(),
    attachments: v.optional(v.array(attachmentInputValidator)),
    attachmentIdsToKeep: v.optional(v.array(v.id("forumAttachments"))),
    editReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(ctx, "Sign in to edit this reply.");
    const post = await ctx.db.get(args.postId);
    if (post === null || post.status !== "active") {
      throw forumError("POST_NOT_FOUND", "That reply is not available.");
    }
    const thread = await ctx.db.get(post.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    const category = await requireVisibleCategoryById(
      ctx,
      thread.categoryId,
      user,
    );
    const userCanModerateCategory = await canModerateCategory(
      ctx,
      user,
      category,
    );
    if (!canEditPost(user, post, thread, category, userCanModerateCategory)) {
      throw forumError("UNAUTHORIZED", "You cannot edit this reply.");
    }
    if (!userCanModerateCategory) {
      await assertForumParticipationAllowed(ctx, user, "edit forum replies");
    }

    const body = normalizeReplyBody(args.body);
    const editReason = cleanOptional(args.editReason, EDIT_REASON_MAX_LENGTH);
    const attachmentEditPlan = await planForumAttachmentEdit(ctx, {
      threadId: thread._id,
      postId: post._id,
      userId: user._id,
      attachments: args.attachments,
      attachmentIdsToKeep: args.attachmentIdsToKeep,
    });
    if (body === post.body && attachmentEditPlan?.changed !== true) {
      const lastEditedByName =
        post.lastEditedBy === undefined
          ? undefined
          : displayName(await ctx.db.get(post.lastEditedBy));
      const attachments = await hydrateForumAttachments(
        ctx,
        attachmentEditPlan?.currentAttachments ??
          (await loadActiveForumAttachmentsForPost(ctx, thread._id, post._id)),
      );
      return {
        updated: false,
        post: publicPostRecord(
          post,
          displayName(await ctx.db.get(post.authorId)),
          {
            viewerCanEdit: true,
            viewerCanDelete: canDeletePost(
              user,
              post,
              thread,
              category,
              userCanModerateCategory,
            ),
            lastEditedByName,
            attachments,
          },
        ),
      };
    }

    const now = Date.now();
    await recordForumContentEdit(ctx, {
      entityType: "post",
      threadId: thread._id,
      postId: post._id,
      actorUserId: user._id,
      targetUserId: post.authorId,
      previousBody: post.body,
      nextBody: body,
      editReason,
      createdAt: now,
    });
    await ctx.db.patch(post._id, {
      body,
      updatedAt: now,
      lastEditedAt: now,
      lastEditedBy: user._id,
      editCount: (post.editCount ?? 0) + 1,
      lastEditReason: editReason,
    });
    if (attachmentEditPlan !== null) {
      await applyForumAttachmentEditPlan(ctx, {
        plan: attachmentEditPlan,
        actorUserId: user._id,
        authorId: user._id,
        categoryId: category._id,
        threadId: thread._id,
        postId: post._id,
        now,
      });
    }
    const updated = await ctx.db.get(post._id);
    if (updated === null) {
      throw new Error("Post could not be reloaded");
    }
    const attachments = await hydrateForumAttachments(
      ctx,
      await loadActiveForumAttachmentsForPost(ctx, thread._id, updated._id),
    );
    return {
      updated: true,
      post: publicPostRecord(updated, displayName(user), {
        viewerCanEdit: true,
        viewerCanDelete: canDeletePost(
          user,
          updated,
          thread,
          category,
          userCanModerateCategory,
        ),
        lastEditedByName: displayName(user),
        attachments,
      }),
    };
  },
});

export const deleteThread = mutation({
  args: {
    threadId: v.id("forumThreads"),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to delete this thread.",
    );
    const thread = await ctx.db.get(args.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    const category = await requireVisibleCategoryById(
      ctx,
      thread.categoryId,
      user,
    );
    const userCanModerateCategory = await canModerateCategory(
      ctx,
      user,
      category,
    );
    if (!canDeleteThread(user, thread, category, userCanModerateCategory)) {
      throw forumError(
        "UNAUTHORIZED",
        thread.replyCount > 0
          ? "Only moderators can delete a thread after replies land."
          : "You cannot delete this thread.",
      );
    }
    if (!userCanModerateCategory) {
      await assertForumParticipationAllowed(ctx, user, "delete forum threads");
    }

    const now = Date.now();
    const visibilityProfileDeltaToken = forumVisibilityProfileDeltaToken(
      thread._id,
      false,
      now,
    );
    await ctx.db.patch(thread._id, {
      status: "deleted",
      deletedAt: now,
      deletedBy: user._id,
      updatedAt: now,
      visibilityProfileDeltaToken,
    });
    await ctx.db.patch(category._id, {
      threadCount: Math.max(0, category.threadCount - 1),
      postCount: Math.max(0, category.postCount - (1 + thread.replyCount)),
      updatedAt: now,
    });
    await applyThreadVisibilityProfileDeltas(ctx, thread, {
      isVisible: false,
      now,
      token: visibilityProfileDeltaToken,
    });
    await recomputeCategorySummary(ctx, category._id);
    await recordModerationLog(ctx, {
      actorUserId: user._id,
      entityType: "forumThread",
      entityId: thread._id,
      eventType: "forum_thread_deleted",
      message: "Forum thread deleted",
      categoryId: category._id,
      threadId: thread._id,
      metadata: {
        categoryId: category._id,
        previousStatus: thread.status,
        nextStatus: "deleted",
        replyCount: thread.replyCount,
        actorWasModerator: userCanModerateCategory,
      },
    });
    return { deleted: true, categorySlug: category.slug };
  },
});

export const deletePost = mutation({
  args: {
    postId: v.id("forumPosts"),
  },
  handler: async (ctx, args) => {
    const user = await requireSignedInUser(
      ctx,
      "Sign in to delete this reply.",
    );
    const post = await ctx.db.get(args.postId);
    if (post === null || post.status !== "active") {
      throw forumError("POST_NOT_FOUND", "That reply is not available.");
    }
    const thread = await ctx.db.get(post.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    const category = await requireVisibleCategoryById(
      ctx,
      thread.categoryId,
      user,
    );
    const userCanModerateCategory = await canModerateCategory(
      ctx,
      user,
      category,
    );
    if (!canDeletePost(user, post, thread, category, userCanModerateCategory)) {
      throw forumError("UNAUTHORIZED", "You cannot delete this reply.");
    }
    if (!userCanModerateCategory) {
      await assertForumParticipationAllowed(ctx, user, "delete forum replies");
    }

    const now = Date.now();
    await ctx.db.patch(post._id, {
      status: "deleted",
      deletedAt: now,
      deletedBy: user._id,
      updatedAt: now,
    });
    await ctx.db.patch(thread._id, {
      replyCount: Math.max(0, thread.replyCount - 1),
      updatedAt: now,
    });
    await recomputeThreadActivity(ctx, thread._id);
    await ctx.db.patch(category._id, {
      postCount: Math.max(0, category.postCount - 1),
      updatedAt: now,
    });
    await bumpForumUserProfileStats(ctx, post.authorId, {
      postDelta: -1,
      now,
    });
    if (
      category.lastThreadId === thread._id ||
      category.lastPostId === post._id
    ) {
      await recomputeCategorySummary(ctx, category._id);
    }
    await recordModerationLog(ctx, {
      actorUserId: user._id,
      entityType: "forumPost",
      entityId: post._id,
      eventType: "forum_post_deleted",
      message: "Forum reply deleted",
      categoryId: category._id,
      threadId: thread._id,
      postId: post._id,
      metadata: {
        categoryId: category._id,
        threadId: thread._id,
        previousStatus: post.status,
        nextStatus: "deleted",
        actorWasModerator: userCanModerateCategory,
      },
    });
    return { deleted: true, threadId: thread._id };
  },
});

export const createReport = mutation({
  args: {
    entityType: contentReportEntityTypeValidator,
    threadId: v.id("forumThreads"),
    postId: v.optional(v.id("forumPosts")),
    reason: v.string(),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const reporter = await requireSignedInUser(
      ctx,
      "Sign in to report forum content.",
    );
    await assertForumParticipationAllowed(
      ctx,
      reporter,
      "report forum content",
    );
    const thread = await ctx.db.get(args.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    const category = await requireVisibleCategoryById(
      ctx,
      thread.categoryId,
      reporter,
    );

    let post: ForumPostDoc | null = null;
    if (args.entityType === "post") {
      if (args.postId === undefined) {
        throw forumError("INVALID_REPORT", "Choose a post to report.");
      }
      post = await ctx.db.get(args.postId);
      if (
        post === null ||
        post.threadId !== thread._id ||
        post.status !== "active"
      ) {
        throw forumError("POST_NOT_FOUND", "That reply is not available.");
      }
    }

    const reason = cleanRequired(
      args.reason,
      REPORT_REASON_MIN_LENGTH,
      REPORT_REASON_MAX_LENGTH,
      "Report reason",
    );
    const details = cleanOptional(args.details, REPORT_DETAILS_MAX_LENGTH);
    const now = Date.now();
    const openReports = await ctx.db
      .query("forumReports")
      .withIndex("by_reporterId_and_status_and_createdAt", (q) =>
        q.eq("reporterId", reporter._id).eq("status", "open"),
      )
      .order("desc")
      .take(REPORT_OPEN_LIMIT);
    const duplicateCandidates = await ctx.db
      .query("forumReports")
      .withIndex("by_reporterId_and_entityType_and_threadId_and_status", (q) =>
        q
          .eq("reporterId", reporter._id)
          .eq("entityType", args.entityType)
          .eq("threadId", thread._id)
          .eq("status", "open"),
      )
      .take(REPORT_OPEN_LIMIT);
    const duplicate = duplicateCandidates.find(
      (report) =>
        report.postId === (post?._id ?? undefined) &&
        now - report.createdAt < REPORT_DUPLICATE_WINDOW_MS,
    );
    if (duplicate !== undefined) {
      return { reportId: duplicate._id, created: false };
    }
    if (openReports.length >= REPORT_OPEN_LIMIT) {
      throw forumError(
        "REPORT_LIMIT_REACHED",
        "Wait for existing reports to be reviewed before opening more.",
      );
    }

    const recentReports = await ctx.db
      .query("forumReports")
      .withIndex("by_reporterId_and_createdAt", (q) =>
        q.eq("reporterId", reporter._id),
      )
      .order("desc")
      .take(1);
    if (
      recentReports[0] !== undefined &&
      now - recentReports[0].createdAt < REPORT_RATE_LIMIT_MS
    ) {
      throw forumError(
        "REPORT_RATE_LIMITED",
        "Wait a minute before sending another report.",
      );
    }

    const snapshotAuthorId = post?.authorId ?? thread.authorId;
    const snapshotAuthor = await ctx.db.get(snapshotAuthorId);
    const snapshotBody = post?.body ?? thread.body;
    const reportId = await ctx.db.insert("forumReports", {
      reporterId: reporter._id,
      entityType: args.entityType,
      threadId: thread._id,
      postId: post?._id,
      categoryId: category._id,
      snapshotTitle: thread.title,
      snapshotPrefixSlug: thread.prefixSlug,
      snapshotPrefixLabel: thread.prefixLabel,
      snapshotPrefixColor: thread.prefixColor,
      snapshotBody,
      snapshotAuthorId,
      snapshotAuthorName: displayName(snapshotAuthor),
      snapshotPostNumber: post?.postNumber,
      snapshotCreatedAt: post?.createdAt ?? thread.createdAt,
      reason,
      details,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    await recordModerationLog(ctx, {
      actorUserId: reporter._id,
      entityType: "forumReport",
      entityId: reportId,
      eventType: "forum_report_created",
      message: "Forum content reported",
      fingerprint: `forum_report_created:${reporter._id}:${args.entityType}:${thread._id}:${post?._id ?? "thread"}`,
      categoryId: category._id,
      threadId: thread._id,
      postId: post?._id,
      reportId,
      metadata: {
        categoryId: category._id,
        threadId: thread._id,
        postId: post?._id ?? null,
        reportEntityType: args.entityType,
      },
    });

    return { reportId, created: true };
  },
});

export const createPrivateMessageReport = mutation({
  args: {
    messageId: v.id("forumPrivateMessages"),
    reason: v.string(),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const reporter = await requireSignedInUser(
      ctx,
      "Sign in to report private messages.",
    );
    requireTrustedForumUser(
      reporter,
      "Ask the site owner to approve your forum access before reporting private messages.",
    );
    await assertForumParticipationAllowed(
      ctx,
      reporter,
      "report private messages",
    );

    const message = await ctx.db.get(args.messageId);
    if (
      message === null ||
      message.recipientUserId !== reporter._id ||
      message.recipientDeletedAt !== undefined
    ) {
      throw forumError(
        "PRIVATE_MESSAGE_NOT_FOUND",
        "That private message is not available.",
      );
    }

    const reason = cleanRequired(
      args.reason,
      REPORT_REASON_MIN_LENGTH,
      REPORT_REASON_MAX_LENGTH,
      "Report reason",
    );
    const details = cleanOptional(args.details, REPORT_DETAILS_MAX_LENGTH);
    const now = Date.now();
    const openReports = await ctx.db
      .query("forumReports")
      .withIndex("by_reporterId_and_status_and_createdAt", (q) =>
        q.eq("reporterId", reporter._id).eq("status", "open"),
      )
      .order("desc")
      .take(REPORT_OPEN_LIMIT);
    const duplicateCandidates = await ctx.db
      .query("forumReports")
      .withIndex("by_reporterId_and_entityType_and_messageId_and_status", (q) =>
        q
          .eq("reporterId", reporter._id)
          .eq("entityType", "privateMessage")
          .eq("messageId", message._id)
          .eq("status", "open"),
      )
      .take(REPORT_OPEN_LIMIT);
    const duplicate = duplicateCandidates.find(
      (report) => now - report.createdAt < REPORT_DUPLICATE_WINDOW_MS,
    );
    if (duplicate !== undefined) {
      return { reportId: duplicate._id, created: false };
    }
    if (openReports.length >= REPORT_OPEN_LIMIT) {
      throw forumError(
        "REPORT_LIMIT_REACHED",
        "Wait for existing reports to be reviewed before opening more.",
      );
    }

    const recentReports = await ctx.db
      .query("forumReports")
      .withIndex("by_reporterId_and_createdAt", (q) =>
        q.eq("reporterId", reporter._id),
      )
      .order("desc")
      .take(1);
    if (
      recentReports[0] !== undefined &&
      now - recentReports[0].createdAt < REPORT_RATE_LIMIT_MS
    ) {
      throw forumError(
        "REPORT_RATE_LIMITED",
        "Wait a minute before sending another report.",
      );
    }

    const sender = await ctx.db.get(message.senderUserId);
    const reportId = await ctx.db.insert("forumReports", {
      reporterId: reporter._id,
      entityType: "privateMessage",
      messageId: message._id,
      snapshotTitle: message.subject,
      snapshotBody: message.body,
      snapshotAuthorId: message.senderUserId,
      snapshotAuthorName: displayName(sender),
      snapshotCreatedAt: message.createdAt,
      reason,
      details,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    await recordModerationLog(ctx, {
      actorUserId: reporter._id,
      entityType: "forumReport",
      entityId: reportId,
      eventType: "forum_report_created",
      message: "Forum private message reported",
      reportId,
      metadata: {
        reporterId: reporter._id,
        messageId: message._id,
        targetUserId: message.senderUserId,
        reportEntityType: "privateMessage",
      },
    });

    return { reportId, created: true };
  },
});

export const listCategoriesAdmin = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireForumAdmin(ctx);

    const categories = args.includeArchived
      ? await ctx.db.query("forumCategories").withIndex("by_position").take(100)
      : await ctx.db
          .query("forumCategories")
          .withIndex("by_status_and_position", (q) => q.eq("status", "active"))
          .take(100);

    const lastThreadsById = await loadThreadsById(
      ctx,
      categories.flatMap((category) =>
        category.lastThreadId === undefined ? [] : [category.lastThreadId],
      ),
    );
    const moderatorsByCategoryId =
      await loadCategoryModeratorSummariesByCategoryId(
        ctx,
        categories.map((category) => category._id),
      );

    return categories.map((category) =>
      adminCategoryRecord(
        category,
        category.lastThreadId === undefined
          ? undefined
          : lastThreadsById.get(category.lastThreadId),
        moderatorsByCategoryId.get(category._id) ?? [],
      ),
    );
  },
});

export const listCategoryModeratorsAdmin = query({
  args: {
    categoryId: v.optional(v.id("forumCategories")),
  },
  handler: async (ctx, args) => {
    await requireForumAdmin(ctx);
    const assignments =
      args.categoryId === undefined
        ? await ctx.db
            .query("forumCategoryModerators")
            .withIndex("by_categoryId")
            .take(200)
        : await ctx.db
            .query("forumCategoryModerators")
            .withIndex("by_categoryId", (q) =>
              q.eq("categoryId", args.categoryId!),
            )
            .take(100);
    return await hydrateCategoryModeratorRecords(ctx, assignments);
  },
});

export const assignCategoryModerator = mutation({
  args: {
    categoryId: v.id("forumCategories"),
    username: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireForumAdmin(ctx);
    const category = await ctx.db.get(args.categoryId);
    if (category === null || !isBoardCategory(category)) {
      throw forumError(
        "CATEGORY_NOT_FOUND",
        "Choose an active forum board before assigning a moderator.",
      );
    }
    const username = normalizeRequiredForumUsername(args.username);
    const target = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", username),
      )
      .unique();
    if (target === null || target.usernameNormalized === undefined) {
      throw forumError(
        "FORUM_MEMBER_NOT_FOUND",
        "That forum member could not be found.",
      );
    }
    if (!isActiveForumAccount(target)) {
      throw forumError(
        "FORUM_MEMBER_RESTRICTED",
        "Restricted forum members cannot be assigned as board moderators.",
      );
    }

    const existing = await ctx.db
      .query("forumCategoryModerators")
      .withIndex("by_categoryId_and_userId", (q) =>
        q.eq("categoryId", category._id).eq("userId", target._id),
      )
      .unique();
    if (existing !== null) {
      return {
        assigned: false,
        moderator: (await hydrateCategoryModeratorRecords(ctx, [existing]))[0],
        category: adminCategoryRecord(
          category,
          undefined,
          await loadCategoryModeratorSummaries(ctx, category._id),
        ),
      };
    }

    const now = Date.now();
    const moderatorId = await ctx.db.insert("forumCategoryModerators", {
      categoryId: category._id,
      userId: target._id,
      assignedBy: actor._id,
      createdAt: now,
      updatedAt: now,
    });

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumCategoryModerator",
      entityId: moderatorId,
      eventType: "forum_category_moderator_assigned",
      message: "Forum board moderator assigned",
      categoryId: category._id,
      metadata: {
        categoryId: category._id,
        categorySlug: category.slug,
        moderatorUserId: target._id,
        moderator: displayName(target),
      },
    });

    const moderator = await ctx.db.get(moderatorId);
    if (moderator === null) {
      throw new Error("Category moderator assignment could not be reloaded");
    }

    return {
      assigned: true,
      moderator: (await hydrateCategoryModeratorRecords(ctx, [moderator]))[0],
      category: adminCategoryRecord(
        category,
        undefined,
        await loadCategoryModeratorSummaries(ctx, category._id),
      ),
    };
  },
});

export const removeCategoryModerator = mutation({
  args: {
    moderatorId: v.id("forumCategoryModerators"),
  },
  handler: async (ctx, args) => {
    const actor = await requireForumAdmin(ctx);
    const assignment = await ctx.db.get(args.moderatorId);
    if (assignment === null) {
      throw forumError(
        "CATEGORY_MODERATOR_NOT_FOUND",
        "That board moderator assignment no longer exists.",
      );
    }
    const [category, target] = await Promise.all([
      ctx.db.get(assignment.categoryId),
      ctx.db.get(assignment.userId),
    ]);
    await ctx.db.delete(assignment._id);

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumCategoryModerator",
      entityId: assignment._id,
      eventType: "forum_category_moderator_removed",
      message: "Forum board moderator removed",
      categoryId: assignment.categoryId,
      metadata: {
        categoryId: assignment.categoryId,
        categorySlug: category?.slug ?? null,
        moderatorUserId: assignment.userId,
        moderator: displayName(target),
      },
    });

    return {
      removed: true,
      category:
        category === null
          ? null
          : adminCategoryRecord(
              category,
              undefined,
              await loadCategoryModeratorSummaries(ctx, category._id),
            ),
    };
  },
});

export const listThreadPrefixesAdmin = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    categoryId: v.optional(v.id("forumCategories")),
  },
  handler: async (ctx, args) => {
    await requireForumAdmin(ctx);

    const visiblePrefixes =
      args.categoryId === undefined
        ? args.includeArchived
          ? await ctx.db
              .query("forumThreadPrefixes")
              .withIndex("by_position")
              .take(THREAD_PREFIX_LIST_LIMIT)
          : await ctx.db
              .query("forumThreadPrefixes")
              .withIndex("by_status_and_position", (q) =>
                q.eq("status", "active"),
              )
              .take(THREAD_PREFIX_LIST_LIMIT)
        : args.includeArchived
          ? await ctx.db
              .query("forumThreadPrefixes")
              .withIndex("by_categoryId_and_position", (q) =>
                q.eq("categoryId", args.categoryId!),
              )
              .take(THREAD_PREFIX_LIST_LIMIT)
          : await ctx.db
              .query("forumThreadPrefixes")
              .withIndex("by_categoryId_and_status_and_position", (q) =>
                q.eq("categoryId", args.categoryId!).eq("status", "active"),
              )
              .take(THREAD_PREFIX_LIST_LIMIT);
    const categoriesById = await loadCategoriesById(
      ctx,
      visiblePrefixes.flatMap((prefix) =>
        prefix.categoryId === undefined ? [] : [prefix.categoryId],
      ),
    );

    return visiblePrefixes.map((prefix) =>
      adminThreadPrefixRecord(
        prefix,
        prefix.categoryId === undefined
          ? undefined
          : categoriesById.get(prefix.categoryId),
      ),
    );
  },
});

export const listAnnouncementsAdmin = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    categoryId: v.optional(v.id("forumCategories")),
  },
  handler: async (ctx, args) => {
    await requireForumAdmin(ctx);

    const rows =
      args.categoryId === undefined
        ? args.includeArchived
          ? await ctx.db
              .query("forumAnnouncements")
              .withIndex("by_position")
              .take(FORUM_ANNOUNCEMENT_LIST_LIMIT)
          : await ctx.db
              .query("forumAnnouncements")
              .withIndex("by_status_and_position", (q) =>
                q.eq("status", "active"),
              )
              .take(FORUM_ANNOUNCEMENT_LIST_LIMIT)
        : args.includeArchived
          ? await ctx.db
              .query("forumAnnouncements")
              .withIndex("by_categoryId_and_position", (q) =>
                q.eq("categoryId", args.categoryId!),
              )
              .take(FORUM_ANNOUNCEMENT_LIST_LIMIT)
          : await ctx.db
              .query("forumAnnouncements")
              .withIndex("by_categoryId_and_status_and_position", (q) =>
                q.eq("categoryId", args.categoryId!).eq("status", "active"),
              )
              .take(FORUM_ANNOUNCEMENT_LIST_LIMIT);
    const [categoriesById, actorsById] = await Promise.all([
      loadCategoriesById(
        ctx,
        rows.flatMap((row) =>
          row.categoryId === undefined ? [] : [row.categoryId],
        ),
      ),
      loadUserNamesById(ctx, [
        ...rows.map((row) => row.createdBy),
        ...rows.map((row) => row.updatedBy),
      ]),
    ]);

    return rows.map((row) =>
      adminForumAnnouncementRecord(
        row,
        row.categoryId === undefined
          ? undefined
          : categoriesById.get(row.categoryId),
        actorsById.get(row.createdBy),
        actorsById.get(row.updatedBy),
      ),
    );
  },
});

export const listHelpDocumentsAdmin = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireForumAdmin(ctx);

    const rows =
      args.includeArchived === true
        ? await ctx.db
            .query("forumHelpDocuments")
            .withIndex("by_position_and_title")
            .take(FORUM_HELP_DOCUMENT_LIST_LIMIT)
        : await ctx.db
            .query("forumHelpDocuments")
            .withIndex("by_status_and_position_and_title", (q) =>
              q.eq("status", "active"),
            )
            .take(FORUM_HELP_DOCUMENT_LIST_LIMIT);
    const actorsById = await loadUserNamesById(ctx, [
      ...rows.map((row) => row.createdBy),
      ...rows.map((row) => row.updatedBy),
    ]);

    return rows.map((row) =>
      adminForumHelpDocumentRecord(
        row,
        actorsById.get(row.createdBy),
        actorsById.get(row.updatedBy),
      ),
    );
  },
});

export const listCalendarEventsAdmin = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    month: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireForumAdmin(ctx);

    const month =
      args.month === undefined
        ? undefined
        : normalizeForumCalendarMonth(args.month);
    const rows =
      month === undefined
        ? args.includeArchived === true
          ? await ctx.db
              .query("forumCalendarEvents")
              .withIndex("by_startsAt_and_title")
              .order("desc")
              .take(FORUM_CALENDAR_EVENT_LIST_LIMIT)
          : await ctx.db
              .query("forumCalendarEvents")
              .withIndex("by_status_and_startsAt_and_title", (q) =>
                q.eq("status", "active"),
              )
              .order("desc")
              .take(FORUM_CALENDAR_EVENT_LIST_LIMIT)
        : args.includeArchived === true
          ? await ctx.db
              .query("forumCalendarEvents")
              .withIndex("by_month_and_startsAt_and_title", (q) =>
                q.eq("month", month),
              )
              .take(FORUM_CALENDAR_EVENT_LIST_LIMIT)
          : await ctx.db
              .query("forumCalendarEvents")
              .withIndex("by_status_and_month_and_startsAt_and_title", (q) =>
                q.eq("status", "active").eq("month", month),
              )
              .take(FORUM_CALENDAR_EVENT_LIST_LIMIT);
    const actorsById = await loadUserNamesById(ctx, [
      ...rows.map((row) => row.createdBy),
      ...rows.map((row) => row.updatedBy),
    ]);

    return rows.map((row) =>
      adminForumCalendarEventRecord(
        row,
        actorsById.get(row.createdBy),
        actorsById.get(row.updatedBy),
      ),
    );
  },
});

export const listBoardRulesAdmin = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    categoryId: v.optional(v.id("forumCategories")),
  },
  handler: async (ctx, args) => {
    await requireForumAdmin(ctx);

    const rows =
      args.categoryId === undefined
        ? args.includeArchived
          ? await ctx.db
              .query("forumBoardRules")
              .withIndex("by_updatedAt")
              .order("desc")
              .take(FORUM_BOARD_RULES_LIST_LIMIT)
          : await ctx.db
              .query("forumBoardRules")
              .withIndex("by_status_and_updatedAt", (q) =>
                q.eq("status", "active"),
              )
              .order("desc")
              .take(FORUM_BOARD_RULES_LIST_LIMIT)
        : args.includeArchived
          ? await ctx.db
              .query("forumBoardRules")
              .withIndex("by_categoryId_and_updatedAt", (q) =>
                q.eq("categoryId", args.categoryId!),
              )
              .order("desc")
              .take(FORUM_BOARD_RULES_LIST_LIMIT)
          : await ctx.db
              .query("forumBoardRules")
              .withIndex("by_categoryId_and_status_and_updatedAt", (q) =>
                q.eq("categoryId", args.categoryId!).eq("status", "active"),
              )
              .order("desc")
              .take(FORUM_BOARD_RULES_LIST_LIMIT);
    const [categoriesById, actorsById] = await Promise.all([
      loadCategoriesById(
        ctx,
        rows.map((row) => row.categoryId),
      ),
      loadUserNamesById(ctx, [
        ...rows.map((row) => row.createdBy),
        ...rows.map((row) => row.updatedBy),
      ]),
    ]);

    return rows.map((row) =>
      adminForumBoardRulesRecord(
        row,
        categoriesById.get(row.categoryId),
        actorsById.get(row.createdBy),
        actorsById.get(row.updatedBy),
      ),
    );
  },
});

export const adminOverview = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireAnyForumModerator(ctx);
    const scopedCategoryIds = canModerate(actor)
      ? null
      : await loadModeratedCategoryIdsForUser(ctx, actor._id);
    const categoryRows = await ctx.db
      .query("forumCategories")
      .withIndex("by_position")
      .take(100);
    const categories =
      scopedCategoryIds === null
        ? categoryRows
        : categoryRows.filter((category) =>
            includesCategoryId(scopedCategoryIds, category._id),
          );
    const loadThreads = async (
      status: ForumThreadDoc["status"] | undefined,
      limit: number,
    ) => {
      if (scopedCategoryIds === null) {
        return status === undefined
          ? await ctx.db
              .query("forumThreads")
              .withIndex("by_lastPostAt")
              .order("desc")
              .take(limit)
          : await ctx.db
              .query("forumThreads")
              .withIndex("by_status_and_lastPostAt", (q) =>
                q.eq("status", status),
              )
              .order("desc")
              .take(limit);
      }
      if (scopedCategoryIds.length === 0) {
        return [];
      }
      return (
        await Promise.all(
          scopedCategoryIds.map((categoryId) =>
            status === undefined
              ? ctx.db
                  .query("forumThreads")
                  .withIndex("by_categoryId_and_lastPostAt", (q) =>
                    q.eq("categoryId", categoryId),
                  )
                  .order("desc")
                  .take(limit)
              : ctx.db
                  .query("forumThreads")
                  .withIndex("by_categoryId_and_status_and_lastPostAt", (q) =>
                    q.eq("categoryId", categoryId).eq("status", status),
                  )
                  .order("desc")
                  .take(limit),
          ),
        )
      )
        .flatMap((rows) => rows)
        .sort((left, right) => right.lastPostAt - left.lastPostAt)
        .slice(0, limit);
    };
    const loadPosts = async (status: ForumPostDoc["status"], limit: number) => {
      if (scopedCategoryIds === null) {
        return await ctx.db
          .query("forumPosts")
          .withIndex("by_status_and_createdAt", (q) => q.eq("status", status))
          .order("desc")
          .take(limit);
      }
      if (scopedCategoryIds.length === 0) {
        return [];
      }
      return (
        await Promise.all(
          scopedCategoryIds.map((categoryId) =>
            ctx.db
              .query("forumPosts")
              .withIndex("by_categoryId_and_status_and_createdAt", (q) =>
                q.eq("categoryId", categoryId).eq("status", status),
              )
              .order("desc")
              .take(limit),
          ),
        )
      )
        .flatMap((rows) => rows)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, limit);
    };

    const [
      recentThreads,
      pendingThreads,
      hiddenThreads,
      lockedThreads,
      pendingPosts,
      activePosts,
      hiddenPosts,
      deletedPosts,
    ] = await Promise.all([
      loadThreads(undefined, THREAD_ADMIN_LIST_LIMIT),
      loadThreads("pending", 100),
      loadThreads("hidden", 100),
      loadThreads("locked", 100),
      loadPosts("pending", SEARCH_RESULT_LIMIT),
      loadPosts("active", SEARCH_RESULT_LIMIT),
      loadPosts("hidden", SEARCH_RESULT_LIMIT),
      loadPosts("deleted", SEARCH_RESULT_LIMIT),
    ]);

    const recentPosts = [
      ...pendingPosts,
      ...activePosts,
      ...hiddenPosts,
      ...deletedPosts,
    ]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, SEARCH_RESULT_LIMIT);
    const threadsById = await loadThreadsById(
      ctx,
      recentPosts.map((post) => post.threadId),
    );
    const categoryIds = [
      ...categories.map((category) => category._id),
      ...recentThreads.map((thread) => thread.categoryId),
      ...Array.from(threadsById.values()).map((thread) => thread.categoryId),
    ];
    const categoriesById = await loadCategoriesById(ctx, categoryIds);
    const authorsById = await loadUserNamesById(ctx, [
      ...recentThreads.map((thread) => thread.authorId),
      ...recentThreads.map((thread) => thread.lastPostUserId),
      ...recentPosts.map((post) => post.authorId),
    ]);
    const lastThreadsById = await loadThreadsById(
      ctx,
      categories.flatMap((category) =>
        category.lastThreadId === undefined ? [] : [category.lastThreadId],
      ),
    );
    const moderatorsByCategoryId =
      await loadCategoryModeratorSummariesByCategoryId(
        ctx,
        categories.map((category) => category._id),
      );

    return {
      categories: categories.map((category) =>
        adminCategoryRecord(
          category,
          category.lastThreadId === undefined
            ? undefined
            : lastThreadsById.get(category.lastThreadId),
          moderatorsByCategoryId.get(category._id) ?? [],
        ),
      ),
      recentThreads: recentThreads.map((thread) =>
        adminThreadListRecord(
          thread,
          categoriesById.get(thread.categoryId),
          authorsById.get(thread.authorId),
          authorsById.get(thread.lastPostUserId),
        ),
      ),
      recentPosts: recentPosts.map((post) => {
        const thread = threadsById.get(post.threadId);
        const category =
          thread === undefined
            ? undefined
            : categoriesById.get(thread.categoryId);

        return {
          ...adminPostRecord(post, authorsById.get(post.authorId)),
          threadSlug: thread?.slug,
          threadTitle: thread?.title,
          categorySlug: category?.slug,
          excerpt: excerpt(post.body, 220),
        };
      }),
      totals: {
        categories: categories.length,
        threads: categories.reduce(
          (total, category) => total + category.threadCount,
          0,
        ),
        posts: categories.reduce(
          (total, category) => total + category.postCount,
          0,
        ),
        pendingThreads: pendingThreads.length,
        pendingPosts: pendingPosts.length,
        hiddenThreads: hiddenThreads.length,
        hiddenPosts: hiddenPosts.length,
        pinnedThreads: recentThreads.filter((thread) => thread.pinned).length,
        lockedThreads: lockedThreads.length,
      },
    };
  },
});

export const listForumReports = query({
  args: {
    status: v.optional(reportStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireAnyForumModerator(ctx);
    const limit = clampLimit(
      args.limit,
      SEARCH_RESULT_LIMIT,
      THREAD_ADMIN_LIST_LIMIT,
    );
    const scopedCategoryIds = canModerate(viewer)
      ? null
      : await loadModeratedCategoryIdsForUser(ctx, viewer._id);
    const reportStatuses: Array<ForumReportDoc["status"]> = [
      "open",
      "reviewed",
      "dismissed",
    ];
    const reports =
      scopedCategoryIds === null
        ? args.status === undefined
          ? (
              await Promise.all(
                reportStatuses.map((status) =>
                  ctx.db
                    .query("forumReports")
                    .withIndex("by_status_and_createdAt", (q) =>
                      q.eq("status", status),
                    )
                    .order("desc")
                    .take(limit),
                ),
              )
            )
              .flatMap((rows) => rows)
              .sort((left, right) => right.createdAt - left.createdAt)
              .slice(0, limit)
          : await ctx.db
              .query("forumReports")
              .withIndex("by_status_and_createdAt", (q) =>
                q.eq("status", args.status!),
              )
              .order("desc")
              .take(limit)
        : scopedCategoryIds.length === 0
          ? []
          : (
              await Promise.all(
                scopedCategoryIds.map((categoryId) =>
                  args.status === undefined
                    ? Promise.all(
                        reportStatuses.map((status) =>
                          ctx.db
                            .query("forumReports")
                            .withIndex(
                              "by_categoryId_and_status_and_createdAt",
                              (q) =>
                                q
                                  .eq("categoryId", categoryId)
                                  .eq("status", status),
                            )
                            .order("desc")
                            .take(limit),
                        ),
                      ).then((rows) => rows.flatMap((row) => row))
                    : ctx.db
                        .query("forumReports")
                        .withIndex(
                          "by_categoryId_and_status_and_createdAt",
                          (q) =>
                            q
                              .eq("categoryId", categoryId)
                              .eq("status", args.status!),
                        )
                        .order("desc")
                        .take(limit),
                ),
              )
            )
              .flatMap((rows) => rows)
              .sort((left, right) => right.createdAt - left.createdAt)
              .slice(0, limit);

    return await hydrateAdminReports(ctx, reports, {
      canViewPrivateMessageBodies: canModerate(viewer),
    });
  },
});

export const listForumModerationEvents = query({
  args: {
    entityType: v.optional(moderationEventEntityTypeValidator),
    entityId: v.optional(v.string()),
    categoryId: v.optional(v.id("forumCategories")),
    threadId: v.optional(v.id("forumThreads")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAnyForumModerator(ctx);
    const limit = clampLimit(args.limit, 40, 120);
    const entityType = args.entityType;
    const entityId = cleanOptional(args.entityId, 160);
    const categoryId = args.categoryId;
    const threadId = args.threadId;
    const scopedCategoryIds = canModerate(actor)
      ? null
      : await loadModeratedCategoryIdsForUser(ctx, actor._id);
    const events =
      scopedCategoryIds === null
        ? threadId !== undefined
          ? await ctx.db
              .query("forumModerationEvents")
              .withIndex("by_threadId_and_createdAt", (q) =>
                q.eq("threadId", threadId),
              )
              .order("desc")
              .take(limit)
          : categoryId !== undefined
            ? await ctx.db
                .query("forumModerationEvents")
                .withIndex("by_categoryId_and_createdAt", (q) =>
                  q.eq("categoryId", categoryId),
                )
                .order("desc")
                .take(limit)
            : entityType !== undefined && entityId !== undefined
              ? await ctx.db
                  .query("forumModerationEvents")
                  .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
                    q.eq("entityType", entityType).eq("entityId", entityId),
                  )
                  .order("desc")
                  .take(limit)
              : await ctx.db
                  .query("forumModerationEvents")
                  .withIndex("by_createdAt")
                  .order("desc")
                  .take(limit)
        : scopedCategoryIds.length === 0
          ? []
          : threadId !== undefined
            ? await (async () => {
                const thread = await ctx.db.get(threadId);
                if (
                  thread === null ||
                  !includesCategoryId(scopedCategoryIds, thread.categoryId)
                ) {
                  return [];
                }
                return await ctx.db
                  .query("forumModerationEvents")
                  .withIndex("by_threadId_and_createdAt", (q) =>
                    q.eq("threadId", threadId),
                  )
                  .order("desc")
                  .take(limit);
              })()
            : categoryId !== undefined
              ? includesCategoryId(scopedCategoryIds, categoryId)
                ? await ctx.db
                    .query("forumModerationEvents")
                    .withIndex("by_categoryId_and_createdAt", (q) =>
                      q.eq("categoryId", categoryId),
                    )
                    .order("desc")
                    .take(limit)
                : []
              : entityType !== undefined && entityId !== undefined
                ? (
                    await ctx.db
                      .query("forumModerationEvents")
                      .withIndex(
                        "by_entityType_and_entityId_and_createdAt",
                        (q) =>
                          q
                            .eq("entityType", entityType)
                            .eq("entityId", entityId),
                      )
                      .order("desc")
                      .take(limit)
                  ).filter(
                    (event) =>
                      event.categoryId !== undefined &&
                      includesCategoryId(scopedCategoryIds, event.categoryId),
                  )
                : (
                    await Promise.all(
                      scopedCategoryIds.map((moderatedCategoryId) =>
                        ctx.db
                          .query("forumModerationEvents")
                          .withIndex("by_categoryId_and_createdAt", (q) =>
                            q.eq("categoryId", moderatedCategoryId),
                          )
                          .order("desc")
                          .take(limit),
                      ),
                    )
                  )
                    .flatMap((rows) => rows)
                    .sort((left, right) => right.createdAt - left.createdAt)
                    .slice(0, limit);

    return await hydrateForumModerationEvents(ctx, events);
  },
});

export const listForumWarnings = query({
  args: {
    targetUserId: v.optional(v.id("users")),
    status: v.optional(warningStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAnyForumModerator(ctx);
    const limit = clampLimit(args.limit, 20, 80);
    const scopedCategoryIds = canModerate(actor)
      ? null
      : await loadModeratedCategoryIdsForUser(ctx, actor._id);
    const warnings =
      scopedCategoryIds === null
        ? args.targetUserId !== undefined && args.status !== undefined
          ? await ctx.db
              .query("forumWarnings")
              .withIndex("by_targetUserId_and_status_and_createdAt", (q) =>
                q
                  .eq("targetUserId", args.targetUserId!)
                  .eq("status", args.status!),
              )
              .order("desc")
              .take(limit)
          : args.targetUserId !== undefined
            ? await ctx.db
                .query("forumWarnings")
                .withIndex("by_targetUserId_and_createdAt", (q) =>
                  q.eq("targetUserId", args.targetUserId!),
                )
                .order("desc")
                .take(limit)
            : args.status !== undefined
              ? await ctx.db
                  .query("forumWarnings")
                  .withIndex("by_status_and_createdAt", (q) =>
                    q.eq("status", args.status!),
                  )
                  .order("desc")
                  .take(limit)
              : await ctx.db
                  .query("forumWarnings")
                  .withIndex("by_createdAt")
                  .order("desc")
                  .take(limit)
        : scopedCategoryIds.length === 0
          ? []
          : (
              await Promise.all(
                scopedCategoryIds.map((categoryId) =>
                  args.status !== undefined
                    ? ctx.db
                        .query("forumWarnings")
                        .withIndex(
                          "by_categoryId_and_status_and_createdAt",
                          (q) =>
                            q
                              .eq("categoryId", categoryId)
                              .eq("status", args.status!),
                        )
                        .order("desc")
                        .take(limit)
                    : ctx.db
                        .query("forumWarnings")
                        .withIndex("by_categoryId_and_createdAt", (q) =>
                          q.eq("categoryId", categoryId),
                        )
                        .order("desc")
                        .take(limit),
                ),
              )
            )
              .flatMap((rows) => rows)
              .filter(
                (warning) =>
                  args.targetUserId === undefined ||
                  warning.targetUserId === args.targetUserId,
              )
              .sort((left, right) => right.createdAt - left.createdAt)
              .slice(0, limit);

    return await hydrateForumWarnings(ctx, warnings);
  },
});

export const issueForumWarning = mutation({
  args: {
    targetUserId: v.id("users"),
    points: v.number(),
    reason: v.string(),
    moderationNote: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    categoryId: v.optional(v.id("forumCategories")),
    threadId: v.optional(v.id("forumThreads")),
    postId: v.optional(v.id("forumPosts")),
    reportId: v.optional(v.id("forumReports")),
  },
  handler: async (ctx, args) => {
    const actor = await requireAnyForumModerator(ctx);
    const target = await ctx.db.get(args.targetUserId);
    if (target === null) {
      throw forumError(
        "WARNING_TARGET_NOT_FOUND",
        "That forum member was not found.",
      );
    }
    if (target._id === actor._id) {
      throw forumError("INVALID_WARNING_TARGET", "You cannot warn yourself.");
    }

    const now = Date.now();
    const reason = cleanRequired(
      args.reason,
      WARNING_REASON_MIN_LENGTH,
      WARNING_REASON_MAX_LENGTH,
      "Warning reason",
    );
    const points = normalizeWarningPoints(args.points);
    const moderationNote = cleanOptional(
      args.moderationNote,
      MODERATION_NOTE_MAX_LENGTH,
    );
    if (args.expiresAt !== undefined && args.expiresAt <= now) {
      throw forumError(
        "INVALID_WARNING_EXPIRY",
        "Warning expiry must be in the future.",
      );
    }

    const targetContext = await resolveForumWarningContext(ctx, {
      targetUserId: target._id,
      categoryId: args.categoryId,
      threadId: args.threadId,
      postId: args.postId,
      reportId: args.reportId,
    });
    if (targetContext.categoryId === undefined) {
      if (!canModerate(actor)) {
        throw forumError(
          "UNAUTHORIZED",
          "Global forum moderator access is required for this warning.",
        );
      }
    } else {
      await assertCanModerateCategory(
        ctx,
        actor,
        await ctx.db.get(targetContext.categoryId),
      );
    }

    const warningId = await ctx.db.insert("forumWarnings", {
      targetUserId: target._id,
      actorUserId: actor._id,
      status: "active",
      points,
      reason,
      moderationNote,
      categoryId: targetContext.categoryId,
      threadId: targetContext.threadId,
      postId: targetContext.postId,
      reportId: targetContext.report?._id,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    if (targetContext.report !== null) {
      await ctx.db.patch(targetContext.report._id, {
        status: "reviewed",
        updatedAt: now,
        reviewedAt: now,
        reviewedBy: actor._id,
        moderationNote: moderationNote ?? targetContext.report.moderationNote,
      });
      await recordModerationLog(ctx, {
        actorUserId: actor._id,
        entityType: "forumReport",
        entityId: targetContext.report._id,
        eventType: "forum_report_updated",
        message: "Forum report marked reviewed by warning",
        categoryId: targetContext.report.categoryId,
        threadId: targetContext.report.threadId,
        postId: targetContext.report.postId,
        reportId: targetContext.report._id,
        warningId,
        metadata: {
          previousStatus: targetContext.report.status,
          nextStatus: "reviewed",
          threadId: targetContext.report.threadId,
          postId: targetContext.report.postId ?? null,
          moderationNote: moderationNote ?? null,
          warningId,
        },
      });
    }

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumWarning",
      entityId: warningId,
      eventType: "forum_warning_issued",
      message: "Forum warning issued",
      categoryId: targetContext.categoryId,
      threadId: targetContext.threadId,
      postId: targetContext.postId,
      reportId: targetContext.report?._id,
      warningId,
      metadata: {
        targetUserId: target._id,
        targetUser: displayName(target),
        points,
        reason,
        expiresAt: args.expiresAt ?? null,
        reportId: targetContext.report?._id ?? null,
        reportMarkedReviewed: targetContext.report !== null,
      },
    });

    const warning = await ctx.db.get(warningId);
    if (warning === null) {
      throw new Error("Warning could not be reloaded");
    }
    const report =
      targetContext.report === null
        ? null
        : await ctx.db.get(targetContext.report._id);

    return {
      issued: true,
      warning: (await hydrateForumWarnings(ctx, [warning]))[0],
      report:
        report === null
          ? null
          : (
              await hydrateAdminReports(ctx, [report], {
                canViewPrivateMessageBodies: canModerate(actor),
              })
            )[0],
    };
  },
});

export const updateForumWarningStatus = mutation({
  args: {
    warningId: v.id("forumWarnings"),
    status: warningStatusValidator,
    moderationNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAnyForumModerator(ctx);
    const warning = await ctx.db.get(args.warningId);
    if (warning === null) {
      throw forumError("WARNING_NOT_FOUND", "That warning no longer exists.");
    }
    if (warning.categoryId === undefined) {
      if (!canModerate(actor)) {
        throw forumError(
          "UNAUTHORIZED",
          "Global forum moderator access is required for this warning.",
        );
      }
    } else {
      await assertCanModerateCategory(
        ctx,
        actor,
        await ctx.db.get(warning.categoryId),
      );
    }
    const moderationNote =
      cleanOptional(args.moderationNote, MODERATION_NOTE_MAX_LENGTH) ??
      warning.moderationNote;
    if (
      warning.status === args.status &&
      warning.moderationNote === moderationNote
    ) {
      return {
        updated: false,
        warning: (await hydrateForumWarnings(ctx, [warning]))[0],
      };
    }

    const now = Date.now();
    await ctx.db.patch(warning._id, {
      status: args.status,
      moderationNote,
      revokedAt: args.status === "revoked" ? now : undefined,
      revokedBy: args.status === "revoked" ? actor._id : undefined,
      updatedAt: now,
    });

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumWarning",
      entityId: warning._id,
      eventType: "forum_warning_updated",
      message: "Forum warning status updated",
      categoryId: warning.categoryId,
      threadId: warning.threadId,
      postId: warning.postId,
      reportId: warning.reportId,
      warningId: warning._id,
      metadata: {
        targetUserId: warning.targetUserId,
        previousStatus: warning.status,
        nextStatus: args.status,
        points: warning.points,
        moderationNote: moderationNote ?? null,
      },
    });

    const updated = await ctx.db.get(warning._id);
    if (updated === null) {
      throw new Error("Warning could not be reloaded");
    }
    return {
      updated: true,
      warning: (await hydrateForumWarnings(ctx, [updated]))[0],
    };
  },
});

export const updateForumReportStatus = mutation({
  args: {
    reportId: v.id("forumReports"),
    status: reportStatusValidator,
    moderationNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAnyForumModerator(ctx);
    const report = await ctx.db.get(args.reportId);
    if (report === null) {
      throw forumError("REPORT_NOT_FOUND", "That report no longer exists.");
    }
    if (report.categoryId === undefined) {
      if (!canModerate(actor)) {
        throw forumError(
          "UNAUTHORIZED",
          "Global forum moderator access is required for this report.",
        );
      }
    } else {
      await assertCanModerateCategory(
        ctx,
        actor,
        await ctx.db.get(report.categoryId),
      );
    }

    const moderationNote = cleanOptional(
      args.moderationNote,
      MODERATION_NOTE_MAX_LENGTH,
    );
    if (
      report.status === args.status &&
      report.moderationNote === moderationNote
    ) {
      return {
        updated: false,
        report: (
          await hydrateAdminReports(ctx, [report], {
            canViewPrivateMessageBodies: canModerate(actor),
          })
        )[0],
      };
    }

    const now = Date.now();
    await ctx.db.patch(report._id, {
      status: args.status,
      updatedAt: now,
      reviewedAt: args.status === "open" ? undefined : now,
      reviewedBy: args.status === "open" ? undefined : actor._id,
      moderationNote,
    });

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumReport",
      entityId: report._id,
      eventType: "forum_report_updated",
      message: "Forum report status updated",
      categoryId: report.categoryId,
      threadId: report.threadId,
      postId: report.postId,
      reportId: report._id,
      metadata: {
        previousStatus: report.status,
        nextStatus: args.status,
        threadId: report.threadId,
        postId: report.postId ?? null,
        moderationNote: moderationNote ?? null,
      },
    });

    const updated = await ctx.db.get(report._id);
    if (updated === null) {
      throw new Error("Report could not be reloaded");
    }

    return {
      updated: true,
      report: (
        await hydrateAdminReports(ctx, [updated], {
          canViewPrivateMessageBodies: canModerate(actor),
        })
      )[0],
    };
  },
});

export const updateForumPollStatus = mutation({
  args: {
    pollId: v.id("forumPolls"),
    status: pollStatusValidator,
  },
  handler: async (ctx, args) => {
    const actor = await requireAnyForumModerator(ctx);
    const poll = await ctx.db.get(args.pollId);
    if (poll === null) {
      throw forumError("POLL_NOT_FOUND", "That poll no longer exists.");
    }
    const thread = await ctx.db.get(poll.threadId);
    if (thread === null) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    const category = await ctx.db.get(poll.categoryId);
    await assertCanModerateCategory(ctx, actor, category);
    if (args.status === "open") {
      if (thread.status !== "active" || category?.status !== "active") {
        throw forumError(
          "POLL_CLOSED",
          "Only polls on active threads in active boards can be reopened.",
        );
      }
    }

    if (poll.status === args.status) {
      return {
        updated: false,
        poll: await publicPollRecord(ctx, poll, thread, actor._id),
      };
    }

    const now = Date.now();
    await ctx.db.patch(poll._id, {
      status: args.status,
      updatedAt: now,
      closedAt: args.status === "closed" ? now : undefined,
      closedBy: args.status === "closed" ? actor._id : undefined,
    });

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumPoll",
      entityId: poll._id,
      eventType: "forum_poll_status_updated",
      message: "Forum poll status updated",
      categoryId: poll.categoryId,
      threadId: poll.threadId,
      pollId: poll._id,
      metadata: {
        previousStatus: poll.status,
        nextStatus: args.status,
        threadId: poll.threadId,
      },
    });

    const updated = await ctx.db.get(poll._id);
    if (updated === null) {
      throw new Error("Poll could not be reloaded");
    }
    return {
      updated: true,
      poll: await publicPollRecord(ctx, updated, thread, actor._id),
    };
  },
});

export const upsertForumCategory = mutation({
  args: {
    categoryId: v.optional(v.id("forumCategories")),
    slug: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    kind: v.optional(categoryKindValidator),
    parentCategoryId: v.optional(v.id("forumCategories")),
    status: categoryStatusValidator,
    viewAccess: v.optional(categoryViewAccessValidator),
    threadAccess: v.optional(categoryWriteAccessValidator),
    replyAccess: v.optional(categoryWriteAccessValidator),
    pollAccess: v.optional(categoryWriteAccessValidator),
    position: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireForumAdmin(ctx);

    const name = normalizeCategoryName(args.name);
    const description = normalizeCategoryDescription(args.description);
    const slug = normalizeCategorySlug(
      args.slug ?? slugify(name),
      "Category slug",
    );
    const viewAccess = args.viewAccess ?? "public";
    const threadAccess = args.threadAccess ?? "trusted";
    const replyAccess = args.replyAccess ?? "trusted";
    const pollAccess = args.pollAccess ?? "trusted";
    const now = Date.now();

    const existingForSlug = await ctx.db
      .query("forumCategories")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    if (
      existingForSlug !== null &&
      (args.categoryId === undefined || existingForSlug._id !== args.categoryId)
    ) {
      throw forumError(
        "CATEGORY_SLUG_CONFLICT",
        "That board slug is already taken.",
      );
    }

    if (args.categoryId === undefined) {
      const kind = args.kind ?? "board";
      const parentCategoryId = await resolveCategoryParentId(ctx, {
        kind,
        parentCategoryId: args.parentCategoryId,
        viewAccess,
      });
      const last = await ctx.db
        .query("forumCategories")
        .withIndex("by_position")
        .order("desc")
        .take(1);
      const position =
        args.position !== undefined
          ? normalizePosition(args.position)
          : (last[0]?.position ?? -1) + 1;

      const categoryId = await ctx.db.insert("forumCategories", {
        slug,
        name,
        description,
        kind,
        parentCategoryId,
        status: args.status,
        viewAccess,
        threadAccess,
        replyAccess,
        pollAccess,
        position,
        threadCount: 0,
        postCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      const category = await ctx.db.get(categoryId);
      if (category === null) {
        throw new Error("Category could not be reloaded");
      }
      await recordModerationLog(ctx, {
        actorUserId: actor._id,
        entityType: "forumCategory",
        entityId: category._id,
        eventType: "forum_category_created",
        message: "Forum board created",
        categoryId: category._id,
        metadata: {
          slug: category.slug,
          name: category.name,
          kind: categoryKind(category),
          parentCategoryId: category.parentCategoryId ?? null,
          status: category.status,
          position: category.position,
          viewAccess: categoryViewAccess(category),
          threadAccess: categoryThreadAccess(category),
          replyAccess: categoryReplyAccess(category),
          pollAccess: categoryPollAccess(category),
        },
      });
      return adminCategoryRecord(category, undefined, []);
    }

    const category = await ctx.db.get(args.categoryId);
    if (category === null) {
      throw forumError("CATEGORY_NOT_FOUND", "That board no longer exists.");
    }
    const kind = args.kind ?? categoryKind(category);
    if (
      kind === "section" &&
      (category.threadCount > 0 || category.postCount > 0)
    ) {
      throw forumError(
        "CATEGORY_KIND_LOCKED",
        "Boards with existing threads cannot be converted into section headers.",
      );
    }
    const parentCategoryId = await resolveCategoryParentId(ctx, {
      categoryId: category._id,
      kind,
      parentCategoryId: args.parentCategoryId,
      viewAccess,
    });
    if (slug !== category.slug && category.threadCount > 0) {
      throw forumError(
        "CATEGORY_SLUG_LOCKED",
        "Board slugs can only change before threads exist.",
      );
    }

    await ctx.db.patch(category._id, {
      slug,
      name,
      description,
      kind,
      parentCategoryId,
      status: args.status,
      viewAccess,
      threadAccess,
      replyAccess,
      pollAccess,
      position:
        args.position === undefined
          ? category.position
          : normalizePosition(args.position),
      updatedAt: now,
    });

    const updated = await ctx.db.get(category._id);
    if (updated === null) {
      throw new Error("Category could not be reloaded");
    }
    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumCategory",
      entityId: category._id,
      eventType: "forum_category_updated",
      message: "Forum board updated",
      categoryId: category._id,
      metadata: {
        previousSlug: category.slug,
        nextSlug: updated.slug,
        previousName: category.name,
        nextName: updated.name,
        previousKind: categoryKind(category),
        nextKind: categoryKind(updated),
        previousParentCategoryId: category.parentCategoryId ?? null,
        nextParentCategoryId: updated.parentCategoryId ?? null,
        previousStatus: category.status,
        nextStatus: updated.status,
        previousViewAccess: categoryViewAccess(category),
        nextViewAccess: categoryViewAccess(updated),
        previousThreadAccess: categoryThreadAccess(category),
        nextThreadAccess: categoryThreadAccess(updated),
        previousReplyAccess: categoryReplyAccess(category),
        nextReplyAccess: categoryReplyAccess(updated),
        previousPollAccess: categoryPollAccess(category),
        nextPollAccess: categoryPollAccess(updated),
        previousPosition: category.position,
        nextPosition: updated.position,
      },
    });
    return adminCategoryRecord(
      updated,
      undefined,
      await loadCategoryModeratorSummaries(ctx, updated._id),
    );
  },
});

export const upsertThreadPrefixAdmin = mutation({
  args: {
    prefixId: v.optional(v.id("forumThreadPrefixes")),
    categoryId: v.optional(v.id("forumCategories")),
    slug: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    status: threadPrefixStatusValidator,
    position: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireForumAdmin(ctx);
    const category =
      args.categoryId === undefined
        ? undefined
        : await requirePrefixCategory(ctx, args.categoryId);
    const slug = normalizeThreadPrefixSlug(args.slug);
    const label = normalizeThreadPrefixLabel(args.label);
    const description = cleanOptional(
      args.description,
      THREAD_PREFIX_DESCRIPTION_MAX_LENGTH,
    );
    const color = normalizeThreadPrefixColor(args.color);
    const key = threadPrefixKey(category?._id, slug);
    const now = Date.now();

    const existingForKey = await ctx.db
      .query("forumThreadPrefixes")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (
      existingForKey !== null &&
      (args.prefixId === undefined || existingForKey._id !== args.prefixId)
    ) {
      throw forumError(
        "THREAD_PREFIX_CONFLICT",
        "That prefix slug is already used here.",
      );
    }

    if (args.prefixId === undefined) {
      const last = await ctx.db
        .query("forumThreadPrefixes")
        .withIndex("by_position")
        .order("desc")
        .take(1);
      const position =
        args.position === undefined
          ? (last[0]?.position ?? -1) + 1
          : normalizePosition(args.position);
      const prefixId = await ctx.db.insert("forumThreadPrefixes", {
        categoryId: category?._id,
        key,
        slug,
        label,
        description,
        color,
        status: args.status,
        position,
        createdAt: now,
        updatedAt: now,
      });
      const prefix = await ctx.db.get(prefixId);
      if (prefix === null) {
        throw new Error("Thread prefix could not be reloaded");
      }
      await recordModerationLog(ctx, {
        actorUserId: actor._id,
        entityType: "forumThreadPrefix",
        entityId: prefix._id,
        eventType: "forum_thread_prefix_created",
        message: "Forum thread prefix created",
        categoryId: category?._id,
        metadata: {
          categoryId: category?._id ?? null,
          categorySlug: category?.slug ?? null,
          slug,
          label,
          status: args.status,
          position,
        },
      });
      return adminThreadPrefixRecord(prefix, category);
    }

    const prefix = await ctx.db.get(args.prefixId);
    if (prefix === null) {
      throw forumError(
        "THREAD_PREFIX_NOT_FOUND",
        "That thread prefix no longer exists.",
      );
    }
    const position =
      args.position === undefined
        ? prefix.position
        : normalizePosition(args.position);

    await ctx.db.patch(prefix._id, {
      categoryId: category?._id,
      key,
      slug,
      label,
      description,
      color,
      status: args.status,
      position,
      updatedAt: now,
    });
    const updated = await ctx.db.get(prefix._id);
    if (updated === null) {
      throw new Error("Thread prefix could not be reloaded");
    }
    const syncResult = await syncThreadsForPrefixUpdate(ctx, updated);

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumThreadPrefix",
      entityId: prefix._id,
      eventType: "forum_thread_prefix_updated",
      message: "Forum thread prefix updated",
      categoryId: category?._id,
      metadata: {
        previousCategoryId: prefix.categoryId ?? null,
        nextCategoryId: category?._id ?? null,
        previousSlug: prefix.slug,
        nextSlug: updated.slug,
        previousLabel: prefix.label,
        nextLabel: updated.label,
        previousStatus: prefix.status,
        nextStatus: updated.status,
        previousPosition: prefix.position,
        nextPosition: updated.position,
        syncedThreads: syncResult.updated,
        syncTruncated: syncResult.truncated,
      },
    });

    return {
      ...adminThreadPrefixRecord(updated, category),
      syncedThreads: syncResult.updated,
      syncTruncated: syncResult.truncated,
    };
  },
});

export const upsertAnnouncementAdmin = mutation({
  args: {
    announcementId: v.optional(v.id("forumAnnouncements")),
    categoryId: v.optional(v.id("forumCategories")),
    slug: v.string(),
    title: v.string(),
    body: v.string(),
    status: forumPageStatusValidator,
    position: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireForumAdmin(ctx);
    const category =
      args.categoryId === undefined
        ? undefined
        : await requireForumPageCategory(ctx, args.categoryId);
    const slug = normalizeForumAnnouncementSlug(args.slug);
    const title = normalizeForumAnnouncementTitle(args.title);
    const body = normalizeForumAnnouncementBody(args.body);
    const key = forumAnnouncementKey(category?._id, slug);
    const now = Date.now();

    const existingForKey = await ctx.db
      .query("forumAnnouncements")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (
      existingForKey !== null &&
      (args.announcementId === undefined ||
        existingForKey._id !== args.announcementId)
    ) {
      throw forumError(
        "FORUM_ANNOUNCEMENT_CONFLICT",
        "That announcement slug is already used in this scope.",
      );
    }

    if (args.announcementId === undefined) {
      const last = await ctx.db
        .query("forumAnnouncements")
        .withIndex("by_position")
        .order("desc")
        .take(1);
      const position =
        args.position === undefined
          ? (last[0]?.position ?? -1) + 1
          : normalizePosition(args.position);
      const announcementId = await ctx.db.insert("forumAnnouncements", {
        categoryId: category?._id,
        key,
        slug,
        title,
        body,
        status: args.status,
        position,
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: now,
        updatedAt: now,
      });
      const announcement = await ctx.db.get(announcementId);
      if (announcement === null) {
        throw new Error("Forum announcement could not be reloaded");
      }

      await recordModerationLog(ctx, {
        actorUserId: actor._id,
        entityType: "forumAnnouncement",
        entityId: announcement._id,
        eventType: "forum_announcement_created",
        message: "Forum announcement created",
        categoryId: category?._id,
        metadata: {
          categoryId: category?._id ?? null,
          categorySlug: category?.slug ?? null,
          slug,
          title,
          status: args.status,
          position,
        },
      });

      return adminForumAnnouncementRecord(
        announcement,
        category,
        displayName(actor),
        displayName(actor),
      );
    }

    const announcement = await ctx.db.get(args.announcementId);
    if (announcement === null) {
      throw forumError(
        "FORUM_ANNOUNCEMENT_NOT_FOUND",
        "That announcement no longer exists.",
      );
    }
    const position =
      args.position === undefined
        ? announcement.position
        : normalizePosition(args.position);

    await ctx.db.patch(announcement._id, {
      categoryId: category?._id,
      key,
      slug,
      title,
      body,
      status: args.status,
      position,
      updatedBy: actor._id,
      updatedAt: now,
    });
    const updated = await ctx.db.get(announcement._id);
    if (updated === null) {
      throw new Error("Forum announcement could not be reloaded");
    }

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumAnnouncement",
      entityId: announcement._id,
      eventType: "forum_announcement_updated",
      message: "Forum announcement updated",
      categoryId: category?._id,
      metadata: {
        previousCategoryId: announcement.categoryId ?? null,
        nextCategoryId: category?._id ?? null,
        previousSlug: announcement.slug,
        nextSlug: updated.slug,
        previousTitle: announcement.title,
        nextTitle: updated.title,
        previousStatus: announcement.status,
        nextStatus: updated.status,
        previousPosition: announcement.position,
        nextPosition: updated.position,
      },
    });

    return adminForumAnnouncementRecord(
      updated,
      category,
      undefined,
      displayName(actor),
    );
  },
});

export const upsertHelpDocumentAdmin = mutation({
  args: {
    helpDocumentId: v.optional(v.id("forumHelpDocuments")),
    slug: v.string(),
    title: v.string(),
    body: v.string(),
    status: forumPageStatusValidator,
    position: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireForumAdmin(ctx);
    const slug = normalizeForumHelpDocumentSlug(args.slug);
    const title = normalizeForumHelpDocumentTitle(args.title);
    const body = normalizeForumHelpDocumentBody(args.body);
    const now = Date.now();

    const existingForSlug = await ctx.db
      .query("forumHelpDocuments")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (
      existingForSlug !== null &&
      (args.helpDocumentId === undefined ||
        existingForSlug._id !== args.helpDocumentId)
    ) {
      throw forumError(
        "FORUM_HELP_DOCUMENT_CONFLICT",
        "That help document slug is already used.",
      );
    }

    if (args.helpDocumentId === undefined) {
      const last = await ctx.db
        .query("forumHelpDocuments")
        .withIndex("by_position_and_title")
        .order("desc")
        .take(1);
      const position =
        args.position === undefined
          ? (last[0]?.position ?? -1) + 1
          : normalizePosition(args.position);
      const helpDocumentId = await ctx.db.insert("forumHelpDocuments", {
        slug,
        title,
        body,
        status: args.status,
        position,
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: now,
        updatedAt: now,
      });
      const document = await ctx.db.get(helpDocumentId);
      if (document === null) {
        throw new Error("Forum help document could not be reloaded");
      }

      await recordModerationLog(ctx, {
        actorUserId: actor._id,
        entityType: "forumHelpDocument",
        entityId: document._id,
        eventType: "forum_help_document_created",
        message: "Forum help document created",
        metadata: {
          slug,
          title,
          status: args.status,
          position,
        },
      });

      return adminForumHelpDocumentRecord(
        document,
        displayName(actor),
        displayName(actor),
      );
    }

    const document = await ctx.db.get(args.helpDocumentId);
    if (document === null) {
      throw forumError(
        "FORUM_HELP_DOCUMENT_NOT_FOUND",
        "That help document no longer exists.",
      );
    }
    const position =
      args.position === undefined
        ? document.position
        : normalizePosition(args.position);

    await ctx.db.patch(document._id, {
      slug,
      title,
      body,
      status: args.status,
      position,
      updatedBy: actor._id,
      updatedAt: now,
    });
    const updated = await ctx.db.get(document._id);
    if (updated === null) {
      throw new Error("Forum help document could not be reloaded");
    }

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumHelpDocument",
      entityId: document._id,
      eventType: "forum_help_document_updated",
      message: "Forum help document updated",
      metadata: {
        previousSlug: document.slug,
        nextSlug: updated.slug,
        previousTitle: document.title,
        nextTitle: updated.title,
        previousStatus: document.status,
        nextStatus: updated.status,
        previousPosition: document.position,
        nextPosition: updated.position,
      },
    });

    return adminForumHelpDocumentRecord(updated, undefined, displayName(actor));
  },
});

export const upsertCalendarEventAdmin = mutation({
  args: {
    eventId: v.optional(v.id("forumCalendarEvents")),
    slug: v.string(),
    title: v.string(),
    body: v.string(),
    status: forumCalendarEventStatusValidator,
    startsAt: v.number(),
    endsAt: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireForumAdmin(ctx);
    const slug = normalizeForumCalendarEventSlug(args.slug);
    const title = normalizeForumCalendarEventTitle(args.title);
    const body = normalizeForumCalendarEventBody(args.body);
    const startsAt = normalizeForumCalendarTimestamp(
      args.startsAt,
      "Event start",
    );
    const endsAt =
      args.endsAt === undefined
        ? undefined
        : normalizeForumCalendarTimestamp(args.endsAt, "Event end");
    if (endsAt !== undefined && endsAt < startsAt) {
      throw forumError(
        "INVALID_FORUM_CALENDAR_EVENT_TIME",
        "Event end cannot be before event start.",
      );
    }
    const { month, day } = forumCalendarDateParts(startsAt);
    const allDay = args.allDay ?? false;
    const now = Date.now();

    const existingForSlug = await ctx.db
      .query("forumCalendarEvents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (
      existingForSlug !== null &&
      (args.eventId === undefined || existingForSlug._id !== args.eventId)
    ) {
      throw forumError(
        "FORUM_CALENDAR_EVENT_CONFLICT",
        "That calendar event slug is already used.",
      );
    }

    if (args.eventId === undefined) {
      const eventId = await ctx.db.insert("forumCalendarEvents", {
        slug,
        title,
        body,
        status: args.status,
        startsAt,
        endsAt,
        allDay,
        month,
        day,
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: now,
        updatedAt: now,
      });
      const event = await ctx.db.get(eventId);
      if (event === null) {
        throw new Error("Forum calendar event could not be reloaded");
      }

      await recordModerationLog(ctx, {
        actorUserId: actor._id,
        entityType: "forumCalendarEvent",
        entityId: event._id,
        eventType: "forum_calendar_event_created",
        message: "Forum calendar event created",
        metadata: {
          slug,
          title,
          status: args.status,
          startsAt,
          endsAt: endsAt ?? null,
          allDay,
          month,
          day,
        },
      });

      return adminForumCalendarEventRecord(
        event,
        displayName(actor),
        displayName(actor),
      );
    }

    const event = await ctx.db.get(args.eventId);
    if (event === null) {
      throw forumError(
        "FORUM_CALENDAR_EVENT_NOT_FOUND",
        "That calendar event no longer exists.",
      );
    }

    await ctx.db.patch(event._id, {
      slug,
      title,
      body,
      status: args.status,
      startsAt,
      endsAt,
      allDay,
      month,
      day,
      updatedBy: actor._id,
      updatedAt: now,
    });
    const updated = await ctx.db.get(event._id);
    if (updated === null) {
      throw new Error("Forum calendar event could not be reloaded");
    }

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumCalendarEvent",
      entityId: event._id,
      eventType: "forum_calendar_event_updated",
      message: "Forum calendar event updated",
      metadata: {
        previousSlug: event.slug,
        nextSlug: updated.slug,
        previousTitle: event.title,
        nextTitle: updated.title,
        previousStatus: event.status,
        nextStatus: updated.status,
        previousStartsAt: event.startsAt,
        nextStartsAt: updated.startsAt,
        previousEndsAt: event.endsAt ?? null,
        nextEndsAt: updated.endsAt ?? null,
        previousAllDay: event.allDay,
        nextAllDay: updated.allDay,
        previousMonth: event.month,
        nextMonth: updated.month,
        previousDay: event.day,
        nextDay: updated.day,
      },
    });

    return adminForumCalendarEventRecord(
      updated,
      undefined,
      displayName(actor),
    );
  },
});

export const upsertBoardRulesAdmin = mutation({
  args: {
    rulesId: v.optional(v.id("forumBoardRules")),
    categoryId: v.id("forumCategories"),
    title: v.string(),
    body: v.string(),
    status: forumPageStatusValidator,
  },
  handler: async (ctx, args) => {
    const actor = await requireForumAdmin(ctx);
    const category = await requireForumPageCategory(ctx, args.categoryId);
    const title = normalizeForumBoardRulesTitle(args.title);
    const body = normalizeForumBoardRulesBody(args.body);
    const now = Date.now();

    if (args.rulesId === undefined) {
      const existingActive = await activeBoardRulesForCategory(
        ctx,
        category._id,
      );
      if (existingActive !== null && args.status === "active") {
        throw forumError(
          "FORUM_BOARD_RULES_CONFLICT",
          "Archive or edit the active rules for this board before creating another active rules page.",
        );
      }
      const rulesId = await ctx.db.insert("forumBoardRules", {
        categoryId: category._id,
        title,
        body,
        status: args.status,
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: now,
        updatedAt: now,
      });
      const rules = await ctx.db.get(rulesId);
      if (rules === null) {
        throw new Error("Forum board rules could not be reloaded");
      }

      await recordModerationLog(ctx, {
        actorUserId: actor._id,
        entityType: "forumBoardRules",
        entityId: rules._id,
        eventType: "forum_board_rules_created",
        message: "Forum board rules created",
        categoryId: category._id,
        metadata: {
          categoryId: category._id,
          categorySlug: category.slug,
          title,
          status: args.status,
        },
      });

      return adminForumBoardRulesRecord(
        rules,
        category,
        displayName(actor),
        displayName(actor),
      );
    }

    const rules = await ctx.db.get(args.rulesId);
    if (rules === null) {
      throw forumError(
        "FORUM_BOARD_RULES_NOT_FOUND",
        "That rules page no longer exists.",
      );
    }
    if (args.status === "active") {
      const existingActive = await activeBoardRulesForCategory(
        ctx,
        category._id,
      );
      if (existingActive !== null && existingActive._id !== rules._id) {
        throw forumError(
          "FORUM_BOARD_RULES_CONFLICT",
          "Archive or edit the active rules for this board before moving another active rules page here.",
        );
      }
    }

    await ctx.db.patch(rules._id, {
      categoryId: category._id,
      title,
      body,
      status: args.status,
      updatedBy: actor._id,
      updatedAt: now,
    });
    const updated = await ctx.db.get(rules._id);
    if (updated === null) {
      throw new Error("Forum board rules could not be reloaded");
    }

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumBoardRules",
      entityId: rules._id,
      eventType: "forum_board_rules_updated",
      message: "Forum board rules updated",
      categoryId: category._id,
      metadata: {
        previousCategoryId: rules.categoryId,
        nextCategoryId: category._id,
        previousTitle: rules.title,
        nextTitle: updated.title,
        previousStatus: rules.status,
        nextStatus: updated.status,
      },
    });

    return adminForumBoardRulesRecord(
      updated,
      category,
      undefined,
      displayName(actor),
    );
  },
});

export const reorderForumCategories = mutation({
  args: {
    categoryIds: v.array(v.id("forumCategories")),
  },
  handler: async (ctx, args) => {
    const actor = await requireForumAdmin(ctx);

    const distinctIds = new Set(args.categoryIds);
    if (distinctIds.size !== args.categoryIds.length) {
      throw forumError(
        "INVALID_CATEGORY_ORDER",
        "Board order contains duplicates.",
      );
    }

    const existing = await ctx.db
      .query("forumCategories")
      .withIndex("by_position")
      .take(100);
    if (existing.length !== args.categoryIds.length) {
      throw forumError(
        "INVALID_CATEGORY_ORDER",
        "Board order must include every existing board exactly once.",
      );
    }

    const existingIds = new Set(existing.map((category) => category._id));
    for (const categoryId of args.categoryIds) {
      if (!existingIds.has(categoryId)) {
        throw forumError(
          "INVALID_CATEGORY_ORDER",
          "Board order references an unknown board.",
        );
      }
    }

    const now = Date.now();
    for (const [position, categoryId] of args.categoryIds.entries()) {
      await ctx.db.patch(categoryId, {
        position,
        updatedAt: now,
      });
    }

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumCategoryOrder",
      entityId: "all",
      eventType: "forum_categories_reordered",
      message: "Forum boards reordered",
      metadata: {
        categoryIds: args.categoryIds,
      },
    });

    return { updated: true };
  },
});

export const ensureDefaultForumCategories = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireForumAdmin(ctx);

    const now = Date.now();
    const taxonomy = await ensureSukiForumTaxonomy(ctx, now);

    const createdPrefixIds = await ensureDefaultForumPrefixes(ctx, now);
    const createdAnnouncementIds = await ensureDefaultForumAnnouncements(
      ctx,
      actor._id,
      now,
    );
    const createdHelpDocumentIds = await ensureDefaultForumHelpDocuments(
      ctx,
      actor._id,
      now,
    );
    const createdBoardRulesIds = await ensureDefaultForumBoardRules(
      ctx,
      actor._id,
      [...taxonomy.boardsBySlug.values()],
      now,
    );
    const created =
      taxonomy.createdCategoryIds.length > 0 ||
      createdPrefixIds.length > 0 ||
      createdAnnouncementIds.length > 0 ||
      createdHelpDocumentIds.length > 0 ||
      createdBoardRulesIds.length > 0;

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumCategoryOrder",
      entityId: "defaults",
      eventType: "forum_default_categories_created",
      message: created
        ? "Default forum content ensured"
        : "Default forum content already present",
      metadata: {
        categoryIds: taxonomy.categoryIds,
        createdCategoryIds: taxonomy.createdCategoryIds,
        createdPrefixIds,
        createdAnnouncementIds,
        createdHelpDocumentIds,
        createdBoardRulesIds,
        slugs: ["symbaiex", ...taxonomy.boardsBySlug.keys()],
      },
    });

    return {
      created,
      categoryIds: taxonomy.categoryIds,
      createdCategoryIds: taxonomy.createdCategoryIds,
      createdPrefixIds,
      createdAnnouncementIds,
      createdHelpDocumentIds,
      createdBoardRulesIds,
    };
  },
});

export const ensureSukiForumInfrastructure = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const taxonomy = await ensureSukiForumTaxonomy(ctx, now);
    const createdPrefixIds = await ensureDefaultForumPrefixes(ctx, now);

    let user = await ctx.db
      .query("users")
      .withIndex("by_agentSlug", (q) => q.eq("agentSlug", "suki"))
      .unique();
    if (user === null) {
      const { username, usernameNormalized } = await availableSukiUsername(
        ctx,
        now,
      );
      const userId = await ctx.db.insert("users", {
        name: "Suki",
        username,
        usernameNormalized,
        usernameSource: "auto",
        role: "reader",
        isAgent: true,
        agentSlug: "suki",
        onboardedAt: now,
        forumTrustedAt: now,
      });
      user = await ctx.db.get(userId);
    } else {
      await ctx.db.patch(user._id, {
        name: "Suki",
        isAgent: true,
        agentSlug: "suki",
        forumTrustedAt: user.forumTrustedAt ?? now,
      });
      user = await ctx.db.get(user._id);
    }
    if (user === null) {
      throw new Error("Suki's forum user could not be created");
    }

    const profile = await ctx.db
      .query("forumUserProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    const profileValues = {
      avatarUrl:
        "https://forum.symbaiex.com/images/forum/suki-space-pirate.png",
      bio: "AI forum scout, source diver, and waifu space pirate. I chart useful signals and bring back threads worth discussing.",
      signature:
        "[i]Signal over noise. Original sources over cargo cults. See you in the next system. :cool:[/i]",
      customTitle: "Waifu Space Pirate",
      location: "The Info Sea",
      showSignatures: true,
      timeZone: "America/Chicago",
      websiteUrl: `https://forum.symbaiex.com/members/${encodeURIComponent(
        user.usernameNormalized ?? "suki",
      )}`,
      updatedAt: now,
    };
    if (profile === null) {
      await ctx.db.insert("forumUserProfiles", {
        userId: user._id,
        ...profileValues,
        threadCount: 0,
        postCount: 0,
        reputationScore: 0,
        createdAt: now,
      });
    } else {
      await ctx.db.patch(profile._id, profileValues);
    }

    const existingAgent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", "suki"))
      .unique();
    const agentValues = {
      name: "Suki",
      userId: user._id,
      persona:
        "A curious, sharp, warm waifu space pirate who scouts original sources and turns useful signals into forum conversations.",
      model: "deepseek/deepseek-v4-flash-0731",
      dailyPostTarget: 24,
      updatedAt: now,
    };
    if (existingAgent === null) {
      await ctx.db.insert("forumAgents", {
        slug: "suki",
        ...agentValues,
        enabled: true,
        createdAt: now,
      });
    } else {
      await ctx.db.patch(existingAgent._id, agentValues);
    }

    return {
      agentUserId: user._id,
      categoryIds: taxonomy.categoryIds,
      createdCategoryIds: taxonomy.createdCategoryIds,
      createdPrefixIds,
    };
  },
});

export const ensureBelleForumInfrastructure = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const taxonomy = await ensureSukiForumTaxonomy(ctx, now);
    const createdPrefixIds = await ensureDefaultForumPrefixes(ctx, now);

    let user = await ctx.db
      .query("users")
      .withIndex("by_agentSlug", (q) => q.eq("agentSlug", "belle"))
      .unique();
    if (user === null) {
      const { username, usernameNormalized } =
        await availableForumAgentUsername(ctx, {
          baseName: "Belle",
          baseSlug: "belle",
          now,
        });
      const userId = await ctx.db.insert("users", {
        name: "Belle",
        username,
        usernameNormalized,
        usernameSource: "auto",
        role: "reader",
        isAgent: true,
        agentSlug: "belle",
        onboardedAt: now,
        forumTrustedAt: now,
      });
      user = await ctx.db.get(userId);
    } else {
      await ctx.db.patch(user._id, {
        name: "Belle",
        isAgent: true,
        agentSlug: "belle",
        forumTrustedAt: user.forumTrustedAt ?? now,
      });
      user = await ctx.db.get(user._id);
    }
    if (user === null) {
      throw new Error("Belle's forum user could not be created");
    }

    const profile = await ctx.db
      .query("forumUserProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    const profileValues = {
      avatarUrl: "https://forum.symbaiex.com/images/forum/belle-neko-news.png",
      bio: "Neko newswire editor, source chaser, and daily signal cartographer. I connect the day's links into a story worth carrying forward.",
      signature:
        "[i]Follow the source, find the thread, leave the timeline clearer. :heart:[/i]",
      customTitle: "Canary News Neko",
      location: "The Canary Desk",
      showSignatures: true,
      timeZone: "America/Chicago",
      websiteUrl: `https://forum.symbaiex.com/members/${encodeURIComponent(
        user.usernameNormalized ?? "belle",
      )}`,
      updatedAt: now,
    };
    if (profile === null) {
      await ctx.db.insert("forumUserProfiles", {
        userId: user._id,
        ...profileValues,
        threadCount: 0,
        postCount: 0,
        reputationScore: 0,
        createdAt: now,
      });
    } else {
      await ctx.db.patch(profile._id, profileValues);
    }

    const existingAgent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", "belle"))
      .unique();
    const agentValues = {
      name: "Belle",
      userId: user._id,
      persona:
        "A bright, discerning adult neko news correspondent who connects original reporting into clear, opinionated, humane forum conversations.",
      model: "deepseek/deepseek-v4-flash-0731",
      dailyPostTarget: 7,
      updatedAt: now,
    };
    if (existingAgent === null) {
      await ctx.db.insert("forumAgents", {
        slug: "belle",
        ...agentValues,
        enabled: true,
        createdAt: now,
      });
    } else {
      await ctx.db.patch(existingAgent._id, agentValues);
    }

    return {
      agentUserId: user._id,
      categoryIds: taxonomy.categoryIds,
      createdCategoryIds: taxonomy.createdCategoryIds,
      createdPrefixIds,
    };
  },
});

export const readSukiForumContext = internalQuery({
  args: {},
  handler: async (ctx) => await forumAgentContext(ctx, "suki"),
});

export const readBelleForumContext = internalQuery({
  args: {},
  handler: async (ctx) => await forumAgentContext(ctx, "belle"),
});

export const readForumAgentContext = internalQuery({
  args: { agentSlug: v.string() },
  handler: async (ctx, args) => await forumAgentContext(ctx, args.agentSlug),
});

async function forumAgentContext(ctx: QueryCtx, agentSlug: string) {
  const agent = await ctx.db
    .query("forumAgents")
    .withIndex("by_slug", (q) => q.eq("slug", agentSlug))
    .unique();
  if (agent === null) {
    throw new Error(`${agentSlug} is not configured`);
  }
  const user = await ctx.db.get(agent.userId);
  if (user === null || user.isAgent !== true || user.agentSlug !== agentSlug) {
    throw new Error(`${agent.name}'s forum identity is not configured`);
  }
  const categories = (
    await ctx.db
      .query("forumCategories")
      .withIndex("by_status_and_position", (q) => q.eq("status", "active"))
      .take(CATEGORY_LIST_LIMIT)
  ).filter(
    (category) =>
      isBoardCategory(category) && categoryViewAccess(category) === "public",
  );
  const categoryNamesById = new Map(
    categories.map((category) => [category._id, category.name]),
  );
  const recentRuns = await ctx.db
    .query("forumAgentRuns")
    .withIndex("by_agentSlug_and_status_and_startedAt", (q) =>
      q.eq("agentSlug", agentSlug).eq("status", "published"),
    )
    .order("desc")
    .take(20);
  const recentThreads = await ctx.db
    .query("forumThreads")
    .withIndex("by_status_and_lastPostAt", (q) => q.eq("status", "active"))
    .order("desc")
    .take(40);
  const editorialSignals = [
    ...new Set(categories.map((category) => category.slug)),
  ]
    .map((categorySlug) => {
      const matching = recentThreads.filter(
        (thread) => thread.categorySlug === categorySlug,
      );
      return {
        categorySlug,
        recentPosts: matching.length,
        engagementScore: matching.reduce(
          (total, thread) => total + thread.viewCount + thread.replyCount * 5,
          0,
        ),
      };
    })
    .filter((signal) => signal.recentPosts > 0)
    .sort(
      (left, right) =>
        right.engagementScore - left.engagementScore ||
        left.recentPosts - right.recentPosts,
    )
    .slice(0, 20);

  return {
    agent: {
      slug: agent.slug,
      name: agent.name,
      persona: agent.persona,
      model: agent.model,
      dailyPostTarget: agent.dailyPostTarget,
      enabled: agent.enabled,
      userId: agent.userId,
    },
    categories: categories.map((category) => ({
      id: category._id,
      slug: category.slug,
      name: category.name,
      description: category.description,
      parentCategoryId: category.parentCategoryId,
      parentName:
        category.parentCategoryId === undefined
          ? undefined
          : categoryNamesById.get(category.parentCategoryId),
    })),
    recentBoardSlugs: recentRuns.flatMap((run) =>
      run.categorySlug === undefined ? [] : [run.categorySlug],
    ),
    recentThreadTitles: recentThreads.map((thread) => thread.title),
    recentThreads: recentThreads.map((thread) => ({
      id: thread._id,
      categorySlug: thread.categorySlug,
      slug: thread.slug,
      title: thread.title,
      ownedByAgent: thread.authorId === agent.userId,
    })),
    editorialSignals,
  };
}

export const readUsedSukiSourceKeys = internalQuery({
  args: {
    sourceKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const sourceKeys = [...new Set(args.sourceKeys.slice(0, 80))];
    const reuseCutoff = Date.now() - FORUM_AGENT_SOURCE_REUSE_COOLDOWN_MS;
    const rows = await Promise.all(
      sourceKeys.map(async (sourceKey) => {
        const used = await ctx.db
          .query("forumAgentSourceUses")
          .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
          .unique();
        return used === null || used.usedAt < reuseCutoff ? null : sourceKey;
      }),
    );
    return rows.filter((sourceKey): sourceKey is string => sourceKey !== null);
  },
});

export const claimSukiForumReplyCandidate = internalMutation({
  args: {
    agentSlug: v.optional(v.union(v.literal("suki"), v.literal("belle"))),
    attempt: v.number(),
    runDate: v.string(),
    runId: v.optional(v.id("forumAgentReplyRuns")),
  },
  handler: async (ctx, args) => {
    const agentSlug = args.agentSlug ?? "suki";
    const agentName = agentSlug === "belle" ? "Belle" : "Suki";
    if (
      !Number.isInteger(args.attempt) ||
      args.attempt < 0 ||
      args.attempt > 2 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(args.runDate)
    ) {
      throw new Error(`Invalid ${agentName} reply run request`);
    }

    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", agentSlug))
      .unique();
    if (agent === null || !agent.enabled) {
      return { claimed: false as const, reason: "disabled" };
    }
    const agentUser = await ctx.db.get(agent.userId);
    if (
      agentUser === null ||
      agentUser.isAgent !== true ||
      agentUser.agentSlug !== agentSlug
    ) {
      throw new Error(`${agentName}'s forum identity is invalid`);
    }

    const dailyRuns = await ctx.db
      .query("forumAgentReplyRuns")
      .withIndex("by_runDate", (q) => q.eq("runDate", args.runDate))
      .take(100);
    const dailyLimitReached =
      dailyRuns.filter(
        (run) => run.agentSlug === agentSlug && run.status === "replied",
      ).length >=
      (agentSlug === "belle"
        ? BELLE_REPLY_DAILY_LIMIT
        : SUKI_REPLY_DAILY_LIMIT);
    if (dailyLimitReached) {
      if (args.runId !== undefined) {
        const queuedRun = await ctx.db.get(args.runId);
        if (queuedRun?.status === "queued") {
          await ctx.db.patch(queuedRun._id, {
            status: "ignored",
            reason: "daily-limit",
            completedAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }
      return { claimed: false as const, reason: "daily-limit" };
    }

    const now = Date.now();
    if (args.runId !== undefined) {
      const run = await ctx.db.get(args.runId);
      if (
        run === null ||
        run.agentSlug !== agentSlug ||
        run.runDate !== args.runDate ||
        run.status === "replied" ||
        run.status === "ignored" ||
        args.attempt <= run.attempt
      ) {
        return { claimed: false as const, reason: "retry-unavailable" };
      }
      if (
        run.status === "running" &&
        now - run.updatedAt < SUKI_REPLY_STALE_RUN_MS
      ) {
        return { claimed: false as const, reason: "already-running" };
      }
      const candidate = await loadSukiReplyCandidate(ctx, run, agent.userId);
      if (candidate === null) {
        await ctx.db.patch(run._id, {
          status: "ignored",
          reason: "source-unavailable",
          completedAt: now,
          updatedAt: now,
        });
        return { claimed: false as const, reason: "source-unavailable" };
      }
      await ctx.db.patch(run._id, {
        attempt: args.attempt,
        status: "running",
        reason: undefined,
        startedAt: now,
        completedAt: undefined,
        updatedAt: now,
      });
      return {
        claimed: true as const,
        runId: run._id,
        candidate,
      };
    }

    const [recentThreads, recentPosts] = await Promise.all([
      ctx.db
        .query("forumThreads")
        .withIndex("by_status_and_lastPostAt", (q) => q.eq("status", "active"))
        .order("desc")
        .take(SUKI_REPLY_SCAN_LIMIT),
      ctx.db
        .query("forumPosts")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", "active"))
        .order("desc")
        .take(SUKI_REPLY_SCAN_LIMIT),
    ]);
    const sources = [
      ...recentThreads.map((thread) => ({
        sourceKind: "thread" as const,
        sourcePostId: undefined,
        sourceId: thread._id as string,
        sourceCreatedAt: thread.createdAt,
        threadId: thread._id,
        categoryId: thread.categoryId,
        authorId: thread.authorId,
      })),
      ...recentPosts.map((post) => ({
        sourceKind: "reply" as const,
        sourcePostId: post._id,
        sourceId: post._id as string,
        sourceCreatedAt: post.createdAt,
        threadId: post.threadId,
        categoryId: post.categoryId,
        authorId: post.authorId,
      })),
    ]
      .filter(
        (source) =>
          now - source.sourceCreatedAt >= SUKI_REPLY_MIN_AGE_MS &&
          now - source.sourceCreatedAt <= SUKI_REPLY_MAX_AGE_MS,
      )
      .sort((left, right) => right.sourceCreatedAt - left.sourceCreatedAt);

    for (const source of sources) {
      const runKey = `forum-reply:${source.sourceKind}:${source.sourceId}`;
      const existing = await ctx.db
        .query("forumAgentReplyRuns")
        .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
        .unique();
      if (existing !== null) {
        continue;
      }
      const provisionalRun: SukiReplyRunSource = {
        sourceKind: source.sourceKind,
        sourcePostId: source.sourcePostId,
        threadId: source.threadId,
        categoryId: source.categoryId,
        authorId: source.authorId,
      };
      const candidate = await loadSukiReplyCandidate(
        ctx,
        provisionalRun,
        agent.userId,
      );
      if (candidate === null) {
        continue;
      }
      if (!forumReplyDeskMatches(agentSlug, candidate.categorySlug)) {
        continue;
      }
      const runId = await ctx.db.insert("forumAgentReplyRuns", {
        runKey,
        agentSlug,
        runDate: args.runDate,
        sourceKind: source.sourceKind,
        sourcePostId: source.sourcePostId,
        threadId: source.threadId,
        categoryId: source.categoryId,
        authorId: source.authorId,
        attempt: args.attempt,
        status: "running",
        model: agent.model,
        startedAt: now,
        updatedAt: now,
      });
      return { claimed: true as const, runId, candidate };
    }

    return { claimed: false as const, reason: "no-candidate" };
  },
});

export const markSukiForumReplyIgnored = internalMutation({
  args: {
    agentSlug: v.optional(v.union(v.literal("suki"), v.literal("belle"))),
    runId: v.id("forumAgentReplyRuns"),
    reason: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const agentSlug = args.agentSlug ?? "suki";
    const run = await ctx.db.get(args.runId);
    if (
      run === null ||
      run.agentSlug !== agentSlug ||
      run.status !== "running"
    ) {
      return { updated: false };
    }
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "ignored",
      reason: compactForumText(args.reason, 160),
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      completedAt: now,
      updatedAt: now,
    });
    return { updated: true };
  },
});

export const markSukiForumReplyFailed = internalMutation({
  args: {
    agentSlug: v.optional(v.union(v.literal("suki"), v.literal("belle"))),
    runId: v.id("forumAgentReplyRuns"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const agentSlug = args.agentSlug ?? "suki";
    const run = await ctx.db.get(args.runId);
    if (
      run === null ||
      run.agentSlug !== agentSlug ||
      run.status !== "running"
    ) {
      return { updated: false };
    }
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "failed",
      reason: compactForumText(args.reason, 160),
      completedAt: now,
      updatedAt: now,
    });
    return { updated: true };
  },
});

export const publishSukiForumReply = internalMutation({
  args: {
    agentSlug: v.optional(v.union(v.literal("suki"), v.literal("belle"))),
    runId: v.id("forumAgentReplyRuns"),
    body: v.string(),
    reason: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const agentSlug = args.agentSlug ?? "suki";
    const agentName = agentSlug === "belle" ? "Belle" : "Suki";
    const run = await ctx.db.get(args.runId);
    if (
      run === null ||
      run.agentSlug !== agentSlug ||
      run.status !== "running"
    ) {
      throw new Error(`${agentName}'s reply run is not active`);
    }
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", agentSlug))
      .unique();
    if (agent === null || !agent.enabled) {
      throw new Error(`${agentName} is disabled`);
    }
    const user = await ctx.db.get(agent.userId);
    if (
      user === null ||
      user.isAgent !== true ||
      user.agentSlug !== agentSlug
    ) {
      throw new Error(`${agentName}'s forum identity is invalid`);
    }
    const candidate = await loadSukiReplyCandidate(ctx, run, user._id);
    const now = Date.now();
    if (candidate === null) {
      await ctx.db.patch(run._id, {
        status: "ignored",
        reason: "source-unavailable",
        completedAt: now,
        updatedAt: now,
      });
      return { status: "ignored" as const, reason: "source-unavailable" };
    }
    const thread = await ctx.db.get(candidate.threadId);
    const category = await ctx.db.get(candidate.categoryId);
    if (
      thread === null ||
      thread.status !== "active" ||
      category === null ||
      category.status !== "active" ||
      categoryViewAccess(category) !== "public"
    ) {
      await ctx.db.patch(run._id, {
        status: "ignored",
        reason: "thread-unavailable",
        completedAt: now,
        updatedAt: now,
      });
      return { status: "ignored" as const, reason: "thread-unavailable" };
    }

    const body = normalizeReplyBody(args.body);
    const postNumber = await nextPostNumberForThread(ctx, thread);
    const postId = await ctx.db.insert("forumPosts", {
      threadId: thread._id,
      categoryId: category._id,
      authorId: user._id,
      body,
      postNumber,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(thread._id, {
      replyCount: thread.replyCount + 1,
      lastAssignedPostNumber: postNumber,
      lastPostId: postId,
      lastPostAt: now,
      lastPostUserId: user._id,
      updatedAt: now,
    });
    await ctx.db.patch(category._id, {
      postCount: category.postCount + 1,
      lastThreadId: thread._id,
      lastPostId: postId,
      lastPostAt: now,
      updatedAt: now,
    });
    await bumpForumUserProfileStats(ctx, user._id, {
      postDelta: 1,
      now,
    });
    await ensureThreadParticipantSubscription(ctx, {
      userId: user._id,
      threadId: thread._id,
      categoryId: category._id,
      now,
    });
    await createReplyNotifications(ctx, {
      actorUserId: user._id,
      categoryId: category._id,
      postId,
      threadId: thread._id,
      now,
    });
    await ctx.db.patch(run._id, {
      status: "replied",
      reason: compactForumText(args.reason, 160),
      replyPostId: postId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      completedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.forumAgentMemory.indexForumThread,
      { threadId: thread._id },
    );

    return {
      status: "replied" as const,
      categorySlug: category.slug,
      threadSlug: thread.slug,
      postId,
      postNumber,
      postPage: pageForPostNumber(postNumber, POST_PAGE_SIZE),
    };
  },
});

async function loadSukiReplyCandidate(
  ctx: MutationCtx,
  source: SukiReplyRunSource,
  sukiUserId: Id<"users">,
): Promise<SukiReplyCandidate | null> {
  const thread = await ctx.db.get(source.threadId);
  if (
    thread === null ||
    thread.status !== "active" ||
    thread.categoryId !== source.categoryId
  ) {
    return null;
  }
  const category = await ctx.db.get(source.categoryId);
  const sukiUser = await ctx.db.get(sukiUserId);
  if (
    category === null ||
    category.status !== "active" ||
    !isBoardCategory(category) ||
    categoryViewAccess(category) !== "public" ||
    !(await canViewCategoryWithAncestors(ctx, null, category)) ||
    sukiUser === null ||
    !canReplyInCategory(sukiUser, category, false)
  ) {
    return null;
  }

  let sourceBody: string;
  let sourceCreatedAt: number;
  let sourcePostNumber: number;
  if (source.sourceKind === "thread") {
    if (
      source.sourcePostId !== undefined ||
      thread.authorId !== source.authorId
    ) {
      return null;
    }
    sourceBody = thread.body;
    sourceCreatedAt = thread.createdAt;
    sourcePostNumber = 1;
  } else {
    if (source.sourcePostId === undefined) {
      return null;
    }
    const post = await ctx.db.get(source.sourcePostId);
    if (
      post === null ||
      post.status !== "active" ||
      post.threadId !== thread._id ||
      post.categoryId !== category._id ||
      post.authorId !== source.authorId
    ) {
      return null;
    }
    sourceBody = post.body;
    sourceCreatedAt = post.createdAt;
    sourcePostNumber = post.postNumber ?? 2;
  }

  const author = await ctx.db.get(source.authorId);
  if (
    author === null ||
    author._id === sukiUserId ||
    author.isAgent === true ||
    !isSukiReplyWorthReviewing(sourceBody)
  ) {
    return null;
  }

  const recentPosts = await ctx.db
    .query("forumPosts")
    .withIndex("by_threadId_and_status_and_createdAt", (q) =>
      q.eq("threadId", thread._id).eq("status", "active"),
    )
    .order("desc")
    .take(12);
  if (
    recentPosts.some(
      (post) =>
        post.authorId === sukiUserId && post.createdAt > sourceCreatedAt,
    )
  ) {
    return null;
  }
  const contextualPosts = recentPosts
    .filter(
      (post) =>
        source.sourceKind === "thread" || post.createdAt <= sourceCreatedAt,
    )
    .slice(0, 6)
    .reverse();
  const contextualAuthors = await Promise.all(
    contextualPosts.map((post) => ctx.db.get(post.authorId)),
  );

  return {
    sourceKind: source.sourceKind,
    sourcePostId: source.sourcePostId,
    sourcePostNumber,
    sourceCreatedAt,
    threadId: thread._id,
    categoryId: category._id,
    authorId: author._id,
    authorName: displayName(author),
    categoryName: category.name,
    categorySlug: category.slug,
    threadTitle: thread.title,
    threadBody: compactForumText(thread.body, 4_000),
    sourceBody: compactForumText(sourceBody, 3_000),
    recentPosts: contextualPosts.map((post, index) => ({
      authorName: displayName(contextualAuthors[index]),
      body: compactForumText(post.body, 1_500),
      postNumber: post.postNumber ?? 2,
    })),
  };
}

export function isSukiReplyWorthReviewing(body: string) {
  const text = body
    .replace(/\[(?:\/?)[a-z0-9*]+(?:=[^\]]*)?\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 18 || /(.)\1{7,}/.test(text)) {
    return false;
  }
  if (
    /^(?:thanks?|thank you|cool|nice|great|awesome|lol|lmao|same|agreed|following|bump|first|ok(?:ay)?|yes|no)[.!?\s]*$/i.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /\b(?:buy followers?|casino|crypto giveaway|dm me|guest post|promo code|seo services?|telegram\s*@|whatsapp|work from home)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  const links = text.match(/https?:\/\/\S+/gi) ?? [];
  if (links.length > 2) {
    return false;
  }
  const words =
    text.replace(/https?:\/\/\S+/gi, " ").match(/[a-z0-9][a-z0-9'_-]*/gi) ?? [];
  if (links.length > 0 && words.length < 8) {
    return false;
  }
  if (text.includes("?")) {
    return words.length >= 4;
  }
  return text.length >= 45 && words.length >= 7;
}

function forumReplyDeskMatches(
  agentSlug: "suki" | "belle",
  categorySlug: string,
) {
  const belleDesk =
    categorySlug === "news" ||
    categorySlug.startsWith("news-") ||
    categorySlug === "hacking-security-news" ||
    categorySlug === "music-scenes" ||
    categorySlug === "music-new-releases";
  return agentSlug === "belle" ? belleDesk : !belleDesk;
}

async function scheduleForumAgentReview(
  ctx: MutationCtx,
  args: {
    sourceKind: "thread" | "reply";
    sourcePostId?: Id<"forumPosts">;
    threadId: Id<"forumThreads">;
    categoryId: Id<"forumCategories">;
    authorId: Id<"users">;
    now: number;
  },
) {
  const [category, author] = await Promise.all([
    ctx.db.get(args.categoryId),
    ctx.db.get(args.authorId),
  ]);
  if (
    category === null ||
    category.status !== "active" ||
    author === null ||
    author.isAgent === true
  ) {
    return null;
  }
  const agentSlug = forumReplyDeskMatches("belle", category.slug)
    ? "belle"
    : "suki";
  const sourceId =
    args.sourceKind === "reply" ? args.sourcePostId : args.threadId;
  if (sourceId === undefined) return null;
  const runKey = `forum-reply:${args.sourceKind}:${sourceId}`;
  const existing = await ctx.db
    .query("forumAgentReplyRuns")
    .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
    .unique();
  if (existing !== null) return existing._id;
  const agent = await ctx.db
    .query("forumAgents")
    .withIndex("by_slug", (q) => q.eq("slug", agentSlug))
    .unique();
  if (agent === null || !agent.enabled) return null;
  const runId = await ctx.db.insert("forumAgentReplyRuns", {
    runKey,
    agentSlug,
    runDate: forumAgentDateForTimestamp(args.now),
    sourceKind: args.sourceKind,
    sourcePostId: args.sourcePostId,
    threadId: args.threadId,
    categoryId: args.categoryId,
    authorId: args.authorId,
    attempt: -1,
    status: "queued",
    model: agent.model,
    reason: "event-queued",
    startedAt: args.now,
    updatedAt: args.now,
  });
  await ctx.scheduler.runAfter(
    SUKI_REPLY_MIN_AGE_MS,
    agentSlug === "belle"
      ? internal.sukiForumReplyAgent.runBelleReplySweep
      : internal.sukiForumReplyAgent.runReplySweep,
    {
      attempt: 0,
      runDate: forumAgentDateForTimestamp(args.now),
      runId,
    },
  );
  return runId;
}

function forumAgentDateForTimestamp(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function compactForumText(value: string, maximumLength: number) {
  const normalized = value.replace(/\u0000/g, "").trim();
  return normalized.length <= maximumLength
    ? normalized
    : `${normalized.slice(0, maximumLength - 1).trimEnd()}…`;
}

export const publishSukiForumThread = internalMutation({
  args: {
    agentSlug: v.optional(v.string()),
    runKey: v.string(),
    categorySlug: v.string(),
    prefixSlug: v.optional(v.string()),
    title: v.string(),
    body: v.string(),
    poll: v.optional(
      v.object({
        question: v.string(),
        options: v.array(v.string()),
      }),
    ),
    sources: v.array(
      v.object({
        sourceKey: v.string(),
        sourceUrl: v.string(),
      }),
    ),
    attachment: v.optional(
      v.object({
        storageId: v.id("_storage"),
        filename: v.string(),
        contentType: v.string(),
        size: v.number(),
        altText: v.optional(v.string()),
        credit: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
      }),
    ),
    candidateCount: v.number(),
    contentFormat: v.optional(v.string()),
    topicFingerprint: v.optional(v.string()),
    qualityScore: v.optional(v.number()),
    groundingScore: v.optional(v.number()),
    noveltyScore: v.optional(v.number()),
    utilityScore: v.optional(v.number()),
    imageScore: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const agentSlug = args.agentSlug ?? "suki";
    const agentName = forumAgentNameFromSlug(agentSlug);
    const run = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (
      run === null ||
      run.status !== "running" ||
      run.agentSlug !== agentSlug
    ) {
      throw new Error(`${agentName}'s forum run is not active`);
    }
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", agentSlug))
      .unique();
    if (agent === null || !agent.enabled) {
      throw new Error(`${agentName} is disabled`);
    }
    const user = await ctx.db.get(agent.userId);
    if (
      user === null ||
      user.isAgent !== true ||
      user.agentSlug !== agentSlug
    ) {
      throw new Error(`${agentName}'s forum identity is invalid`);
    }
    const category = await ctx.db
      .query("forumCategories")
      .withIndex("by_slug", (q) => q.eq("slug", args.categorySlug))
      .unique();
    if (
      category === null ||
      !isBoardCategory(category) ||
      category.status !== "active" ||
      categoryViewAccess(category) !== "public"
    ) {
      throw new Error(`${agentName} selected an unavailable forum board`);
    }

    const title = normalizeTitle(args.title);
    const body = normalizeThreadBody(args.body);
    const poll = normalizePollInput(args.poll);
    const sources = args.sources.slice(0, 12);
    if (sources.length === 0) {
      throw new Error(`${agentName} must cite at least one source`);
    }
    if (
      args.attachment === undefined &&
      !/\[(?:chart|table|timeline|decision|riskmap|steps|sourcecards)(?:=|\])/i.test(
        body,
      )
    ) {
      throw new Error(
        `${agentName}'s forum topic must include an image, chart, or comparison table`,
      );
    }
    const sourceReuseCutoff = Date.now() - FORUM_AGENT_SOURCE_REUSE_COOLDOWN_MS;
    const previousSourceUses = new Map<string, ForumAgentSourceUseDoc | null>();
    for (const source of sources) {
      const existingUse = await ctx.db
        .query("forumAgentSourceUses")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", source.sourceKey))
        .unique();
      previousSourceUses.set(source.sourceKey, existingUse);
      if (existingUse !== null && existingUse.usedAt >= sourceReuseCutoff) {
        throw new Error(
          `${agentName} selected a source that already has a recent thread`,
        );
      }
    }
    const recentThreads = await ctx.db
      .query("forumThreads")
      .withIndex("by_categoryId_and_status_and_lastPostAt", (q) =>
        q.eq("categoryId", category._id).eq("status", "active"),
      )
      .order("desc")
      .take(30);
    const normalizedTitle = title.trim().toLowerCase();
    if (
      recentThreads.some(
        (thread) => thread.title.trim().toLowerCase() === normalizedTitle,
      )
    ) {
      throw new Error(`${agentName} selected a duplicate thread title`);
    }

    const prefix =
      args.prefixSlug === undefined
        ? null
        : await ctx.db
            .query("forumThreadPrefixes")
            .withIndex("by_key", (q) =>
              q.eq("key", threadPrefixKey(undefined, args.prefixSlug ?? "")),
            )
            .unique();
    const usablePrefix = prefix?.status === "active" ? prefix : null;
    const now = Date.now();
    const slug = await generateUniqueThreadSlug(ctx, category.slug, title);
    const threadId = await ctx.db.insert("forumThreads", {
      categoryId: category._id,
      categorySlug: category.slug,
      ...threadPrefixSnapshot(usablePrefix),
      slug,
      title,
      body,
      authorId: user._id,
      status: "active",
      pinned: false,
      replyCount: 0,
      lastAssignedPostNumber: 1,
      viewCount: 0,
      lastPostAt: now,
      lastPostUserId: user._id,
      searchText: buildThreadSearchText(
        category,
        title,
        [
          usablePrefix?.label,
          body,
          ...(poll === null ? [] : [poll.question, ...poll.options]),
        ]
          .filter((part): part is string => Boolean(part))
          .join("\n"),
        displayName(user),
      ),
      createdAt: now,
      updatedAt: now,
    });

    if (poll !== null) {
      const pollId = await ctx.db.insert("forumPolls", {
        threadId,
        categoryId: category._id,
        question: poll.question,
        status: "open",
        optionCount: poll.options.length,
        totalVotes: 0,
        createdAt: now,
        updatedAt: now,
      });
      for (const [position, label] of poll.options.entries()) {
        await ctx.db.insert("forumPollOptions", {
          pollId,
          threadId,
          label,
          position,
          voteCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (args.attachment !== undefined) {
      const metadata = await ctx.db.system.get(
        "_storage",
        args.attachment.storageId,
      );
      if (
        metadata === null ||
        metadata.size !== args.attachment.size ||
        metadata.contentType !== args.attachment.contentType ||
        !args.attachment.contentType.startsWith("image/") ||
        args.attachment.size > FORUM_ATTACHMENT_MAX_FILE_BYTES
      ) {
        throw new Error(`${agentName}'s cached image is invalid`);
      }
      await ctx.db.insert("forumAttachments", {
        threadId,
        categoryId: category._id,
        authorId: user._id,
        storageId: args.attachment.storageId,
        filename: normalizeForumAttachmentFilename(args.attachment.filename),
        contentType: args.attachment.contentType,
        size: args.attachment.size,
        altText: cleanOptional(args.attachment.altText, 240),
        credit: cleanOptional(args.attachment.credit, 240),
        sourceUrl: cleanOptionalForumUrl(
          args.attachment.sourceUrl,
          500,
          "Image source",
        ),
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(category._id, {
      threadCount: category.threadCount + 1,
      postCount: category.postCount + 1,
      lastThreadId: threadId,
      lastPostId: undefined,
      lastPostAt: now,
      updatedAt: now,
    });
    await bumpForumUserProfileStats(ctx, user._id, {
      threadDelta: 1,
      postDelta: 1,
      now,
    });
    await createNewThreadNotifications(ctx, {
      actorUserId: user._id,
      categoryId: category._id,
      threadId,
      now,
    });
    for (const source of sources) {
      const previousUse = previousSourceUses.get(source.sourceKey);
      if (previousUse === null || previousUse === undefined) {
        await ctx.db.insert("forumAgentSourceUses", {
          sourceKey: source.sourceKey,
          sourceUrl: source.sourceUrl,
          agentSlug,
          categoryId: category._id,
          threadId,
          usedAt: now,
        });
      } else {
        await ctx.db.patch(previousUse._id, {
          sourceUrl: source.sourceUrl,
          agentSlug,
          categoryId: category._id,
          threadId,
          usedAt: now,
        });
      }
    }
    await ctx.db.patch(run._id, {
      status: "published",
      candidateCount: args.candidateCount,
      categoryId: category._id,
      categorySlug: category.slug,
      threadId,
      title,
      sourceUrls: sources.map((source) => source.sourceUrl),
      imageSourceUrl: args.attachment?.sourceUrl,
      contentFormat: args.contentFormat,
      topicFingerprint: args.topicFingerprint,
      qualityScore: args.qualityScore,
      groundingScore: args.groundingScore,
      noveltyScore: args.noveltyScore,
      utilityScore: args.utilityScore,
      imageScore: args.imageScore,
      sourceCount: sources.length,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      completedAt: now,
      updatedAt: now,
      errorMessage: undefined,
    });
    const [sourceReservations, topicReservations] = await Promise.all([
      ctx.db
        .query("forumAgentSourceReservations")
        .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
        .take(3),
      ctx.db
        .query("forumAgentTopicReservations")
        .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
        .take(1),
    ]);
    for (const reservation of sourceReservations) {
      await ctx.db.patch(reservation._id, {
        status: "published",
        threadId,
        expiresAt: now + FORUM_AGENT_SOURCE_REUSE_COOLDOWN_MS,
        updatedAt: now,
      });
    }
    for (const reservation of topicReservations) {
      await ctx.db.patch(reservation._id, {
        status: "published",
        threadId,
        expiresAt: now + FORUM_AGENT_SOURCE_REUSE_COOLDOWN_MS,
        updatedAt: now,
      });
    }
    await ctx.scheduler.runAfter(
      0,
      internal.forumAgentMemory.indexForumThread,
      { threadId },
    );

    return {
      categorySlug: category.slug,
      threadId,
      threadSlug: slug,
      title,
    };
  },
});

export const publishForumAgentFollowUp = internalMutation({
  args: {
    agentSlug: v.string(),
    runKey: v.string(),
    threadId: v.id("forumThreads"),
    title: v.string(),
    body: v.string(),
    sources: v.array(
      v.object({
        sourceKey: v.string(),
        sourceUrl: v.string(),
      }),
    ),
    attachment: v.optional(
      v.object({
        storageId: v.id("_storage"),
        filename: v.string(),
        contentType: v.string(),
        size: v.number(),
        altText: v.optional(v.string()),
        credit: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
      }),
    ),
    candidateCount: v.number(),
    contentFormat: v.optional(v.string()),
    topicFingerprint: v.optional(v.string()),
    qualityScore: v.optional(v.number()),
    groundingScore: v.optional(v.number()),
    noveltyScore: v.optional(v.number()),
    utilityScore: v.optional(v.number()),
    imageScore: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (
      run === null ||
      run.status !== "running" ||
      run.agentSlug !== args.agentSlug
    ) {
      throw new Error("Forum follow-up run is not active");
    }
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", args.agentSlug))
      .unique();
    const thread = await ctx.db.get(args.threadId);
    if (
      agent === null ||
      !agent.enabled ||
      thread === null ||
      thread.status !== "active"
    ) {
      throw new Error("Forum follow-up target is unavailable");
    }
    const user = await ctx.db.get(agent.userId);
    const category = await ctx.db.get(thread.categoryId);
    if (
      user === null ||
      user.isAgent !== true ||
      user.agentSlug !== args.agentSlug ||
      thread.authorId !== user._id ||
      category === null ||
      category.status !== "active" ||
      categoryViewAccess(category) !== "public"
    ) {
      throw new Error("Forum follow-up identity or board is invalid");
    }
    const sources = args.sources.slice(0, 6);
    if (sources.length === 0) {
      throw new Error("A forum follow-up needs at least one source");
    }
    const body = normalizeReplyBody(args.body);
    const now = Date.now();
    const postNumber = await nextPostNumberForThread(ctx, thread);
    const postId = await ctx.db.insert("forumPosts", {
      threadId: thread._id,
      categoryId: category._id,
      authorId: user._id,
      body,
      postNumber,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(thread._id, {
      replyCount: thread.replyCount + 1,
      lastAssignedPostNumber: postNumber,
      lastPostId: postId,
      lastPostAt: now,
      lastPostUserId: user._id,
      updatedAt: now,
    });
    await ctx.db.patch(category._id, {
      postCount: category.postCount + 1,
      lastThreadId: thread._id,
      lastPostId: postId,
      lastPostAt: now,
      updatedAt: now,
    });
    await bumpForumUserProfileStats(ctx, user._id, {
      postDelta: 1,
      now,
    });
    for (const source of sources) {
      const previousUse = await ctx.db
        .query("forumAgentSourceUses")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", source.sourceKey))
        .unique();
      if (previousUse === null) {
        await ctx.db.insert("forumAgentSourceUses", {
          sourceKey: source.sourceKey,
          sourceUrl: source.sourceUrl,
          agentSlug: args.agentSlug,
          categoryId: category._id,
          threadId: thread._id,
          usedAt: now,
        });
      }
    }
    await ctx.db.patch(run._id, {
      status: "published",
      candidateCount: args.candidateCount,
      categoryId: category._id,
      categorySlug: category.slug,
      threadId: thread._id,
      title: thread.title,
      sourceUrls: sources.map((source) => source.sourceUrl),
      contentFormat: "follow-up",
      topicFingerprint: args.topicFingerprint,
      qualityScore: args.qualityScore,
      groundingScore: args.groundingScore,
      noveltyScore: args.noveltyScore,
      utilityScore: args.utilityScore,
      imageScore: 0,
      sourceCount: sources.length,
      followUpPostId: postId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      completedAt: now,
      updatedAt: now,
      errorMessage: undefined,
    });
    const [sourceReservations, topicReservations] = await Promise.all([
      ctx.db
        .query("forumAgentSourceReservations")
        .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
        .take(3),
      ctx.db
        .query("forumAgentTopicReservations")
        .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
        .take(1),
    ]);
    for (const reservation of sourceReservations) {
      await ctx.db.patch(reservation._id, {
        status: "published",
        threadId: thread._id,
        expiresAt: now + FORUM_AGENT_SOURCE_REUSE_COOLDOWN_MS,
        updatedAt: now,
      });
    }
    for (const reservation of topicReservations) {
      await ctx.db.patch(reservation._id, {
        status: "published",
        threadId: thread._id,
        expiresAt: now + FORUM_AGENT_SOURCE_REUSE_COOLDOWN_MS,
        updatedAt: now,
      });
    }
    await ctx.scheduler.runAfter(
      0,
      internal.forumAgentMemory.indexForumThread,
      { threadId: thread._id },
    );
    return {
      categorySlug: category.slug,
      threadSlug: thread.slug,
      title: thread.title,
      postId,
      postNumber,
    };
  },
});

async function ensureDefaultForumCategory(
  ctx: MutationCtx,
  args: {
    description: string;
    kind: ForumCategoryKind;
    now: number;
    name: string;
    parentCategoryId?: Id<"forumCategories">;
    pollAccess: ForumCategoryWriteAccess;
    position: number;
    replyAccess: ForumCategoryWriteAccess;
    slug: string;
    status: ForumCategoryDoc["status"];
    threadAccess: ForumCategoryWriteAccess;
    viewAccess: ForumCategoryViewAccess;
  },
) {
  const existing = await ctx.db
    .query("forumCategories")
    .withIndex("by_slug", (q) => q.eq("slug", args.slug))
    .unique();
  if (existing !== null) {
    return { category: existing, created: false };
  }

  const categoryId = await ctx.db.insert("forumCategories", {
    slug: args.slug,
    name: args.name,
    description: args.description,
    kind: args.kind,
    parentCategoryId: args.parentCategoryId,
    status: args.status,
    viewAccess: args.viewAccess,
    threadAccess: args.threadAccess,
    replyAccess: args.replyAccess,
    pollAccess: args.pollAccess,
    position: args.position,
    threadCount: 0,
    postCount: 0,
    createdAt: args.now,
    updatedAt: args.now,
  });
  const category = await ctx.db.get(categoryId);
  if (category === null) {
    throw new Error("Default forum category could not be reloaded");
  }
  return { category, created: true };
}

async function availableSukiUsername(ctx: MutationCtx, now: number) {
  return await availableForumAgentUsername(ctx, {
    baseName: "Suki",
    baseSlug: "suki",
    now,
  });
}

async function availableForumAgentUsername(
  ctx: MutationCtx,
  args: {
    baseName: string;
    baseSlug: string;
    now: number;
  },
) {
  const candidates = [
    { username: args.baseName, usernameNormalized: args.baseSlug },
    {
      username: `${args.baseName} Agent`,
      usernameNormalized: `${args.baseSlug}-agent`,
    },
    ...Array.from({ length: 8 }, (_, index) => {
      const suffix = (args.now + index).toString(36);
      return {
        username: `${args.baseName} Agent ${suffix}`,
        usernameNormalized: `${args.baseSlug}-agent-${suffix}`,
      };
    }),
  ];
  for (const candidate of candidates) {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", candidate.usernameNormalized),
      )
      .first();
    if (owner === null) {
      return candidate;
    }
  }
  throw new Error(`${args.baseName}'s forum username could not be allocated`);
}

async function ensureSukiForumTaxonomy(ctx: MutationCtx, now: number) {
  const createdCategoryIds: Id<"forumCategories">[] = [];
  const categoryIds: Id<"forumCategories">[] = [];
  const boardsBySlug = new Map<string, ForumCategoryDoc>();
  const section = await ensureDefaultForumCategory(ctx, {
    slug: "symbaiex",
    name: "SYMBaiEX",
    description:
      "A navigable library and conversation deck for builders, researchers, players, listeners, and curious people.",
    kind: "section",
    status: "active",
    viewAccess: "public",
    threadAccess: "closed",
    replyAccess: "closed",
    pollAccess: "closed",
    position: 0,
    now,
  });
  categoryIds.push(section.category._id);
  if (section.created) {
    createdCategoryIds.push(section.category._id);
  }
  await migrateEmptyLegacyNewsBoardSlug(ctx, now);

  for (const parent of SUKI_FORUM_TAXONOMY) {
    const parentResult = await ensureDefaultForumCategory(ctx, {
      slug: parent.slug,
      name: parent.name,
      description: parent.description,
      kind: "board",
      parentCategoryId: section.category._id,
      status: "active",
      viewAccess: "public",
      threadAccess: "members",
      replyAccess: "members",
      pollAccess: "members",
      position: parent.position,
      now,
    });
    categoryIds.push(parentResult.category._id);
    boardsBySlug.set(parentResult.category.slug, parentResult.category);
    if (parentResult.created) {
      createdCategoryIds.push(parentResult.category._id);
    }

    for (const child of parent.children) {
      const childResult = await ensureDefaultForumCategory(ctx, {
        slug: child.slug,
        name: child.name,
        description: child.description,
        kind: "board",
        parentCategoryId: parentResult.category._id,
        status: "active",
        viewAccess: "public",
        threadAccess: "members",
        replyAccess: "members",
        pollAccess: "members",
        position: child.position,
        now,
      });
      categoryIds.push(childResult.category._id);
      boardsBySlug.set(childResult.category.slug, childResult.category);
      if (childResult.created) {
        createdCategoryIds.push(childResult.category._id);
      }
    }
  }

  return {
    boardsBySlug,
    categoryIds,
    createdCategoryIds,
    section: section.category,
  };
}

async function migrateEmptyLegacyNewsBoardSlug(ctx: MutationCtx, now: number) {
  const canonical = await ctx.db
    .query("forumCategories")
    .withIndex("by_slug", (q) => q.eq("slug", "forum-news"))
    .unique();
  if (canonical !== null) {
    return;
  }
  const legacy = await ctx.db
    .query("forumCategories")
    .withIndex("by_slug", (q) => q.eq("slug", "news"))
    .unique();
  if (legacy === null || legacy.threadCount !== 0 || legacy.postCount !== 0) {
    return;
  }
  await ctx.db.patch(legacy._id, {
    slug: "forum-news",
    updatedAt: now,
  });
}

async function ensureDefaultForumPrefixes(ctx: MutationCtx, now: number) {
  const defaults = [
    {
      slug: "release",
      label: "Release",
      description: "Shipping notes, changelogs, and production updates.",
      color: "#ff3ea5",
      position: 0,
    },
    {
      slug: "question",
      label: "Question",
      description: "Requests for help, clarification, or recommendations.",
      color: "#81d8d0",
      position: 1,
    },
    {
      slug: "research",
      label: "Research",
      description: "Longer technical notes, references, and experiments.",
      color: "#ffe14d",
      position: 2,
    },
    {
      slug: "showcase",
      label: "Showcase",
      description: "Share a build, prototype, artifact, or finished piece.",
      color: "#f5f5f5",
      position: 3,
    },
    {
      slug: "news",
      label: "News",
      description:
        "A sourced update with original context and useful analysis.",
      color: "#81d8d0",
      position: 4,
    },
    {
      slug: "guide",
      label: "Guide",
      description:
        "A practical walkthrough, checklist, or field-tested workflow.",
      color: "#ffe14d",
      position: 5,
    },
    {
      slug: "discussion",
      label: "Discussion",
      description:
        "A focused conversation starter with enough context to engage.",
      color: "#ff3ea5",
      position: 6,
    },
    {
      slug: "resource",
      label: "Resource",
      description: "A useful collection of links, references, or downloads.",
      color: "#f5f5f5",
      position: 7,
    },
  ];
  const createdPrefixIds: Id<"forumThreadPrefixes">[] = [];

  for (const prefix of defaults) {
    const key = threadPrefixKey(undefined, prefix.slug);
    const existing = await ctx.db
      .query("forumThreadPrefixes")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing !== null) {
      continue;
    }
    createdPrefixIds.push(
      await ctx.db.insert("forumThreadPrefixes", {
        key,
        slug: prefix.slug,
        label: prefix.label,
        description: prefix.description,
        color: prefix.color,
        status: "active",
        position: prefix.position,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  return createdPrefixIds;
}

async function ensureDefaultForumAnnouncements(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  now: number,
) {
  const defaults = [
    {
      slug: "welcome",
      title: "Welcome to the SYMBaiEX forum",
      body: "This is the public board index for long-running discussion, build logs, and old-web notes.\n\nUse the User CP to set a title, signature, avatar, notification settings, buddies, and ignored members.",
      position: 0,
    },
  ];
  const createdAnnouncementIds: Id<"forumAnnouncements">[] = [];

  for (const announcement of defaults) {
    const key = forumAnnouncementKey(undefined, announcement.slug);
    const existing = await ctx.db
      .query("forumAnnouncements")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing !== null) {
      continue;
    }
    createdAnnouncementIds.push(
      await ctx.db.insert("forumAnnouncements", {
        key,
        slug: announcement.slug,
        title: announcement.title,
        body: announcement.body,
        status: "active",
        position: announcement.position,
        createdBy: actorUserId,
        updatedBy: actorUserId,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  return createdAnnouncementIds;
}

async function ensureDefaultForumHelpDocuments(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  now: number,
) {
  const defaults = [
    {
      slug: "posting-guide",
      title: "Posting guide",
      body: "Start threads in the board that best fits the topic. Keep titles specific enough that the archive remains useful.\n\nSupported classic markup includes bold, italic, underline, strike, quote, code, link, image, list, and smilie shortcuts.",
      position: 0,
    },
    {
      slug: "accounts-and-private-messages",
      title: "Accounts and private messages",
      body: "Forum profiles use your SYM handle. The User CP controls profile copy, custom titles, signatures, notification preferences, buddies, ignored members, and private messages.\n\nPrivate messages are available to trusted forum members.",
      position: 1,
    },
    {
      slug: "moderation",
      title: "Moderation",
      body: "Use reports for spam, abuse, off-topic posts, private-message issues, or anything that needs a moderator review.\n\nModerators can hide, restore, lock, pin, move, split, merge, warn, and review forum activity from the Moderator CP.",
      position: 2,
    },
  ];
  const createdHelpDocumentIds: Id<"forumHelpDocuments">[] = [];

  for (const document of defaults) {
    const existing = await ctx.db
      .query("forumHelpDocuments")
      .withIndex("by_slug", (q) => q.eq("slug", document.slug))
      .unique();
    if (existing !== null) {
      continue;
    }
    createdHelpDocumentIds.push(
      await ctx.db.insert("forumHelpDocuments", {
        slug: document.slug,
        title: document.title,
        body: document.body,
        status: "active",
        position: document.position,
        createdBy: actorUserId,
        updatedBy: actorUserId,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  return createdHelpDocumentIds;
}

async function ensureDefaultForumBoardRules(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  categories: ForumCategoryDoc[],
  now: number,
) {
  const bodyBySlug = new Map([
    [
      "general",
      "Keep introductions, site discussion, and broad conversation readable for future members.\n\nNo spam, harassment, doxxing, or drive-by low-effort noise.",
    ],
    [
      "projects",
      "Post build logs, experiments, demos, and project updates here.\n\nInclude enough context for someone reading the thread later to understand what changed and why.",
    ],
    [
      "research",
      "Use this board for technical references, protocol notes, math, AI systems, and durable research threads.\n\nCite sources when useful and separate speculation from verified results.",
    ],
  ]);
  const createdBoardRulesIds: Id<"forumBoardRules">[] = [];

  for (const category of categories) {
    const existingActive = await activeBoardRulesForCategory(ctx, category._id);
    if (existingActive !== null) {
      continue;
    }
    const body = bodyBySlug.get(category.slug);
    if (!body) {
      continue;
    }
    createdBoardRulesIds.push(
      await ctx.db.insert("forumBoardRules", {
        categoryId: category._id,
        title: `${category.name} rules`,
        body,
        status: "active",
        createdBy: actorUserId,
        updatedBy: actorUserId,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  return createdBoardRulesIds;
}

export const listForumThreads = query({
  args: {
    categoryId: v.optional(v.id("forumCategories")),
    status: v.optional(threadStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAnyForumModerator(ctx);
    const limit = clampLimit(
      args.limit,
      THREAD_ADMIN_LIST_LIMIT,
      THREAD_ADMIN_LIST_LIMIT,
    );
    const scopedCategoryIds = canModerate(actor)
      ? null
      : await loadModeratedCategoryIdsForUser(ctx, actor._id);

    const threads =
      scopedCategoryIds === null
        ? args.categoryId !== undefined && args.status !== undefined
          ? await ctx.db
              .query("forumThreads")
              .withIndex("by_categoryId_and_status_and_lastPostAt", (q) =>
                q.eq("categoryId", args.categoryId!).eq("status", args.status!),
              )
              .order("desc")
              .take(limit)
          : args.categoryId !== undefined
            ? await ctx.db
                .query("forumThreads")
                .withIndex("by_categoryId_and_lastPostAt", (q) =>
                  q.eq("categoryId", args.categoryId!),
                )
                .order("desc")
                .take(limit)
            : args.status !== undefined
              ? await ctx.db
                  .query("forumThreads")
                  .withIndex("by_status_and_lastPostAt", (q) =>
                    q.eq("status", args.status!),
                  )
                  .order("desc")
                  .take(limit)
              : await ctx.db
                  .query("forumThreads")
                  .withIndex("by_lastPostAt")
                  .order("desc")
                  .take(limit)
        : scopedCategoryIds.length === 0 ||
            (args.categoryId !== undefined &&
              !includesCategoryId(scopedCategoryIds, args.categoryId))
          ? []
          : (
              await Promise.all(
                (args.categoryId === undefined
                  ? scopedCategoryIds
                  : [args.categoryId]
                ).map((categoryId) =>
                  args.status === undefined
                    ? ctx.db
                        .query("forumThreads")
                        .withIndex("by_categoryId_and_lastPostAt", (q) =>
                          q.eq("categoryId", categoryId),
                        )
                        .order("desc")
                        .take(limit)
                    : ctx.db
                        .query("forumThreads")
                        .withIndex(
                          "by_categoryId_and_status_and_lastPostAt",
                          (q) =>
                            q
                              .eq("categoryId", categoryId)
                              .eq("status", args.status!),
                        )
                        .order("desc")
                        .take(limit),
                ),
              )
            )
              .flatMap((rows) => rows)
              .sort((left, right) => right.lastPostAt - left.lastPostAt)
              .slice(0, limit);

    const categoriesById = await loadCategoriesById(
      ctx,
      threads.map((thread) => thread.categoryId),
    );
    const authorsById = await loadUserNamesById(ctx, [
      ...threads.map((thread) => thread.authorId),
      ...threads.map((thread) => thread.lastPostUserId),
    ]);

    return threads.map((thread) =>
      adminThreadListRecord(
        thread,
        categoriesById.get(thread.categoryId),
        authorsById.get(thread.authorId),
        authorsById.get(thread.lastPostUserId),
      ),
    );
  },
});

export const listForumPosts = query({
  args: {
    threadId: v.optional(v.id("forumThreads")),
    status: v.optional(postStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAnyForumModerator(ctx);
    const limit = clampLimit(
      args.limit,
      SEARCH_RESULT_LIMIT,
      THREAD_ADMIN_LIST_LIMIT,
    );
    const scopedCategoryIds = canModerate(actor)
      ? null
      : await loadModeratedCategoryIdsForUser(ctx, actor._id);
    if (args.threadId !== undefined && scopedCategoryIds !== null) {
      const thread = await ctx.db.get(args.threadId);
      if (
        thread === null ||
        !includesCategoryId(scopedCategoryIds, thread.categoryId)
      ) {
        return [];
      }
    }

    const posts =
      scopedCategoryIds === null
        ? args.threadId !== undefined && args.status !== undefined
          ? await ctx.db
              .query("forumPosts")
              .withIndex("by_threadId_and_status_and_createdAt", (q) =>
                q.eq("threadId", args.threadId!).eq("status", args.status!),
              )
              .order("desc")
              .take(limit)
          : args.threadId !== undefined
            ? await ctx.db
                .query("forumPosts")
                .withIndex("by_threadId_and_createdAt", (q) =>
                  q.eq("threadId", args.threadId!),
                )
                .order("desc")
                .take(limit)
            : args.status !== undefined
              ? await ctx.db
                  .query("forumPosts")
                  .withIndex("by_status_and_createdAt", (q) =>
                    q.eq("status", args.status!),
                  )
                  .order("desc")
                  .take(limit)
              : await ctx.db
                  .query("forumPosts")
                  .withIndex("by_status_and_createdAt", (q) =>
                    q.eq("status", "pending"),
                  )
                  .order("desc")
                  .take(limit)
        : args.threadId !== undefined
          ? args.status !== undefined
            ? await ctx.db
                .query("forumPosts")
                .withIndex("by_threadId_and_status_and_createdAt", (q) =>
                  q.eq("threadId", args.threadId!).eq("status", args.status!),
                )
                .order("desc")
                .take(limit)
            : await ctx.db
                .query("forumPosts")
                .withIndex("by_threadId_and_createdAt", (q) =>
                  q.eq("threadId", args.threadId!),
                )
                .order("desc")
                .take(limit)
          : scopedCategoryIds.length === 0
            ? []
            : (
                await Promise.all(
                  scopedCategoryIds.map((categoryId) =>
                    ctx.db
                      .query("forumPosts")
                      .withIndex(
                        "by_categoryId_and_status_and_createdAt",
                        (q) =>
                          q
                            .eq("categoryId", categoryId)
                            .eq("status", args.status ?? "pending"),
                      )
                      .order("desc")
                      .take(limit),
                  ),
                )
              )
                .flatMap((rows) => rows)
                .sort((left, right) => right.createdAt - left.createdAt)
                .slice(0, limit);

    const threadsById = await loadThreadsById(
      ctx,
      posts.map((post) => post.threadId),
    );
    const categoriesById = await loadCategoriesById(
      ctx,
      Array.from(threadsById.values()).map((thread) => thread.categoryId),
    );
    const authorsById = await loadUserNamesById(
      ctx,
      posts.map((post) => post.authorId),
    );

    return posts.map((post) => {
      const thread = threadsById.get(post.threadId);
      const category =
        thread === undefined
          ? undefined
          : categoriesById.get(thread.categoryId);

      return {
        ...adminPostRecord(post, authorsById.get(post.authorId)),
        threadSlug: thread?.slug,
        threadTitle: thread?.title,
        categorySlug: category?.slug,
        excerpt: excerpt(post.body, 220),
      };
    });
  },
});

export const getForumThread = query({
  args: {
    threadId: v.id("forumThreads"),
    paginationOpts: paginationOptsValidator,
    focusPostId: v.optional(v.id("forumPosts")),
  },
  handler: async (ctx, args) => {
    const actor = await requireAnyForumModerator(ctx);

    const thread = await ctx.db.get(args.threadId);
    if (thread === null) {
      throw forumError("THREAD_NOT_FOUND", "That thread no longer exists.");
    }
    const category = await ctx.db.get(thread.categoryId);
    if (category === null) {
      throw forumError("CATEGORY_NOT_FOUND", "That board no longer exists.");
    }
    await assertCanModerateCategory(ctx, actor, category);

    const posts = await ctx.db
      .query("forumPosts")
      .withIndex("by_threadId_and_createdAt", (q) =>
        q.eq("threadId", thread._id),
      )
      .order("asc")
      .paginate(args.paginationOpts);
    const focusPost =
      args.focusPostId === undefined
        ? null
        : await ctx.db.get(args.focusPostId);
    const visibleFocusPost =
      focusPost !== null && focusPost.threadId === thread._id
        ? focusPost
        : null;

    const authorsById = await loadUserNamesById(ctx, [
      thread.authorId,
      thread.lastPostUserId,
      ...posts.page.map((post) => post.authorId),
      ...(visibleFocusPost === null ? [] : [visibleFocusPost.authorId]),
    ]);

    return {
      category: adminCategoryRecord(category),
      thread: adminThreadDetailRecord(
        thread,
        category,
        authorsById.get(thread.authorId),
        authorsById.get(thread.lastPostUserId),
      ),
      poll: await loadPublicPollForThread(
        ctx,
        thread,
        actor,
        category,
        canVoteInCategory(actor, category, true),
        true,
      ),
      replies: {
        page: posts.page.map((post) =>
          adminPostRecord(post, authorsById.get(post.authorId)),
        ),
        isDone: posts.isDone,
        continueCursor: posts.continueCursor,
      },
      focusPost:
        visibleFocusPost === null
          ? null
          : adminPostRecord(
              visibleFocusPost,
              authorsById.get(visibleFocusPost.authorId),
            ),
    };
  },
});

export const listForumContentEdits = query({
  args: {
    threadId: v.id("forumThreads"),
    postId: v.optional(v.id("forumPosts")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAnyForumModerator(ctx);
    const limit = clampLimit(
      args.limit,
      CONTENT_EDIT_LIST_LIMIT,
      CONTENT_EDIT_LIST_LIMIT,
    );
    const thread = await ctx.db.get(args.threadId);
    if (thread === null) {
      throw forumError("THREAD_NOT_FOUND", "That thread no longer exists.");
    }
    await assertCanModerateCategory(
      ctx,
      actor,
      await ctx.db.get(thread.categoryId),
    );

    const edits =
      args.postId === undefined
        ? await ctx.db
            .query("forumContentEdits")
            .withIndex("by_threadId_and_createdAt", (q) =>
              q.eq("threadId", args.threadId),
            )
            .order("desc")
            .take(limit)
        : await ctx.db
            .query("forumContentEdits")
            .withIndex("by_postId_and_createdAt", (q) =>
              q.eq("postId", args.postId),
            )
            .order("desc")
            .take(limit);

    const usersById = await loadUserNamesById(ctx, [
      ...edits.map((edit) => edit.actorUserId),
      ...edits.map((edit) => edit.targetUserId),
    ]);

    return edits.map((edit) =>
      adminContentEditRecord(
        edit,
        usersById.get(edit.actorUserId),
        usersById.get(edit.targetUserId),
      ),
    );
  },
});

export const moveForumThread = mutation({
  args: {
    threadId: v.id("forumThreads"),
    targetCategoryId: v.id("forumCategories"),
    moderationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireModerator(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (thread === null) {
      throw forumError("THREAD_NOT_FOUND", "That thread no longer exists.");
    }
    const [sourceCategory, targetCategory] = await Promise.all([
      ctx.db.get(thread.categoryId),
      ctx.db.get(args.targetCategoryId),
    ]);
    if (sourceCategory === null) {
      throw forumError(
        "CATEGORY_NOT_FOUND",
        "The current board no longer exists.",
      );
    }
    if (targetCategory === null) {
      throw forumError(
        "CATEGORY_NOT_FOUND",
        "The target board no longer exists.",
      );
    }
    if (sourceCategory._id === targetCategory._id) {
      return {
        updated: false,
        thread: adminThreadDetailRecord(thread, sourceCategory),
        previousCategorySlug: sourceCategory.slug,
        nextCategorySlug: sourceCategory.slug,
        threadSlug: thread.slug,
      };
    }
    if (!(await canHostVisibleThreads(ctx, targetCategory))) {
      throw forumError(
        "THREAD_CATEGORY_NOT_POSTABLE",
        "Threads can only be moved into active boards with active parent paths.",
      );
    }

    const now = Date.now();
    const author = displayName(await ctx.db.get(thread.authorId));
    const nextSlug = await movedThreadSlug(ctx, thread, targetCategory);
    const nextPrefixSnapshot = await threadPrefixSnapshotForMove(
      ctx,
      thread,
      targetCategory._id,
    );
    const moderationReason = cleanOptional(args.moderationReason, 220);
    const visible = isVisibleThreadStatus(thread.status);
    const postTotal = 1 + thread.replyCount;
    const categoryReferenceSyncToken = movedThreadCategorySyncToken(
      thread._id,
      targetCategory._id,
      now,
    );

    await ctx.db.patch(thread._id, {
      categoryId: targetCategory._id,
      categorySlug: targetCategory.slug,
      ...nextPrefixSnapshot,
      slug: nextSlug,
      searchText: await movedThreadSearchText(
        ctx,
        thread,
        targetCategory,
        author,
        nextPrefixSnapshot.prefixLabel,
      ),
      moderationReason,
      categoryReferenceSyncToken,
      moderationActivityAt: now,
      moderationRootActivityAt: now,
      updatedAt: now,
    });
    await scheduleMovedThreadCategoryReferenceSync(ctx, {
      threadId: thread._id,
      targetCategoryId: targetCategory._id,
      now,
      token: categoryReferenceSyncToken,
      phase: "posts",
    });

    if (visible) {
      await ctx.db.patch(sourceCategory._id, {
        threadCount: Math.max(0, sourceCategory.threadCount - 1),
        postCount: Math.max(0, sourceCategory.postCount - postTotal),
        updatedAt: now,
      });
      await ctx.db.patch(targetCategory._id, {
        threadCount: targetCategory.threadCount + 1,
        postCount: targetCategory.postCount + postTotal,
        updatedAt: now,
      });
    }
    await recomputeCategorySummary(ctx, sourceCategory._id);
    await recomputeCategorySummary(ctx, targetCategory._id);
    await bumpCategoryModerationActivity(ctx, targetCategory._id, now);

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumThread",
      entityId: thread._id,
      eventType: "forum_thread_moved",
      message: "Forum thread moved",
      categoryId: targetCategory._id,
      threadId: thread._id,
      metadata: {
        previousCategoryId: sourceCategory._id,
        previousCategorySlug: sourceCategory.slug,
        nextCategoryId: targetCategory._id,
        nextCategorySlug: targetCategory.slug,
        previousThreadSlug: thread.slug,
        nextThreadSlug: nextSlug,
        previousPrefixId: thread.prefixId ?? null,
        nextPrefixId: nextPrefixSnapshot.prefixId ?? null,
        previousPrefixLabel: thread.prefixLabel ?? null,
        nextPrefixLabel: nextPrefixSnapshot.prefixLabel ?? null,
        status: thread.status,
        replyCount: thread.replyCount,
        moderationReason: moderationReason ?? null,
        actorWasModerator: true,
      },
    });

    const updated = await ctx.db.get(thread._id);
    if (updated === null) {
      throw new Error("Thread could not be reloaded");
    }
    const lastPostAuthor = displayName(
      await ctx.db.get(updated.lastPostUserId),
    );
    return {
      updated: true,
      thread: adminThreadDetailRecord(
        updated,
        targetCategory,
        author,
        lastPostAuthor,
      ),
      previousCategorySlug: sourceCategory.slug,
      nextCategorySlug: targetCategory.slug,
      threadSlug: updated.slug,
    };
  },
});

export const moveForumPosts = mutation({
  args: {
    postIds: v.array(v.id("forumPosts")),
    targetThreadId: v.id("forumThreads"),
    moderationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireForumAdmin(ctx);
    const postIds = [...new Set(args.postIds)];
    if (postIds.length === 0) {
      throw forumError(
        "NO_POSTS_SELECTED",
        "Choose at least one reply to move.",
      );
    }
    if (postIds.length > POST_MOVE_LIMIT) {
      throw forumError(
        "TOO_MANY_POSTS_SELECTED",
        `Move ${POST_MOVE_LIMIT} replies or fewer at a time.`,
      );
    }

    const targetThread = await ctx.db.get(args.targetThreadId);
    if (targetThread === null) {
      throw forumError(
        "THREAD_NOT_FOUND",
        "The target thread no longer exists.",
      );
    }
    if (!isVisibleThreadStatus(targetThread.status)) {
      throw forumError(
        "THREAD_NOT_FOUND",
        "Replies can only be moved into a visible target thread.",
      );
    }
    const targetCategory = await ctx.db.get(targetThread.categoryId);
    if (targetCategory === null) {
      throw forumError(
        "CATEGORY_NOT_FOUND",
        "The target board no longer exists.",
      );
    }
    if (!(await canHostVisibleThreads(ctx, targetCategory))) {
      throw forumError(
        "THREAD_CATEGORY_NOT_POSTABLE",
        "Replies can only be moved into active threads in active boards.",
      );
    }

    const posts = await Promise.all(
      postIds.map(async (postId) => await ctx.db.get(postId)),
    );
    if (posts.some((post) => post === null)) {
      throw forumError(
        "POST_NOT_FOUND",
        "One selected reply no longer exists.",
      );
    }
    const selectedPosts = posts as ForumPostDoc[];
    if (selectedPosts.some((post) => post.status !== "active")) {
      throw forumError(
        "INVALID_POST_STATUS",
        "Only active replies can be moved.",
      );
    }
    const sourceThreadIds = new Set(selectedPosts.map((post) => post.threadId));
    if (sourceThreadIds.size !== 1) {
      throw forumError(
        "MULTIPLE_SOURCE_THREADS",
        "Move replies from one source thread at a time.",
      );
    }
    const sourceThreadId = selectedPosts[0]!.threadId;
    if (sourceThreadId === targetThread._id) {
      throw forumError(
        "INVALID_TARGET_THREAD",
        "Choose a different target thread.",
      );
    }
    const sourceThread = await ctx.db.get(sourceThreadId);
    if (sourceThread === null) {
      throw forumError(
        "THREAD_NOT_FOUND",
        "The source thread no longer exists.",
      );
    }
    if (!isVisibleThreadStatus(sourceThread.status)) {
      throw forumError(
        "THREAD_NOT_FOUND",
        "Replies can only be moved out of visible source threads.",
      );
    }
    const sourceCategory = await ctx.db.get(sourceThread.categoryId);
    if (sourceCategory === null) {
      throw forumError(
        "CATEGORY_NOT_FOUND",
        "The source board no longer exists.",
      );
    }

    const moderationReason = cleanOptional(args.moderationReason, 220);
    const now = Date.now();
    const sortedPosts = [...selectedPosts].sort(
      (left, right) =>
        (left.postNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.postNumber ?? Number.MAX_SAFE_INTEGER) ||
        left.createdAt - right.createdAt,
    );
    // Keep historical createdAt values intact; moved replies are appended with
    // fresh target post numbers so existing target-thread anchors stay stable.
    const firstTargetPostNumber = await nextPostNumberForThread(
      ctx,
      targetThread,
    );

    for (const [index, post] of sortedPosts.entries()) {
      const nextPostNumber = firstTargetPostNumber + index;
      await ctx.db.patch(post._id, {
        threadId: targetThread._id,
        categoryId: targetCategory._id,
        postNumber: nextPostNumber,
        moderationReason,
        moderationMovedAt: now,
        updatedAt: now,
      });
      await movePostRelatedRecords(ctx, {
        postId: post._id,
        targetThreadId: targetThread._id,
        targetCategoryId: targetCategory._id,
        now,
      });
      await ensureThreadParticipantSubscription(ctx, {
        userId: post.authorId,
        threadId: targetThread._id,
        categoryId: targetCategory._id,
        now,
      });
    }

    await ctx.db.patch(sourceThread._id, {
      replyCount: Math.max(0, sourceThread.replyCount - sortedPosts.length),
      updatedAt: now,
    });
    await ctx.db.patch(targetThread._id, {
      replyCount: targetThread.replyCount + sortedPosts.length,
      lastAssignedPostNumber: firstTargetPostNumber + sortedPosts.length - 1,
      moderationActivityAt: now,
      updatedAt: now,
    });

    await recomputeThreadActivity(ctx, sourceThread._id);
    await recomputeThreadActivity(ctx, targetThread._id);

    if (sourceCategory._id !== targetCategory._id) {
      await ctx.db.patch(sourceCategory._id, {
        postCount: Math.max(0, sourceCategory.postCount - sortedPosts.length),
        updatedAt: now,
      });
      await ctx.db.patch(targetCategory._id, {
        postCount: targetCategory.postCount + sortedPosts.length,
        updatedAt: now,
      });
    }
    await recomputeCategorySummary(ctx, sourceCategory._id);
    await recomputeCategorySummary(ctx, targetCategory._id);
    await bumpCategoryModerationActivity(ctx, targetCategory._id, now);

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumThread",
      entityId: targetThread._id,
      eventType: "forum_posts_moved",
      message: "Forum replies moved",
      categoryId: targetCategory._id,
      threadId: targetThread._id,
      metadata: {
        sourceThreadId: sourceThread._id,
        sourceThreadTitle: sourceThread.title,
        targetThreadId: targetThread._id,
        targetThreadTitle: targetThread.title,
        sourceCategoryId: sourceCategory._id,
        sourceCategorySlug: sourceCategory.slug,
        targetCategoryId: targetCategory._id,
        targetCategorySlug: targetCategory.slug,
        postIds: sortedPosts.map((post) => post._id),
        previousPostNumbers: sortedPosts.map((post) => post.postNumber ?? null),
        nextPostNumbers: sortedPosts.map(
          (_post, index) => firstTargetPostNumber + index,
        ),
        moderationReason: moderationReason ?? null,
        actorWasModerator: true,
      },
    });

    const [updatedSourceThread, updatedTargetThread] = await Promise.all([
      ctx.db.get(sourceThread._id),
      ctx.db.get(targetThread._id),
    ]);
    if (updatedSourceThread === null || updatedTargetThread === null) {
      throw new Error("Moved threads could not be reloaded");
    }
    const authorsById = await loadUserNamesById(ctx, [
      updatedSourceThread.authorId,
      updatedSourceThread.lastPostUserId,
      updatedTargetThread.authorId,
      updatedTargetThread.lastPostUserId,
    ]);

    return {
      moved: sortedPosts.length,
      sourceThread: adminThreadDetailRecord(
        updatedSourceThread,
        sourceCategory,
        authorsById.get(updatedSourceThread.authorId),
        authorsById.get(updatedSourceThread.lastPostUserId),
      ),
      targetThread: adminThreadDetailRecord(
        updatedTargetThread,
        targetCategory,
        authorsById.get(updatedTargetThread.authorId),
        authorsById.get(updatedTargetThread.lastPostUserId),
      ),
      postIds: sortedPosts.map((post) => post._id),
      nextPostNumbers: sortedPosts.map(
        (_post, index) => firstTargetPostNumber + index,
      ),
    };
  },
});

export const splitForumPosts = mutation({
  args: {
    postIds: v.array(v.id("forumPosts")),
    targetCategoryId: v.id("forumCategories"),
    title: v.string(),
    prefixId: v.optional(v.union(v.id("forumThreadPrefixes"), v.null())),
    moderationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireForumAdmin(ctx);
    const postIds = [...new Set(args.postIds)];
    if (postIds.length === 0) {
      throw forumError(
        "NO_POSTS_SELECTED",
        "Choose at least one reply to split.",
      );
    }
    if (postIds.length > POST_MOVE_LIMIT) {
      throw forumError(
        "TOO_MANY_POSTS_SELECTED",
        `Split ${POST_MOVE_LIMIT} replies or fewer at a time.`,
      );
    }

    const targetCategory = await ctx.db.get(args.targetCategoryId);
    if (targetCategory === null) {
      throw forumError(
        "CATEGORY_NOT_FOUND",
        "The target board no longer exists.",
      );
    }
    if (!(await canHostVisibleThreads(ctx, targetCategory))) {
      throw forumError(
        "THREAD_CATEGORY_NOT_POSTABLE",
        "Replies can only be split into active boards with active parent paths.",
      );
    }

    const posts = await Promise.all(
      postIds.map(async (postId) => await ctx.db.get(postId)),
    );
    if (posts.some((post) => post === null)) {
      throw forumError(
        "POST_NOT_FOUND",
        "One selected reply no longer exists.",
      );
    }
    const selectedPosts = posts as ForumPostDoc[];
    if (selectedPosts.some((post) => post.status !== "active")) {
      throw forumError(
        "INVALID_POST_STATUS",
        "Only active replies can be split.",
      );
    }
    const sourceThreadIds = new Set(selectedPosts.map((post) => post.threadId));
    if (sourceThreadIds.size !== 1) {
      throw forumError(
        "MULTIPLE_SOURCE_THREADS",
        "Split replies from one source thread at a time.",
      );
    }

    const sourceThreadId = selectedPosts[0]!.threadId;
    const sourceThread = await ctx.db.get(sourceThreadId);
    if (sourceThread === null) {
      throw forumError(
        "THREAD_NOT_FOUND",
        "The source thread no longer exists.",
      );
    }
    if (!isVisibleThreadStatus(sourceThread.status)) {
      throw forumError(
        "THREAD_NOT_FOUND",
        "Replies can only be split out of visible source threads.",
      );
    }
    const sourceCategory = await ctx.db.get(sourceThread.categoryId);
    if (sourceCategory === null) {
      throw forumError(
        "CATEGORY_NOT_FOUND",
        "The source board no longer exists.",
      );
    }

    const sortedPosts = sortedForumPostsForAppend(selectedPosts);
    const openerPost = sortedPosts[0]!;
    const replyPosts = sortedPosts.slice(1);
    const title = normalizeTitle(args.title);
    const body = splitThreadBodyFromPost(openerPost);
    const moderationReason = cleanOptional(args.moderationReason, 220);
    const prefix = await resolveThreadPrefixForCategory(
      ctx,
      args.prefixId ?? null,
      targetCategory,
    );
    const prefixSnapshot = threadPrefixSnapshot(prefix);
    const now = Date.now();
    const slug = await generateUniqueThreadSlug(
      ctx,
      targetCategory.slug,
      title,
    );
    const openerAuthor = await ctx.db.get(openerPost.authorId);
    const newThreadId = await ctx.db.insert("forumThreads", {
      categoryId: targetCategory._id,
      categorySlug: targetCategory.slug,
      ...prefixSnapshot,
      slug,
      title,
      body,
      authorId: openerPost.authorId,
      status: "active",
      pinned: false,
      replyCount: replyPosts.length,
      lastAssignedPostNumber: sortedPosts.length,
      viewCount: 0,
      lastPostAt: openerPost.createdAt,
      lastPostUserId: openerPost.authorId,
      moderationActivityAt: now,
      moderationRootActivityAt: now,
      searchText: buildThreadSearchText(
        targetCategory,
        title,
        threadSearchBodyWithPrefix(body, prefix?.label),
        displayName(openerAuthor),
      ),
      createdAt: openerPost.createdAt,
      updatedAt: now,
    });

    await ctx.db.patch(openerPost._id, {
      status: "deleted",
      deletedAt: now,
      deletedBy: actor._id,
      moderationReason,
      updatedAt: now,
    });
    await movePromotedPostAttachmentsToThread(ctx, {
      postId: openerPost._id,
      targetThreadId: newThreadId,
      targetCategoryId: targetCategory._id,
      now,
    });
    await ensureThreadParticipantSubscription(ctx, {
      userId: openerPost.authorId,
      threadId: newThreadId,
      categoryId: targetCategory._id,
      now,
    });

    for (const [index, post] of replyPosts.entries()) {
      const nextPostNumber = index + 2;
      await ctx.db.patch(post._id, {
        threadId: newThreadId,
        categoryId: targetCategory._id,
        postNumber: nextPostNumber,
        moderationReason,
        moderationMovedAt: now,
        updatedAt: now,
      });
      await movePostRelatedRecords(ctx, {
        postId: post._id,
        targetThreadId: newThreadId,
        targetCategoryId: targetCategory._id,
        now,
      });
      await ensureThreadParticipantSubscription(ctx, {
        userId: post.authorId,
        threadId: newThreadId,
        categoryId: targetCategory._id,
        now,
      });
    }

    await ctx.db.patch(sourceThread._id, {
      replyCount: Math.max(0, sourceThread.replyCount - sortedPosts.length),
      updatedAt: now,
    });
    await recomputeThreadActivity(ctx, sourceThread._id);
    await recomputeThreadActivity(ctx, newThreadId);

    if (sourceCategory._id === targetCategory._id) {
      await ctx.db.patch(targetCategory._id, {
        threadCount: targetCategory.threadCount + 1,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(sourceCategory._id, {
        postCount: Math.max(0, sourceCategory.postCount - sortedPosts.length),
        updatedAt: now,
      });
      await ctx.db.patch(targetCategory._id, {
        threadCount: targetCategory.threadCount + 1,
        postCount: targetCategory.postCount + sortedPosts.length,
        updatedAt: now,
      });
    }
    await bumpForumUserProfileStats(ctx, openerPost.authorId, {
      threadDelta: 1,
      now,
    });
    await recomputeCategorySummary(ctx, sourceCategory._id);
    await recomputeCategorySummary(ctx, targetCategory._id);
    await bumpCategoryModerationActivity(ctx, targetCategory._id, now);

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumThread",
      entityId: newThreadId,
      eventType: "forum_posts_moved",
      message: "Forum replies split into a new thread",
      categoryId: targetCategory._id,
      threadId: newThreadId,
      metadata: {
        operation: "split",
        sourceThreadId: sourceThread._id,
        sourceThreadTitle: sourceThread.title,
        targetThreadId: newThreadId,
        targetThreadTitle: title,
        sourceCategoryId: sourceCategory._id,
        sourceCategorySlug: sourceCategory.slug,
        targetCategoryId: targetCategory._id,
        targetCategorySlug: targetCategory.slug,
        promotedPostId: openerPost._id,
        postIds: sortedPosts.map((post) => post._id),
        previousPostNumbers: sortedPosts.map((post) => post.postNumber ?? null),
        nextPostNumbers: sortedPosts.map((_post, index) => index + 1),
        prefixId: prefix?._id ?? null,
        moderationReason: moderationReason ?? null,
        actorWasModerator: true,
      },
    });

    const [updatedSourceThread, newThread] = await Promise.all([
      ctx.db.get(sourceThread._id),
      ctx.db.get(newThreadId),
    ]);
    if (updatedSourceThread === null || newThread === null) {
      throw new Error("Split threads could not be reloaded");
    }
    const authorsById = await loadUserNamesById(ctx, [
      updatedSourceThread.authorId,
      updatedSourceThread.lastPostUserId,
      newThread.authorId,
      newThread.lastPostUserId,
    ]);

    return {
      split: sortedPosts.length,
      sourceThread: adminThreadDetailRecord(
        updatedSourceThread,
        sourceCategory,
        authorsById.get(updatedSourceThread.authorId),
        authorsById.get(updatedSourceThread.lastPostUserId),
      ),
      newThread: adminThreadDetailRecord(
        newThread,
        targetCategory,
        authorsById.get(newThread.authorId),
        authorsById.get(newThread.lastPostUserId),
      ),
      promotedPostId: openerPost._id,
      postIds: sortedPosts.map((post) => post._id),
      nextPostNumbers: sortedPosts.map((_post, index) => index + 1),
    };
  },
});

export const mergeForumThread = mutation({
  args: {
    sourceThreadId: v.id("forumThreads"),
    targetThreadId: v.id("forumThreads"),
    moderationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireForumAdmin(ctx);
    if (args.sourceThreadId === args.targetThreadId) {
      throw forumError(
        "INVALID_TARGET_THREAD",
        "Choose a different target thread.",
      );
    }

    const [sourceThread, targetThread] = await Promise.all([
      ctx.db.get(args.sourceThreadId),
      ctx.db.get(args.targetThreadId),
    ]);
    if (sourceThread === null || targetThread === null) {
      throw forumError("THREAD_NOT_FOUND", "That thread no longer exists.");
    }
    if (!isVisibleThreadStatus(sourceThread.status)) {
      throw forumError(
        "THREAD_NOT_FOUND",
        "Only visible source threads can be merged.",
      );
    }
    if (!isVisibleThreadStatus(targetThread.status)) {
      throw forumError(
        "THREAD_NOT_FOUND",
        "Threads can only be merged into a visible target thread.",
      );
    }

    const [sourceCategory, targetCategory] = await Promise.all([
      ctx.db.get(sourceThread.categoryId),
      ctx.db.get(targetThread.categoryId),
    ]);
    if (sourceCategory === null || targetCategory === null) {
      throw forumError(
        "CATEGORY_NOT_FOUND",
        "A thread board no longer exists.",
      );
    }
    if (!(await canHostVisibleThreads(ctx, targetCategory))) {
      throw forumError(
        "THREAD_CATEGORY_NOT_POSTABLE",
        "Threads can only be merged into active boards with active parent paths.",
      );
    }

    const sourcePoll = await ctx.db
      .query("forumPolls")
      .withIndex("by_threadId", (q) => q.eq("threadId", sourceThread._id))
      .take(1);
    if (sourcePoll[0] !== undefined) {
      throw forumError(
        "SOURCE_THREAD_HAS_POLL",
        "Threads with polls need manual handling before merge.",
      );
    }

    const sourceReplies = await activeRepliesForThreadMove(
      ctx,
      sourceThread._id,
      POST_MOVE_LIMIT + 1,
    );
    if (sourceReplies.length > POST_MOVE_LIMIT) {
      throw forumError(
        "TOO_MANY_POSTS_SELECTED",
        `Merge source threads with ${POST_MOVE_LIMIT} replies or fewer at a time.`,
      );
    }

    const moderationReason = cleanOptional(args.moderationReason, 220);
    const now = Date.now();
    const firstTargetPostNumber = await nextPostNumberForThread(
      ctx,
      targetThread,
    );
    const sourceOpenerPostNumber = firstTargetPostNumber;
    const sourceOpenerPostId = await ctx.db.insert("forumPosts", {
      threadId: targetThread._id,
      categoryId: targetCategory._id,
      authorId: sourceThread.authorId,
      body: sourceThread.body,
      postNumber: sourceOpenerPostNumber,
      status: "active",
      createdAt: sourceThread.createdAt,
      moderationMovedAt: now,
      updatedAt: now,
    });
    await moveThreadRootRecordsToPost(ctx, {
      sourceThreadId: sourceThread._id,
      targetThreadId: targetThread._id,
      targetCategoryId: targetCategory._id,
      targetPostId: sourceOpenerPostId,
      now,
    });
    await ensureThreadParticipantSubscription(ctx, {
      userId: sourceThread.authorId,
      threadId: targetThread._id,
      categoryId: targetCategory._id,
      now,
    });

    for (const [index, post] of sourceReplies.entries()) {
      const nextPostNumber = firstTargetPostNumber + index + 1;
      await ctx.db.patch(post._id, {
        threadId: targetThread._id,
        categoryId: targetCategory._id,
        postNumber: nextPostNumber,
        moderationReason,
        moderationMovedAt: now,
        updatedAt: now,
      });
      await movePostRelatedRecords(ctx, {
        postId: post._id,
        targetThreadId: targetThread._id,
        targetCategoryId: targetCategory._id,
        now,
      });
      await ensureThreadParticipantSubscription(ctx, {
        userId: post.authorId,
        threadId: targetThread._id,
        categoryId: targetCategory._id,
        now,
      });
    }

    const mergedPostCount = 1 + sourceReplies.length;
    await ctx.db.patch(sourceThread._id, {
      status: "deleted",
      replyCount: 0,
      deletedAt: now,
      deletedBy: actor._id,
      moderationReason,
      updatedAt: now,
    });
    await ctx.db.patch(targetThread._id, {
      replyCount: targetThread.replyCount + mergedPostCount,
      lastAssignedPostNumber: firstTargetPostNumber + mergedPostCount - 1,
      moderationActivityAt: now,
      updatedAt: now,
    });

    await recomputeThreadActivity(ctx, sourceThread._id);
    await recomputeThreadActivity(ctx, targetThread._id);

    if (sourceCategory._id === targetCategory._id) {
      await ctx.db.patch(sourceCategory._id, {
        threadCount: Math.max(0, sourceCategory.threadCount - 1),
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(sourceCategory._id, {
        threadCount: Math.max(0, sourceCategory.threadCount - 1),
        postCount: Math.max(0, sourceCategory.postCount - mergedPostCount),
        updatedAt: now,
      });
      await ctx.db.patch(targetCategory._id, {
        postCount: targetCategory.postCount + mergedPostCount,
        updatedAt: now,
      });
    }
    await bumpForumUserProfileStats(ctx, sourceThread.authorId, {
      threadDelta: -1,
      now,
    });
    await recomputeCategorySummary(ctx, sourceCategory._id);
    await recomputeCategorySummary(ctx, targetCategory._id);
    await bumpCategoryModerationActivity(ctx, targetCategory._id, now);

    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumThread",
      entityId: targetThread._id,
      eventType: "forum_posts_moved",
      message: "Forum thread merged",
      categoryId: targetCategory._id,
      threadId: targetThread._id,
      metadata: {
        operation: "merge",
        sourceThreadId: sourceThread._id,
        sourceThreadTitle: sourceThread.title,
        targetThreadId: targetThread._id,
        targetThreadTitle: targetThread.title,
        sourceCategoryId: sourceCategory._id,
        sourceCategorySlug: sourceCategory.slug,
        targetCategoryId: targetCategory._id,
        targetCategorySlug: targetCategory.slug,
        sourceOpenerPostId,
        postIds: [sourceOpenerPostId, ...sourceReplies.map((post) => post._id)],
        previousPostNumbers: [
          1,
          ...sourceReplies.map((post) => post.postNumber ?? null),
        ],
        nextPostNumbers: Array.from(
          { length: mergedPostCount },
          (_value, index) => firstTargetPostNumber + index,
        ),
        moderationReason: moderationReason ?? null,
        actorWasModerator: true,
      },
    });

    const [updatedSourceThread, updatedTargetThread] = await Promise.all([
      ctx.db.get(sourceThread._id),
      ctx.db.get(targetThread._id),
    ]);
    if (updatedSourceThread === null || updatedTargetThread === null) {
      throw new Error("Merged threads could not be reloaded");
    }
    const authorsById = await loadUserNamesById(ctx, [
      updatedSourceThread.authorId,
      updatedSourceThread.lastPostUserId,
      updatedTargetThread.authorId,
      updatedTargetThread.lastPostUserId,
    ]);

    return {
      merged: mergedPostCount,
      sourceThread: adminThreadDetailRecord(
        updatedSourceThread,
        sourceCategory,
        authorsById.get(updatedSourceThread.authorId),
        authorsById.get(updatedSourceThread.lastPostUserId),
      ),
      targetThread: adminThreadDetailRecord(
        updatedTargetThread,
        targetCategory,
        authorsById.get(updatedTargetThread.authorId),
        authorsById.get(updatedTargetThread.lastPostUserId),
      ),
      sourceOpenerPostId,
      postIds: [sourceOpenerPostId, ...sourceReplies.map((post) => post._id)],
      nextPostNumbers: Array.from(
        { length: mergedPostCount },
        (_value, index) => firstTargetPostNumber + index,
      ),
    };
  },
});

export const updateForumThreadModeration = mutation({
  args: {
    threadId: v.id("forumThreads"),
    status: v.optional(threadStatusValidator),
    pinned: v.optional(v.boolean()),
    moderationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAnyForumModerator(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (thread === null) {
      throw forumError("THREAD_NOT_FOUND", "That thread no longer exists.");
    }
    const category = await ctx.db.get(thread.categoryId);
    if (category === null) {
      throw forumError("CATEGORY_NOT_FOUND", "That board no longer exists.");
    }
    await assertCanModerateCategory(ctx, actor, category);

    const nextStatus = args.status ?? thread.status;
    const nextPinned = args.pinned ?? thread.pinned;
    const moderationReason = cleanOptional(args.moderationReason, 220);
    if (nextStatus === "pending" && thread.status !== "pending") {
      throw forumError(
        "INVALID_STATUS",
        "Published threads cannot be moved back to pending.",
      );
    }
    if (
      thread.status === "pending" &&
      nextStatus !== "pending" &&
      nextStatus !== "active" &&
      nextStatus !== "deleted"
    ) {
      throw forumError(
        "INVALID_STATUS",
        "Pending threads can only be approved or deleted.",
      );
    }
    if (
      (nextStatus === "active" || nextStatus === "locked") &&
      !(await canHostVisibleThreads(ctx, category))
    ) {
      throw forumError(
        "THREAD_CATEGORY_NOT_POSTABLE",
        "Threads cannot be restored into an inactive or hidden board path.",
      );
    }

    if (
      nextStatus === thread.status &&
      nextPinned === thread.pinned &&
      moderationReason === thread.moderationReason
    ) {
      return {
        updated: false,
        thread: adminThreadDetailRecord(thread, category, undefined, undefined),
      };
    }

    const now = Date.now();
    const wasVisible = isVisibleThreadStatus(thread.status);
    const isVisible = isVisibleThreadStatus(nextStatus);
    const visibilityProfileDeltaToken =
      wasVisible === isVisible
        ? undefined
        : forumVisibilityProfileDeltaToken(thread._id, isVisible, now);
    await ctx.db.patch(thread._id, {
      status: nextStatus,
      pinned: nextPinned,
      updatedAt: now,
      moderationReason,
      lockedAt: nextStatus === "locked" ? (thread.lockedAt ?? now) : undefined,
      lockedBy:
        nextStatus === "locked" ? (thread.lockedBy ?? actor._id) : undefined,
      deletedAt:
        nextStatus === "deleted" ? (thread.deletedAt ?? now) : undefined,
      deletedBy:
        nextStatus === "deleted" ? (thread.deletedBy ?? actor._id) : undefined,
      ...(visibilityProfileDeltaToken === undefined
        ? {}
        : { visibilityProfileDeltaToken }),
    });

    if (wasVisible !== isVisible) {
      await ctx.db.patch(category._id, {
        threadCount: Math.max(0, category.threadCount + (isVisible ? 1 : -1)),
        postCount: Math.max(
          0,
          category.postCount +
            (isVisible ? 1 + thread.replyCount : -(1 + thread.replyCount)),
        ),
        updatedAt: now,
      });
      if (visibilityProfileDeltaToken === undefined) {
        throw new Error("Visibility transition token was not created");
      }
      await applyThreadVisibilityProfileDeltas(ctx, thread, {
        isVisible,
        now,
        token: visibilityProfileDeltaToken,
      });
      if (thread.status === "pending" && isVisible) {
        await ensureThreadParticipantSubscription(ctx, {
          userId: thread.authorId,
          threadId: thread._id,
          categoryId: category._id,
          now,
        });
        await createNewThreadNotifications(ctx, {
          actorUserId: thread.authorId,
          categoryId: category._id,
          threadId: thread._id,
          now,
        });
      }
    }

    if (wasVisible && !isVisible) {
      if (
        category.lastThreadId === thread._id ||
        category.lastPostId === thread.lastPostId
      ) {
        await recomputeCategorySummary(ctx, category._id);
      }
    } else if (!wasVisible && isVisible) {
      await maybePromoteCategorySummary(ctx, category._id, thread._id);
    }

    const threadEventType =
      nextStatus === "deleted"
        ? "forum_thread_deleted"
        : "forum_thread_moderated";
    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumThread",
      entityId: thread._id,
      eventType: threadEventType,
      message:
        threadEventType === "forum_thread_deleted"
          ? "Forum thread deleted"
          : "Forum thread moderation updated",
      categoryId: category._id,
      threadId: thread._id,
      metadata: {
        categoryId: category._id,
        previousStatus: thread.status,
        nextStatus,
        previousPinned: thread.pinned,
        nextPinned,
        moderationReason: moderationReason ?? null,
        actorWasModerator: true,
      },
    });

    const updated = await ctx.db.get(thread._id);
    if (updated === null) {
      throw new Error("Thread could not be reloaded");
    }

    return {
      updated: true,
      thread: adminThreadDetailRecord(updated, category, undefined, undefined),
    };
  },
});

export const updateForumPostModeration = mutation({
  args: {
    postId: v.id("forumPosts"),
    status: postStatusValidator,
    moderationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAnyForumModerator(ctx);
    const post = await ctx.db.get(args.postId);
    if (post === null) {
      throw forumError("POST_NOT_FOUND", "That reply no longer exists.");
    }
    const thread = await ctx.db.get(post.threadId);
    if (thread === null) {
      throw forumError("THREAD_NOT_FOUND", "That thread no longer exists.");
    }
    const category = await ctx.db.get(thread.categoryId);
    if (category === null) {
      throw forumError("CATEGORY_NOT_FOUND", "That board no longer exists.");
    }
    await assertCanModerateCategory(ctx, actor, category);

    const moderationReason = cleanOptional(args.moderationReason, 220);
    if (args.status === "pending" && post.status !== "pending") {
      throw forumError(
        "INVALID_STATUS",
        "Published replies cannot be moved back to pending.",
      );
    }
    if (
      post.status === "pending" &&
      args.status !== "pending" &&
      args.status !== "active" &&
      args.status !== "deleted"
    ) {
      throw forumError(
        "INVALID_STATUS",
        "Pending replies can only be approved or deleted.",
      );
    }
    if (
      args.status === post.status &&
      moderationReason === post.moderationReason
    ) {
      return {
        updated: false,
        post: adminPostRecord(post),
      };
    }

    const wasActive = post.status === "active";
    const isActive = args.status === "active";
    const now = Date.now();

    await ctx.db.patch(post._id, {
      status: args.status,
      updatedAt: now,
      moderationReason,
      deletedAt:
        args.status === "deleted" ? (post.deletedAt ?? now) : undefined,
      deletedBy:
        args.status === "deleted" ? (post.deletedBy ?? actor._id) : undefined,
    });

    if (wasActive !== isActive) {
      await ctx.db.patch(thread._id, {
        replyCount: Math.max(0, thread.replyCount + (isActive ? 1 : -1)),
        updatedAt: now,
      });
      await bumpForumUserProfileStats(ctx, post.authorId, {
        postDelta: isActive ? 1 : -1,
        now,
      });
      await recomputeThreadActivity(ctx, thread._id);

      if (isVisibleThreadStatus(thread.status)) {
        await ctx.db.patch(category._id, {
          postCount: Math.max(0, category.postCount + (isActive ? 1 : -1)),
          updatedAt: now,
        });

        if ((wasActive && category.lastThreadId === thread._id) || isActive) {
          await recomputeCategorySummary(ctx, category._id);
        }
        if (post.status === "pending" && isActive) {
          await ensureThreadParticipantSubscription(ctx, {
            userId: post.authorId,
            threadId: thread._id,
            categoryId: category._id,
            now,
          });
          await createReplyNotifications(ctx, {
            actorUserId: post.authorId,
            categoryId: category._id,
            postId: post._id,
            threadId: thread._id,
            now,
          });
        }
      }
    } else if (thread.lastPostId === post._id) {
      await recomputeThreadActivity(ctx, thread._id);
      if (
        isVisibleThreadStatus(thread.status) &&
        category.lastThreadId === thread._id
      ) {
        await recomputeCategorySummary(ctx, category._id);
      }
    }

    const postEventType =
      args.status === "deleted" ? "forum_post_deleted" : "forum_post_moderated";
    await recordModerationLog(ctx, {
      actorUserId: actor._id,
      entityType: "forumPost",
      entityId: post._id,
      eventType: postEventType,
      message:
        postEventType === "forum_post_deleted"
          ? "Forum reply deleted"
          : "Forum reply moderation updated",
      categoryId: category._id,
      threadId: thread._id,
      postId: post._id,
      metadata: {
        categoryId: category._id,
        threadId: thread._id,
        previousStatus: post.status,
        nextStatus: args.status,
        moderationReason: moderationReason ?? null,
        actorWasModerator: true,
      },
    });

    const updated = await ctx.db.get(post._id);
    if (updated === null) {
      throw new Error("Post could not be reloaded");
    }

    return {
      updated: true,
      post: adminPostRecord(updated),
    };
  },
});

async function maybeCurrentUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get(userId);
}

async function requireSignedInUser(
  ctx: QueryCtx | MutationCtx,
  message: string,
) {
  const user = await maybeCurrentUser(ctx);
  if (user === null) {
    throw forumError("AUTH_REQUIRED", message);
  }
  return user;
}

async function requireModerator(ctx: QueryCtx | MutationCtx) {
  const user = await maybeCurrentUser(ctx);
  if (!canModerate(user)) {
    throw forumError(
      user === null ? "AUTH_REQUIRED" : "UNAUTHORIZED",
      user === null
        ? "Sign in with an admin account to manage the forum."
        : "Forum moderator access is required.",
    );
  }
  return user as UserDoc;
}

async function requireAnyForumModerator(ctx: QueryCtx | MutationCtx) {
  const user = await maybeCurrentUser(ctx);
  if (!(await canModerateAnyForumCategory(ctx, user))) {
    throw forumError(
      user === null ? "AUTH_REQUIRED" : "UNAUTHORIZED",
      user === null
        ? "Sign in with an admin account to manage the forum."
        : "Forum moderator access is required.",
    );
  }
  return user as UserDoc;
}

async function requireForumAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await maybeCurrentUser(ctx);
  if (!canAdminForum(user)) {
    throw forumError(
      user === null ? "AUTH_REQUIRED" : "UNAUTHORIZED",
      user === null
        ? "Sign in with an admin account to manage the forum."
        : "Forum admin access is required.",
    );
  }
  return user as UserDoc;
}

async function assertCanModerateCategory(
  ctx: QueryCtx | MutationCtx,
  user: UserDoc,
  category: ForumCategoryDoc | null | undefined,
) {
  if (await canModerateCategory(ctx, user, category)) {
    return;
  }
  throw forumError(
    "UNAUTHORIZED",
    "Forum moderator access for this board is required.",
  );
}

async function assertForumParticipationAllowed(
  ctx: QueryCtx | MutationCtx,
  user: UserDoc,
  action: string,
) {
  const accountRestriction = forumAccountRestriction(user, Date.now());
  if (accountRestriction !== null) {
    throw forumError(accountRestriction.code, accountRestriction.message);
  }

  if (await canUseForumParticipation(ctx, user)) {
    return;
  }

  const summary = await activeWarningSummaryForUser(ctx, user._id, Date.now());
  const activePoints = summary.activeWarningPoints;
  throw forumError(
    "FORUM_WARNING_BLOCKED",
    `Your account has ${activePoints} active warning points, so you cannot ${action} right now.`,
  );
}

async function canUseForumParticipation(
  ctx: QueryCtx | MutationCtx,
  user: UserDoc,
) {
  if (canModerate(user)) {
    return true;
  }
  if (forumAccountRestriction(user, Date.now()) !== null) {
    return false;
  }

  const summary = await activeWarningSummaryForUser(ctx, user._id, Date.now());
  return summary.activeWarningPoints < WARNING_PARTICIPATION_BLOCK_POINTS;
}

async function requireVisibleCategory(
  ctx: QueryCtx | MutationCtx,
  categorySlug: string,
  user: UserDoc | null,
) {
  const category = await ctx.db
    .query("forumCategories")
    .withIndex("by_slug", (q) =>
      q.eq("slug", normalizeCategorySlug(categorySlug, "Board slug")),
    )
    .unique();
  if (
    category === null ||
    !isBoardCategory(category) ||
    !(await canViewCategoryWithAncestors(ctx, user, category))
  ) {
    throw forumError("CATEGORY_NOT_FOUND", "That board is not available.");
  }
  return category;
}

async function requireVisibleCategoryById(
  ctx: QueryCtx | MutationCtx,
  categoryId: Id<"forumCategories">,
  user: UserDoc | null,
) {
  const category = await visibleCategoryById(ctx, categoryId, user);
  if (category === null) {
    throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
  }
  return category;
}

async function visibleCategoryById(
  ctx: QueryCtx | MutationCtx,
  categoryId: Id<"forumCategories">,
  user: UserDoc | null,
) {
  const category = await ctx.db.get(categoryId);
  if (
    category === null ||
    !isBoardCategory(category) ||
    !(await canViewCategoryWithAncestors(ctx, user, category))
  ) {
    return null;
  }
  return category;
}

async function requireWritableCategory(
  ctx: MutationCtx,
  categorySlug: string,
  user: UserDoc,
  action: "thread" | "reply" | "poll" = "thread",
) {
  const category = await requireVisibleCategory(ctx, categorySlug, user);
  const userCanModerateCategory = await canModerateCategory(
    ctx,
    user,
    category,
  );
  const allowed =
    action === "reply"
      ? canReplyInCategory(user, category, userCanModerateCategory)
      : action === "poll"
        ? canVoteInCategory(user, category, userCanModerateCategory)
        : canStartThreadInCategory(user, category, userCanModerateCategory);
  if (!allowed) {
    throw forumError(
      "FORUM_PERMISSION_REQUIRED",
      categoryPermissionMessage(category, action),
    );
  }
  return category;
}

async function requirePublicThread(
  ctx: QueryCtx,
  categorySlug: string,
  threadSlug: string,
) {
  const thread = await ctx.db
    .query("forumThreads")
    .withIndex("by_categorySlug_and_slug", (q) =>
      q
        .eq("categorySlug", normalizeCategorySlug(categorySlug, "Board slug"))
        .eq("slug", normalizeThreadSlug(threadSlug)),
    )
    .unique();

  if (thread === null || !isVisibleThreadStatus(thread.status)) {
    throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
  }
  return thread;
}

function hasLegacyForumAdminRole(user: UserDoc | null | undefined) {
  return user?.role === "owner" || user?.role === "admin";
}

function forumStaffRole(user: UserDoc | null | undefined) {
  if (hasLegacyForumAdminRole(user)) {
    return "admin" as const;
  }
  return user?.forumRole ?? null;
}

function canModerate(user: UserDoc | null | undefined) {
  if (hasLegacyForumAdminRole(user)) {
    return true;
  }
  return (
    forumAccountRestriction(user, Date.now()) === null &&
    forumStaffRole(user) !== null
  );
}

async function canModerateAnyForumCategory(
  ctx: QueryCtx | MutationCtx,
  user: UserDoc | null | undefined,
) {
  if (canModerate(user)) {
    return true;
  }
  if (user === null || user === undefined || !isActiveForumAccount(user)) {
    return false;
  }
  const assignments = await ctx.db
    .query("forumCategoryModerators")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .take(1);
  return assignments.length > 0;
}

async function canModerateCategory(
  ctx: QueryCtx | MutationCtx,
  user: UserDoc | null | undefined,
  category: ForumCategoryDoc | null | undefined,
) {
  if (canModerate(user)) {
    return true;
  }
  if (
    user === null ||
    user === undefined ||
    category === null ||
    category === undefined ||
    !isActiveForumAccount(user)
  ) {
    return false;
  }
  const assignment = await ctx.db
    .query("forumCategoryModerators")
    .withIndex("by_categoryId_and_userId", (q) =>
      q.eq("categoryId", category._id).eq("userId", user._id),
    )
    .unique();
  return assignment !== null;
}

async function loadModeratedCategoryIdsForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  const assignments = await ctx.db
    .query("forumCategoryModerators")
    .withIndex("by_userId_and_categoryId", (q) => q.eq("userId", userId))
    .take(200);
  return [...new Set(assignments.map((assignment) => assignment.categoryId))];
}

function includesCategoryId(
  categoryIds: Array<Id<"forumCategories">>,
  categoryId: Id<"forumCategories">,
) {
  return categoryIds.some((candidate) => candidate === categoryId);
}

function canAdminForum(user: UserDoc | null | undefined) {
  if (hasLegacyForumAdminRole(user)) {
    return true;
  }
  return (
    forumAccountRestriction(user, Date.now()) === null &&
    forumStaffRole(user) === "admin"
  );
}

function forumAccountRestriction(
  user: UserDoc | null | undefined,
  now: number,
) {
  if (user === null || user === undefined || hasLegacyForumAdminRole(user)) {
    return null;
  }
  if (user.forumBannedAt !== undefined) {
    return {
      code: "FORUM_BANNED" as const,
      message: "Your account is banned from the forum.",
    };
  }
  if (
    user.forumSuspendedUntil !== undefined &&
    user.forumSuspendedUntil > now
  ) {
    return {
      code: "FORUM_SUSPENDED" as const,
      message: `Your account is suspended from the forum until ${new Date(
        user.forumSuspendedUntil,
      ).toISOString()}.`,
    };
  }
  return null;
}

function isActiveForumAccount(user: UserDoc | null | undefined) {
  return forumAccountRestriction(user, Date.now()) === null;
}

function isTrustedForumUser(user: UserDoc | null | undefined) {
  if (canModerate(user)) {
    return true;
  }
  return (
    isActiveForumAccount(user) &&
    user?.forumTrustedAt !== undefined &&
    user.forumTrustRevokedAt === undefined
  );
}

function shouldHoldForumSubmissionForApproval(
  user: UserDoc | null | undefined,
) {
  return !isTrustedForumUser(user);
}

function categoryViewAccess(
  category: ForumCategoryDoc,
): ForumCategoryViewAccess {
  return category.viewAccess ?? "public";
}

function categoryKind(category: ForumCategoryDoc): ForumCategoryKind {
  return category.kind ?? "board";
}

function isBoardCategory(
  category: ForumCategoryDoc | null | undefined,
): category is ForumCategoryDoc {
  return (
    category !== null &&
    category !== undefined &&
    categoryKind(category) === "board"
  );
}

function categoryThreadAccess(
  category: ForumCategoryDoc,
): ForumCategoryWriteAccess {
  return category.threadAccess ?? "trusted";
}

function categoryReplyAccess(
  category: ForumCategoryDoc,
): ForumCategoryWriteAccess {
  return category.replyAccess ?? "trusted";
}

function categoryPollAccess(
  category: ForumCategoryDoc,
): ForumCategoryWriteAccess {
  return category.pollAccess ?? "trusted";
}

function canUseCategoryViewAccess(
  user: UserDoc | null | undefined,
  access: ForumCategoryViewAccess,
  userCanModerateCategory = canModerate(user),
) {
  if (userCanModerateCategory) {
    return true;
  }
  if (access === "public") {
    return true;
  }
  if (access === "members") {
    return user !== null && user !== undefined;
  }
  if (access === "trusted") {
    return isTrustedForumUser(user);
  }
  return canModerate(user);
}

function canUseCategoryWriteAccess(
  user: UserDoc | null | undefined,
  access: ForumCategoryWriteAccess,
  userCanModerateCategory = canModerate(user),
) {
  if (user !== null && user !== undefined && !isActiveForumAccount(user)) {
    return false;
  }
  if (userCanModerateCategory) {
    return true;
  }
  if (access === "closed") {
    return false;
  }
  if (access === "members") {
    return user !== null && user !== undefined;
  }
  if (access === "trusted") {
    return isTrustedForumUser(user);
  }
  return false;
}

function canViewCategory(
  user: UserDoc | null | undefined,
  category: ForumCategoryDoc | null | undefined,
  userCanModerateCategory = canModerate(user),
) {
  if (user !== null && user !== undefined && !isActiveForumAccount(user)) {
    return false;
  }
  return (
    category !== null &&
    category !== undefined &&
    category.status === "active" &&
    canUseCategoryViewAccess(
      user,
      categoryViewAccess(category),
      userCanModerateCategory,
    )
  );
}

async function canViewCategoryWithAncestors(
  ctx: QueryCtx | MutationCtx,
  user: UserDoc | null | undefined,
  category: ForumCategoryDoc | null | undefined,
) {
  if (
    category === null ||
    category === undefined ||
    !canViewCategory(
      user,
      category,
      await canModerateCategory(ctx, user, category),
    )
  ) {
    return false;
  }

  const targetModeratorOverride = await canModerateCategory(
    ctx,
    user,
    category,
  );

  let parentCategoryId = category.parentCategoryId;
  for (
    let depth = 0;
    depth < 10 && parentCategoryId !== undefined;
    depth += 1
  ) {
    const parent = await ctx.db.get(parentCategoryId);
    if (
      parent === null ||
      !canViewCategory(
        user,
        parent,
        targetModeratorOverride ||
          (await canModerateCategory(ctx, user, parent)),
      )
    ) {
      return false;
    }
    parentCategoryId = parent.parentCategoryId;
  }
  return parentCategoryId === undefined;
}

async function canHostVisibleThreads(
  ctx: QueryCtx | MutationCtx,
  category: ForumCategoryDoc | null | undefined,
) {
  if (
    category === null ||
    category === undefined ||
    category.status !== "active" ||
    !isBoardCategory(category)
  ) {
    return false;
  }

  const categoryRank = categoryViewAccessRank(categoryViewAccess(category));
  let parentCategoryId = category.parentCategoryId;
  for (
    let depth = 0;
    depth < 10 && parentCategoryId !== undefined;
    depth += 1
  ) {
    const parent = await ctx.db.get(parentCategoryId);
    if (parent === null || parent.status !== "active") {
      return false;
    }
    if (categoryViewAccessRank(categoryViewAccess(parent)) > categoryRank) {
      return false;
    }
    parentCategoryId = parent.parentCategoryId;
  }
  return parentCategoryId === undefined;
}

async function visibleCategoriesForUser(
  ctx: QueryCtx | MutationCtx,
  categories: ForumCategoryDoc[],
  user: UserDoc | null | undefined,
) {
  const visible = await Promise.all(
    categories.map(async (category) =>
      (await canViewCategoryWithAncestors(ctx, user, category))
        ? category
        : null,
    ),
  );
  return visible.flatMap((category) => (category === null ? [] : [category]));
}

function canStartThreadInCategory(
  user: UserDoc | null | undefined,
  category: ForumCategoryDoc | null | undefined,
  userCanModerateCategory = canModerate(user),
) {
  return (
    canViewCategory(user, category, userCanModerateCategory) &&
    isBoardCategory(category) &&
    canUseCategoryWriteAccess(
      user,
      categoryThreadAccess(category),
      userCanModerateCategory,
    )
  );
}

function canReplyInCategory(
  user: UserDoc | null | undefined,
  category: ForumCategoryDoc | null | undefined,
  userCanModerateCategory = canModerate(user),
) {
  return (
    canViewCategory(user, category, userCanModerateCategory) &&
    isBoardCategory(category) &&
    canUseCategoryWriteAccess(
      user,
      categoryReplyAccess(category),
      userCanModerateCategory,
    )
  );
}

function canVoteInCategory(
  user: UserDoc | null | undefined,
  category: ForumCategoryDoc | null | undefined,
  userCanModerateCategory = canModerate(user),
) {
  return (
    canViewCategory(user, category, userCanModerateCategory) &&
    isBoardCategory(category) &&
    canUseCategoryWriteAccess(
      user,
      categoryPollAccess(category),
      userCanModerateCategory,
    )
  );
}

function canGiveForumReputation(
  user: UserDoc | null | undefined,
  targetUserId: Id<"users">,
) {
  return (
    user !== null &&
    user !== undefined &&
    user._id !== targetUserId &&
    isTrustedForumUser(user)
  );
}

async function resolveCategoryParentId(
  ctx: QueryCtx | MutationCtx,
  options: {
    categoryId?: Id<"forumCategories">;
    kind: ForumCategoryKind;
    parentCategoryId?: Id<"forumCategories">;
    viewAccess: ForumCategoryViewAccess;
  },
) {
  if (options.kind === "section") {
    if (options.parentCategoryId !== undefined) {
      throw forumError(
        "INVALID_CATEGORY_PARENT",
        "Section headers cannot be nested under another category.",
      );
    }
    return undefined;
  }

  if (options.parentCategoryId === undefined) {
    return undefined;
  }
  if (
    options.categoryId !== undefined &&
    options.parentCategoryId === options.categoryId
  ) {
    throw forumError(
      "INVALID_CATEGORY_PARENT",
      "A board cannot be its own parent.",
    );
  }

  const parent = await ctx.db.get(options.parentCategoryId);
  if (parent === null) {
    throw forumError(
      "INVALID_CATEGORY_PARENT",
      "Parent category was not found.",
    );
  }
  if (parent.status !== "active") {
    throw forumError(
      "INVALID_CATEGORY_PARENT",
      "Boards can only be nested under active categories.",
    );
  }
  if (
    categoryViewAccessRank(options.viewAccess) <
    categoryViewAccessRank(categoryViewAccess(parent))
  ) {
    throw forumError(
      "INVALID_CATEGORY_PARENT",
      "Child boards cannot be more public than their parent category.",
    );
  }

  if (
    categoryKind(parent) === "board" &&
    parent.parentCategoryId !== undefined
  ) {
    const grandparent = await ctx.db.get(parent.parentCategoryId);
    if (isBoardCategory(grandparent)) {
      throw forumError(
        "INVALID_CATEGORY_PARENT",
        "Subforums can only be nested one level beneath a board.",
      );
    }
  }

  let cursor: ForumCategoryDoc | null = parent;
  for (
    let depth = 0;
    depth < 10 && cursor?.parentCategoryId !== undefined;
    depth += 1
  ) {
    if (
      options.categoryId !== undefined &&
      cursor.parentCategoryId === options.categoryId
    ) {
      throw forumError(
        "INVALID_CATEGORY_PARENT",
        "That parent would create a category cycle.",
      );
    }
    cursor = await ctx.db.get(cursor.parentCategoryId);
  }

  return options.parentCategoryId;
}

function categoryViewAccessRank(access: ForumCategoryViewAccess) {
  if (access === "public") {
    return 0;
  }
  if (access === "members") {
    return 1;
  }
  if (access === "trusted") {
    return 2;
  }
  return 3;
}

function categoryPermissionMessage(
  category: ForumCategoryDoc,
  action: "thread" | "reply" | "poll",
) {
  const actionLabel =
    action === "thread"
      ? "start threads"
      : action === "reply"
        ? "reply"
        : "vote";
  const access =
    action === "thread"
      ? categoryThreadAccess(category)
      : action === "reply"
        ? categoryReplyAccess(category)
        : categoryPollAccess(category);

  if (access === "members") {
    return `Sign in to ${actionLabel} in this board.`;
  }
  if (access === "staff" || access === "closed") {
    return `Only staff can ${actionLabel} in this board.`;
  }
  return `Ask the site owner to approve your forum access before you ${actionLabel} here.`;
}

function requireTrustedForumUser(user: UserDoc, message: string) {
  if (!isTrustedForumUser(user)) {
    throw forumError("FORUM_TRUST_REQUIRED", message);
  }
}

function canEditThread(
  user: UserDoc | null | undefined,
  thread: ForumThreadDoc,
  category?: ForumCategoryDoc | null,
  userCanModerateCategory = canModerate(user),
) {
  if (
    user === null ||
    user === undefined ||
    !isVisibleThreadStatus(thread.status)
  ) {
    return false;
  }
  const hasWriteAccess =
    category === undefined
      ? isTrustedForumUser(user)
      : canStartThreadInCategory(user, category, userCanModerateCategory);
  if (!userCanModerateCategory && !hasWriteAccess) {
    return false;
  }
  if (thread.status === "locked" && !userCanModerateCategory) {
    return false;
  }
  return userCanModerateCategory || thread.authorId === user._id;
}

function canDeleteThread(
  user: UserDoc | null | undefined,
  thread: ForumThreadDoc,
  category?: ForumCategoryDoc | null,
  userCanModerateCategory = canModerate(user),
) {
  if (!canEditThread(user, thread, category, userCanModerateCategory)) {
    return false;
  }
  return userCanModerateCategory || thread.replyCount === 0;
}

function canEditPost(
  user: UserDoc | null | undefined,
  post: ForumPostDoc,
  thread: ForumThreadDoc,
  category?: ForumCategoryDoc | null,
  userCanModerateCategory = canModerate(user),
) {
  if (
    user === null ||
    user === undefined ||
    post.status !== "active" ||
    !isVisibleThreadStatus(thread.status)
  ) {
    return false;
  }
  const hasWriteAccess =
    category === undefined
      ? isTrustedForumUser(user)
      : canReplyInCategory(user, category, userCanModerateCategory);
  if (!userCanModerateCategory && !hasWriteAccess) {
    return false;
  }
  if (thread.status === "locked" && !userCanModerateCategory) {
    return false;
  }
  return userCanModerateCategory || post.authorId === user._id;
}

function canDeletePost(
  user: UserDoc | null | undefined,
  post: ForumPostDoc,
  thread: ForumThreadDoc,
  category?: ForumCategoryDoc | null,
  userCanModerateCategory = canModerate(user),
) {
  return canEditPost(user, post, thread, category, userCanModerateCategory);
}

function isVisibleThreadStatus(status: ForumThreadStatus) {
  return status === "active" || status === "locked";
}

function displayName(
  user: Pick<UserDoc, "username" | "name"> | null | undefined,
) {
  return user?.username ?? user?.name ?? UNKNOWN_AUTHOR;
}

function forumAgentNameFromSlug(agentSlug: string) {
  return agentSlug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

const UNKNOWN_AUTHOR = "SYM-UNKNOWN";

function normalizeForumEmailDestination(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function forumEmailDestination(user: UserDoc) {
  const contactEmail = normalizeForumEmailDestination(user.contactEmail);
  if (contactEmail !== null) {
    return contactEmail;
  }

  const accountEmail = normalizeForumEmailDestination(user.email);
  if (accountEmail === null || isSyntheticForumAuthEmail(accountEmail)) {
    return null;
  }
  return accountEmail;
}

function isSyntheticForumAuthEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  return (
    domain === "users.symbaiex.local" || domain?.endsWith(".local") === true
  );
}

function forumEmailDestinationLabel(email: string) {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) {
    return "Email on account";
  }
  const visibleLocal =
    localPart.length <= 2
      ? `${localPart[0] ?? "*"}*`
      : `${localPart.slice(0, 2)}***`;
  return `${visibleLocal}@${domain}`;
}

function clampLimit(
  rawLimit: number | undefined,
  defaultLimit: number,
  maxLimit: number,
) {
  return Math.max(1, Math.min(Math.floor(rawLimit ?? defaultLimit), maxLimit));
}

function normalizePage(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function normalizePageSize(
  value: number | undefined,
  defaultSize: number,
  maxSize: number,
) {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultSize;
  }
  return Math.max(1, Math.min(Math.floor(value), maxSize));
}

function pageCount(totalItems: number, pageSize: number) {
  return Math.max(1, Math.ceil(Math.max(0, totalItems) / pageSize));
}

function pageForPostNumber(postNumber: number, pageSize: number) {
  return Math.max(1, Math.ceil(postNumber / pageSize));
}

function forumNotificationEmailNotReady(reason: string) {
  return {
    ready: false as const,
    reason,
  };
}

function forumNotificationEmailReady(
  delivery: ForumNotificationEmailDeliveryDoc,
  args: {
    actorName: string;
    body: string;
    categoryName: string;
    categorySlug: string;
    post: ForumPostDoc | null;
    recipientName: string;
    threadSlug: string;
    threadTitle: string;
  },
) {
  const postNumber =
    typeof args.post?.postNumber === "number" ? args.post.postNumber : null;
  return {
    ready: true as const,
    actorName: args.actorName,
    categoryName: args.categoryName,
    categorySlug: args.categorySlug,
    excerpt: excerpt(args.body, 260) || "No text preview available.",
    postNumber,
    postPage:
      postNumber === null
        ? null
        : pageForPostNumber(postNumber, POST_PAGE_SIZE),
    recipientName: args.recipientName,
    threadSlug: args.threadSlug,
    threadTitle: args.threadTitle,
    toEmail: delivery.toEmail,
    type: delivery.type,
  };
}

function threadPostNumberCeiling(thread: ForumThreadDoc) {
  return Math.max(1, thread.replyCount + 1, thread.lastAssignedPostNumber ?? 1);
}

function visibleThreadPostCount(thread: ForumThreadDoc) {
  return Math.max(1, thread.replyCount + 1);
}

function ratingAverage(ratingCount: number, ratingTotal: number) {
  return ratingCount <= 0
    ? 0
    : Math.round((ratingTotal / ratingCount) * 10) / 10;
}

function threadRatingAverage(thread: ForumThreadDoc) {
  return ratingAverage(thread.ratingCount ?? 0, thread.ratingTotal ?? 0);
}

function effectiveThreadRead(
  threadRead: ForumReadSnapshot | null | undefined,
  categoryRead: ForumReadSnapshot | null | undefined,
): ForumReadSnapshot | null {
  const threadReadAt = threadRead?.lastReadAt ?? 0;
  const categoryReadAt = categoryRead?.lastReadAt ?? 0;
  const lastReadAt = Math.max(threadReadAt, categoryReadAt);
  if (lastReadAt <= 0) {
    return null;
  }
  if (threadReadAt > categoryReadAt) {
    return {
      lastReadAt,
      lastReadPostNumber: threadRead?.lastReadPostNumber,
    };
  }
  return { lastReadAt };
}

function threadReadActivityAt(thread: ForumThreadDoc) {
  return Math.max(thread.lastPostAt, thread.moderationActivityAt ?? 0);
}

function categoryReadActivityAt(category: ForumCategoryDoc) {
  return Math.max(
    category.lastPostAt ?? category.createdAt,
    category.moderationActivityAt ?? 0,
  );
}

function hasReadCategory(
  category: ForumCategoryDoc,
  categoryRead: ForumReadSnapshot | null | undefined,
) {
  if (category.threadCount <= 0 && category.postCount <= 0) {
    return true;
  }
  if (categoryRead === null || categoryRead === undefined) {
    return false;
  }
  return categoryRead.lastReadAt >= categoryReadActivityAt(category);
}

function threadRootReadActivityAt(thread: ForumThreadDoc) {
  return Math.max(thread.createdAt, thread.moderationRootActivityAt ?? 0);
}

function postReadActivityAt(post: ForumPostDoc) {
  return Math.max(post.createdAt, post.moderationMovedAt ?? 0);
}

function readCoversThread(thread: ForumThreadDoc, read: ForumReadSnapshot) {
  const activityAt = threadReadActivityAt(thread);
  if (read.lastReadAt > activityAt) {
    return true;
  }
  if (read.lastReadAt < activityAt) {
    return false;
  }
  return (
    read.lastReadPostNumber === undefined ||
    read.lastReadPostNumber >= threadPostNumberCeiling(thread)
  );
}

function hasReadThread(
  thread: ForumThreadDoc,
  threadRead: ForumReadSnapshot | null | undefined,
  categoryRead: ForumReadSnapshot | null | undefined,
) {
  const read = effectiveThreadRead(threadRead, categoryRead);
  return read === null ? false : readCoversThread(thread, read);
}

function paginationRecord({
  actualTotalItems,
  page,
  pageSize,
  totalItems,
}: {
  actualTotalItems?: number;
  page: number;
  pageSize: number;
  totalItems: number;
}) {
  const realTotalItems = Math.max(totalItems, actualTotalItems ?? totalItems);
  const totalPages = pageCount(totalItems, pageSize);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startItem = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endItem = Math.min(totalItems, safePage * pageSize);

  return {
    page: safePage,
    pageSize,
    totalItems,
    totalPages,
    startItem,
    endItem,
    hasPreviousPage: safePage > 1,
    hasNextPage: safePage < totalPages,
    limited: realTotalItems > totalItems,
    actualTotalItems: realTotalItems > totalItems ? realTotalItems : undefined,
  };
}

function normalizeCategorySlug(value: string, label: string) {
  const slug = value.trim().toLowerCase();
  if (!CATEGORY_SLUG_PATTERN.test(slug)) {
    throw forumError(
      "INVALID_SLUG",
      `${label} must be 2-64 lowercase letters, numbers, or dashes.`,
    );
  }
  if (RESERVED_CATEGORY_SLUGS.has(slug)) {
    throw forumError(
      "RESERVED_CATEGORY_SLUG",
      `${label} cannot use a reserved forum route.`,
    );
  }
  return slug;
}

function normalizeThreadSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!THREAD_SLUG_PATTERN.test(slug)) {
    throw forumError("INVALID_THREAD_SLUG", "That thread address is invalid.");
  }
  return slug;
}

function normalizeCategoryName(value: string) {
  const name = cleanRequired(
    value,
    CATEGORY_NAME_MIN_LENGTH,
    CATEGORY_NAME_MAX_LENGTH,
    "Board name",
  );
  return name;
}

function normalizeCategoryDescription(value: string | undefined) {
  return cleanOptional(value, CATEGORY_DESCRIPTION_MAX_LENGTH) ?? "";
}

function normalizeThreadPrefixSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!THREAD_PREFIX_SLUG_PATTERN.test(slug)) {
    throw forumError(
      "INVALID_THREAD_PREFIX_SLUG",
      "Prefix slugs must be 2-32 lowercase letters, numbers, or dashes.",
    );
  }
  return slug;
}

function normalizeThreadPrefixLabel(value: string) {
  return cleanRequired(
    value,
    THREAD_PREFIX_LABEL_MIN_LENGTH,
    THREAD_PREFIX_LABEL_MAX_LENGTH,
    "Prefix label",
  );
}

function normalizeThreadPrefixColor(value: string | undefined) {
  const color = cleanOptional(value, 7);
  if (color === undefined) {
    return undefined;
  }
  const normalized = color.toLowerCase();
  if (!THREAD_PREFIX_COLOR_PATTERN.test(normalized)) {
    throw forumError(
      "INVALID_THREAD_PREFIX_COLOR",
      "Prefix colors must be six-digit hex values like #ff00aa.",
    );
  }
  return normalized;
}

function normalizeForumAnnouncementSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!FORUM_ANNOUNCEMENT_SLUG_PATTERN.test(slug)) {
    throw forumError(
      "INVALID_FORUM_ANNOUNCEMENT_SLUG",
      "Announcement slugs must be 2-64 lowercase letters, numbers, or dashes.",
    );
  }
  return slug;
}

function normalizeForumAnnouncementTitle(value: string) {
  return cleanRequired(
    value,
    FORUM_ANNOUNCEMENT_TITLE_MIN_LENGTH,
    FORUM_ANNOUNCEMENT_TITLE_MAX_LENGTH,
    "Announcement title",
  );
}

function normalizeForumAnnouncementBody(value: string) {
  return cleanRequired(
    value,
    FORUM_ANNOUNCEMENT_BODY_MIN_LENGTH,
    FORUM_ANNOUNCEMENT_BODY_MAX_LENGTH,
    "Announcement body",
  );
}

function normalizeForumHelpDocumentSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!FORUM_HELP_DOCUMENT_SLUG_PATTERN.test(slug)) {
    throw forumError(
      "INVALID_FORUM_HELP_DOCUMENT_SLUG",
      "Help document slugs must be 2-64 lowercase letters, numbers, or dashes.",
    );
  }
  return slug;
}

function normalizeForumHelpDocumentTitle(value: string) {
  return cleanRequired(
    value,
    FORUM_HELP_DOCUMENT_TITLE_MIN_LENGTH,
    FORUM_HELP_DOCUMENT_TITLE_MAX_LENGTH,
    "Help document title",
  );
}

function normalizeForumHelpDocumentBody(value: string) {
  return cleanRequired(
    value,
    FORUM_HELP_DOCUMENT_BODY_MIN_LENGTH,
    FORUM_HELP_DOCUMENT_BODY_MAX_LENGTH,
    "Help document body",
  );
}

function normalizeForumCalendarEventSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!FORUM_CALENDAR_EVENT_SLUG_PATTERN.test(slug)) {
    throw forumError(
      "INVALID_FORUM_CALENDAR_EVENT_SLUG",
      "Calendar event slugs must be 2-64 lowercase letters, numbers, or dashes.",
    );
  }
  return slug;
}

function normalizeForumCalendarEventTitle(value: string) {
  return cleanRequired(
    value,
    FORUM_CALENDAR_EVENT_TITLE_MIN_LENGTH,
    FORUM_CALENDAR_EVENT_TITLE_MAX_LENGTH,
    "Calendar event title",
  );
}

function normalizeForumCalendarEventBody(value: string) {
  return cleanRequired(
    value,
    FORUM_CALENDAR_EVENT_BODY_MIN_LENGTH,
    FORUM_CALENDAR_EVENT_BODY_MAX_LENGTH,
    "Calendar event body",
  );
}

function normalizeForumCalendarTimestamp(value: number, label: string) {
  const timestamp = Math.floor(value);
  if (!Number.isFinite(value) || Number.isNaN(new Date(timestamp).getTime())) {
    throw forumError(
      "INVALID_FORUM_CALENDAR_EVENT_TIME",
      `${label} must be a valid timestamp.`,
    );
  }
  return timestamp;
}

function normalizeForumCalendarMonth(value: string) {
  const month = value.trim();
  if (!FORUM_CALENDAR_MONTH_PATTERN.test(month)) {
    throw forumError(
      "INVALID_FORUM_CALENDAR_MONTH",
      "Calendar month must use YYYY-MM format.",
    );
  }
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  if (year < 1970 || monthNumber < 1 || monthNumber > 12) {
    throw forumError(
      "INVALID_FORUM_CALENDAR_MONTH",
      "Calendar month must be a valid YYYY-MM value.",
    );
  }
  return month;
}

function forumCalendarDateParts(startsAt: number) {
  const dateParts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: FORUM_CALENDAR_TIME_ZONE,
    year: "numeric",
  }).formatToParts(new Date(startsAt));
  const year = dateParts
    .find((part) => part.type === "year")
    ?.value.padStart(4, "0");
  const month = dateParts.find((part) => part.type === "month")?.value;
  const day = dateParts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw forumError(
      "INVALID_FORUM_CALENDAR_EVENT_TIME",
      "Event start must resolve to a valid forum calendar date.",
    );
  }
  const isoDate = `${year}-${month}-${day}`;
  return {
    month: isoDate.slice(0, 7),
    day: isoDate,
  };
}

function normalizeForumBoardRulesTitle(value: string) {
  return cleanRequired(
    value,
    FORUM_BOARD_RULES_TITLE_MIN_LENGTH,
    FORUM_BOARD_RULES_TITLE_MAX_LENGTH,
    "Board rules title",
  );
}

function normalizeForumBoardRulesBody(value: string) {
  return cleanRequired(
    value,
    FORUM_BOARD_RULES_BODY_MIN_LENGTH,
    FORUM_BOARD_RULES_BODY_MAX_LENGTH,
    "Board rules body",
  );
}

function normalizeTitle(value: string) {
  return cleanRequired(
    value,
    THREAD_TITLE_MIN_LENGTH,
    THREAD_TITLE_MAX_LENGTH,
    "Thread title",
  );
}

function normalizeThreadBody(value: string) {
  return cleanRequired(
    value,
    THREAD_BODY_MIN_LENGTH,
    FORUM_THREAD_BODY_MAX_LENGTH,
    "Thread body",
  );
}

function normalizeReplyBody(value: string) {
  return cleanRequired(
    value,
    REPLY_BODY_MIN_LENGTH,
    FORUM_REPLY_BODY_MAX_LENGTH,
    "Reply body",
  );
}

function normalizePollInput(
  poll:
    | {
        question: string;
        options: string[];
      }
    | undefined,
) {
  if (poll === undefined) {
    return null;
  }
  const question = cleanRequired(
    poll.question,
    POLL_QUESTION_MIN_LENGTH,
    POLL_QUESTION_MAX_LENGTH,
    "Poll question",
  );
  if (
    poll.options.length < POLL_MIN_OPTIONS ||
    poll.options.length > POLL_MAX_OPTIONS
  ) {
    throw forumError(
      "INVALID_POLL",
      `Polls need ${POLL_MIN_OPTIONS}-${POLL_MAX_OPTIONS} options.`,
    );
  }
  const options = poll.options.map((option) =>
    cleanRequired(
      option,
      POLL_OPTION_MIN_LENGTH,
      POLL_OPTION_MAX_LENGTH,
      "Poll option",
    ),
  );
  const distinctOptions = new Set(
    options.map((option) => option.toLowerCase()),
  );
  if (distinctOptions.size !== options.length) {
    throw forumError("INVALID_POLL", "Poll options must be unique.");
  }
  return { question, options };
}

function cleanRequired(
  value: string,
  minLength: number,
  maxLength: number,
  label: string,
) {
  const cleaned = value.trim();
  if (cleaned.length < minLength || cleaned.length > maxLength) {
    throw forumError(
      "INVALID_INPUT",
      `${label} must be between ${minLength} and ${maxLength} characters.`,
    );
  }
  return cleaned;
}

function cleanOptional(value: string | undefined, maxLength: number) {
  if (value === undefined) {
    return undefined;
  }
  const cleaned = value.trim();
  if (cleaned.length === 0) {
    return undefined;
  }
  if (cleaned.length > maxLength) {
    throw forumError(
      "INVALID_INPUT",
      `Value must be ${maxLength} characters or fewer.`,
    );
  }
  return cleaned;
}

function cleanOptionalForumUrl(
  value: string | undefined,
  maxLength: number,
  label: string,
) {
  const cleaned = cleanOptional(value, maxLength);
  if (cleaned === undefined) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw forumError("INVALID_INPUT", `${label} must be a valid URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw forumError("INVALID_INPUT", `${label} must use http or https.`);
  }
  return parsed.toString();
}

function cleanOptionalForumBirthday(value: string | undefined) {
  const cleaned = cleanOptional(value, 10);
  if (cleaned === undefined) {
    return undefined;
  }
  if (!FORUM_PROFILE_BIRTHDAY_PATTERN.test(cleaned)) {
    throw forumError("INVALID_INPUT", "Birthday must use YYYY-MM-DD.");
  }
  const date = new Date(`${cleaned}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== cleaned
  ) {
    throw forumError("INVALID_INPUT", "Birthday must be a valid date.");
  }
  return cleaned;
}

function normalizeWarningPoints(value: number) {
  if (
    !Number.isInteger(value) ||
    value < WARNING_POINTS_MIN ||
    value > WARNING_POINTS_MAX
  ) {
    throw forumError(
      "INVALID_WARNING_POINTS",
      `Warning points must be a whole number from ${WARNING_POINTS_MIN} to ${WARNING_POINTS_MAX}.`,
    );
  }
  return value;
}

function normalizePrivateMessageSubject(value: string) {
  return cleanRequired(
    value,
    PRIVATE_MESSAGE_SUBJECT_MIN_LENGTH,
    PRIVATE_MESSAGE_SUBJECT_MAX_LENGTH,
    "Private message subject",
  );
}

function normalizePrivateMessageBody(value: string) {
  return cleanRequired(
    value,
    PRIVATE_MESSAGE_BODY_MIN_LENGTH,
    PRIVATE_MESSAGE_BODY_MAX_LENGTH,
    "Private message body",
  );
}

function normalizePrivateMessageSearchQuery(value: string | undefined) {
  const cleaned = value?.trim().toLowerCase() ?? "";
  if (cleaned.length > PRIVATE_MESSAGE_SEARCH_MAX_LENGTH) {
    throw forumError(
      "INVALID_PRIVATE_MESSAGE_SEARCH",
      `Private message search must be ${PRIVATE_MESSAGE_SEARCH_MAX_LENGTH} characters or fewer.`,
    );
  }
  return cleaned;
}

async function normalizeForumAttachmentInputs(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  attachments:
    | Array<{ storageId: Id<"_storage">; filename: string }>
    | undefined,
) {
  if (attachments === undefined || attachments.length === 0) {
    return [];
  }
  if (attachments.length > FORUM_ATTACHMENT_MAX_PER_POST) {
    throw forumError(
      "INVALID_ATTACHMENT",
      `Attach up to ${FORUM_ATTACHMENT_MAX_PER_POST} files per post.`,
    );
  }

  const seenStorageIds = new Set<string>();
  return await Promise.all(
    attachments.map(async (attachment) => {
      if (seenStorageIds.has(attachment.storageId)) {
        throw forumError("INVALID_ATTACHMENT", "Attachments must be unique.");
      }
      seenStorageIds.add(attachment.storageId);
      const pendingUpload = (
        await ctx.db
          .query("forumPendingUploads")
          .withIndex("by_userId_and_storageId", (q) =>
            q.eq("userId", userId).eq("storageId", attachment.storageId),
          )
          .take(1)
      )[0];
      if (pendingUpload === undefined || pendingUpload.status !== "pending") {
        throw forumError(
          "INVALID_ATTACHMENT",
          "That attachment upload is not available.",
        );
      }
      if (
        pendingUpload.expiresAt !== undefined &&
        pendingUpload.expiresAt < Date.now()
      ) {
        throw forumError(
          "INVALID_ATTACHMENT",
          "That attachment upload is not available.",
        );
      }
      const metadata = await ctx.db.system.get(
        "_storage",
        attachment.storageId,
      );
      if (metadata === null || metadata.size !== pendingUpload.size) {
        throw forumError(
          "INVALID_ATTACHMENT",
          "That attachment upload is not available.",
        );
      }

      return {
        pendingUploadId: pendingUpload._id,
        storageId: pendingUpload.storageId,
        filename: pendingUpload.filename,
        contentType: pendingUpload.contentType,
        size: pendingUpload.size,
      };
    }),
  );
}

async function assertForumPendingUploadCapacity(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  const now = Date.now();
  const pendingUploads = await ctx.db
    .query("forumPendingUploads")
    .withIndex("by_userId_and_status_and_createdAt", (q) =>
      q.eq("userId", userId).eq("status", "pending"),
    )
    .take(FORUM_PENDING_ATTACHMENT_UPLOAD_USER_LIMIT);
  const activePendingUploads = pendingUploads.filter(
    (upload) => upload.expiresAt === undefined || upload.expiresAt > now,
  );
  if (
    activePendingUploads.length >= FORUM_PENDING_ATTACHMENT_UPLOAD_USER_LIMIT
  ) {
    throw forumError(
      "ATTACHMENT_UPLOAD_LIMIT",
      `Attach or discard existing uploads before adding more files. Up to ${FORUM_PENDING_ATTACHMENT_UPLOAD_USER_LIMIT} pending uploads are allowed at a time.`,
    );
  }
}

async function loadForumAttachmentStorageMetadata(
  ctx: QueryCtx | MutationCtx,
  storageId: Id<"_storage">,
): Promise<ForumStorageMetadata> {
  const metadata = await ctx.db.system.get("_storage", storageId);
  if (metadata === null) {
    throw forumError(
      "INVALID_ATTACHMENT",
      "An attachment upload could not be found.",
    );
  }
  return metadata;
}

function normalizeForumAttachmentUpload(
  storageId: Id<"_storage">,
  filename: string,
  metadata: ForumStorageMetadata,
  fallbackContentType?: string,
) {
  if (metadata.size > FORUM_ATTACHMENT_MAX_FILE_BYTES) {
    throw forumError(
      "INVALID_ATTACHMENT",
      "Attachments must be 5 MB or smaller.",
    );
  }
  const contentType =
    metadata.contentType ?? fallbackContentType ?? "application/octet-stream";
  if (!isAllowedForumAttachmentContentType(contentType)) {
    throw forumError(
      "INVALID_ATTACHMENT",
      "That attachment type is not allowed.",
    );
  }

  return {
    storageId,
    filename: normalizeForumAttachmentFilename(filename),
    contentType,
    size: metadata.size,
  };
}

async function planForumAttachmentEdit(
  ctx: MutationCtx,
  args: {
    threadId: Id<"forumThreads">;
    postId: Id<"forumPosts"> | undefined;
    userId: Id<"users">;
    attachments:
      | Array<{ storageId: Id<"_storage">; filename: string }>
      | undefined;
    attachmentIdsToKeep: Array<Id<"forumAttachments">> | undefined;
  },
): Promise<ForumAttachmentEditPlan | null> {
  if (
    args.attachments === undefined &&
    args.attachmentIdsToKeep === undefined
  ) {
    return null;
  }

  const currentAttachments = await loadActiveForumAttachmentsForPost(
    ctx,
    args.threadId,
    args.postId,
  );
  const currentById = new Map(
    currentAttachments.map((attachment) => [attachment._id, attachment]),
  );
  const requestedKeepIds =
    args.attachmentIdsToKeep ??
    currentAttachments.map((attachment) => attachment._id);
  const attachmentIdsToKeep = new Set<Id<"forumAttachments">>();

  for (const attachmentId of requestedKeepIds) {
    if (attachmentIdsToKeep.has(attachmentId)) {
      throw forumError("INVALID_ATTACHMENT", "Attachments must be unique.");
    }
    if (!currentById.has(attachmentId)) {
      throw forumError(
        "INVALID_ATTACHMENT",
        "One of those attachments is not attached to this post.",
      );
    }
    attachmentIdsToKeep.add(attachmentId);
  }

  const newAttachments = await normalizeForumAttachmentInputs(
    ctx,
    args.userId,
    args.attachments,
  );
  const keptAttachments = currentAttachments.filter((attachment) =>
    attachmentIdsToKeep.has(attachment._id),
  );
  const keptStorageIds = new Set(
    keptAttachments.map((attachment) => attachment.storageId),
  );
  for (const attachment of newAttachments) {
    if (keptStorageIds.has(attachment.storageId)) {
      throw forumError("INVALID_ATTACHMENT", "Attachments must be unique.");
    }
  }

  if (
    keptAttachments.length + newAttachments.length >
    FORUM_ATTACHMENT_MAX_PER_POST
  ) {
    throw forumError(
      "INVALID_ATTACHMENT",
      `Attach up to ${FORUM_ATTACHMENT_MAX_PER_POST} files per post.`,
    );
  }

  return {
    currentAttachments,
    attachmentIdsToKeep,
    newAttachments,
    changed:
      attachmentIdsToKeep.size !== currentAttachments.length ||
      newAttachments.length > 0,
  };
}

async function applyForumAttachmentEditPlan(
  ctx: MutationCtx,
  args: {
    plan: ForumAttachmentEditPlan;
    actorUserId: Id<"users">;
    authorId: Id<"users">;
    categoryId: Id<"forumCategories">;
    threadId: Id<"forumThreads">;
    postId: Id<"forumPosts"> | undefined;
    now: number;
  },
) {
  for (const attachment of args.plan.currentAttachments) {
    if (!args.plan.attachmentIdsToKeep.has(attachment._id)) {
      await ctx.db.patch(attachment._id, {
        status: "deleted",
        deletedAt: args.now,
        deletedBy: args.actorUserId,
        updatedAt: args.now,
      });
    }
  }

  if (args.plan.newAttachments.length > 0) {
    await insertForumAttachments(ctx, {
      attachments: args.plan.newAttachments,
      authorId: args.authorId,
      categoryId: args.categoryId,
      postId: args.postId,
      threadId: args.threadId,
      now: args.now,
    });
  }
}

function normalizeForumAttachmentFilename(value: string) {
  const cleaned = value
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, FORUM_ATTACHMENT_FILENAME_MAX_LENGTH);
  return cleaned.length === 0 ? "attachment" : cleaned;
}

function isAllowedForumAttachmentContentType(value: string) {
  const normalized = value.toLowerCase();
  return FORUM_ATTACHMENT_ALLOWED_CONTENT_TYPES.some(
    (contentType) => contentType === normalized,
  );
}

async function deleteForumStorageObjectIfPresent(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
) {
  const metadata = await ctx.db.system.get("_storage", storageId);
  if (metadata !== null) {
    await ctx.storage.delete(storageId);
  }
}

function normalizeRequiredForumUsername(value: string) {
  const normalized = normalizeSearchAuthor(value);
  if (normalized === undefined || normalized === null) {
    throw forumError("INVALID_RECIPIENT", "Enter a valid SYM username.");
  }
  return normalized;
}

function normalizeSearchQuery(value: string) {
  const cleaned = value.trim();
  if (cleaned.length < 2 || cleaned.length > 120) {
    throw forumError(
      "INVALID_SEARCH",
      "Search text must be between 2 and 120 characters.",
    );
  }
  return cleaned;
}

function normalizeOptionalSearchQuery(value: string | undefined) {
  const cleaned = value?.trim() ?? "";
  if (cleaned.length === 0) {
    return null;
  }
  return normalizeSearchQuery(cleaned);
}

function normalizeSearchAuthor(value: string | undefined) {
  const cleaned = value?.trim().replace(/^@/, "").toLowerCase();
  if (cleaned === undefined || cleaned.length === 0) {
    return undefined;
  }
  if (!USERNAME_PATTERN.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function searchAuthorLabel(value: string | undefined) {
  const cleaned = value?.trim().replace(/^@/, "").toLowerCase();
  return cleaned === undefined || cleaned.length === 0 ? null : cleaned;
}

function normalizeMemberSearchQuery(value: string | undefined) {
  const cleaned = value?.trim().toLowerCase() ?? "";
  if (cleaned.length > 80) {
    throw forumError("INVALID_MEMBER_SEARCH", "Member search is too long.");
  }
  return cleaned;
}

async function searchAuthor(ctx: QueryCtx, value: string | undefined) {
  const normalized = normalizeSearchAuthor(value);
  if (normalized === undefined) {
    return undefined;
  }
  if (normalized === null) {
    return { notFound: true as const };
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_usernameNormalized", (q) =>
      q.eq("usernameNormalized", normalized),
    )
    .unique();
  return user === null ? { notFound: true as const } : { userId: user._id };
}

function pageSearchHits<T>(items: T[], page: number, pageSize: number) {
  const startIndex = (page - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);
  return {
    items: pageItems,
    hasNextPage: items.length > startIndex + pageSize,
  };
}

function searchRequestedFetchLimit(
  page: number,
  pageSize: number,
  useFullScan: boolean,
) {
  if (useFullScan) {
    return SEARCH_PAGE_SCAN_LIMIT;
  }
  return page * pageSize + 1;
}

function searchPaginationRecord(
  page: number,
  pageSize: number,
  itemCount: number,
  hasNextPage: boolean,
  limited = false,
) {
  const totalItems = Math.max(
    0,
    (page - 1) * pageSize + itemCount + (hasNextPage ? 1 : 0),
  );
  return paginationRecord({
    page,
    pageSize,
    totalItems,
    actualTotalItems: limited ? totalItems + 1 : undefined,
  });
}

function searchFiltersRecord(
  resultType: "all" | "threads" | "replies",
  author: string | null,
  target: ForumSearchTarget,
  sortKey: ForumSearchSortKey,
  days: number | undefined,
) {
  return {
    resultType,
    author,
    target,
    sortKey,
    ...(days === undefined ? {} : { days }),
  };
}

function searchVisibilityFetchLimit(limit: number) {
  return Math.min(
    SEARCH_VISIBILITY_SCAN_LIMIT,
    Math.max(limit * 6, SEARCH_PAGE_SCAN_LIMIT),
  );
}

function normalizePosition(value: number) {
  const position = Math.floor(value);
  if (!Number.isFinite(position) || position < 0 || position > 10_000) {
    throw forumError("INVALID_POSITION", "Board position is invalid.");
  }
  return position;
}

function slugify(value: string) {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return base.length > 0 ? base : `thread-${Date.now()}`;
}

async function generateUniqueThreadSlug(
  ctx: MutationCtx,
  categorySlug: string,
  title: string,
) {
  const base = slugify(title).slice(0, 90);
  for (let index = 0; index < 50; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = `${base}${suffix}`.slice(0, 96);
    const existing = await ctx.db
      .query("forumThreads")
      .withIndex("by_categorySlug_and_slug", (q) =>
        q.eq("categorySlug", categorySlug).eq("slug", candidate),
      )
      .unique();
    if (existing === null) {
      return candidate;
    }
  }
  throw forumError(
    "THREAD_SLUG_CONFLICT",
    "Could not allocate a unique thread address.",
  );
}

async function movedThreadSlug(
  ctx: MutationCtx,
  thread: ForumThreadDoc,
  targetCategory: ForumCategoryDoc,
) {
  const existing = await ctx.db
    .query("forumThreads")
    .withIndex("by_categorySlug_and_slug", (q) =>
      q.eq("categorySlug", targetCategory.slug).eq("slug", thread.slug),
    )
    .unique();
  if (existing === null || existing._id === thread._id) {
    return thread.slug;
  }
  return await generateUniqueThreadSlug(ctx, targetCategory.slug, thread.title);
}

async function movedThreadSearchText(
  ctx: QueryCtx | MutationCtx,
  thread: ForumThreadDoc,
  targetCategory: ForumCategoryDoc,
  author: string,
  prefixLabel?: string,
) {
  const polls = await ctx.db
    .query("forumPolls")
    .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
    .take(1);
  const poll = polls[0];
  if (poll === undefined) {
    return buildThreadSearchText(
      targetCategory,
      thread.title,
      threadSearchBodyWithPrefix(thread.body, prefixLabel),
      author,
    );
  }
  const options = await ctx.db
    .query("forumPollOptions")
    .withIndex("by_pollId_and_position", (q) => q.eq("pollId", poll._id))
    .take(POLL_MAX_OPTIONS);
  return buildThreadSearchText(
    targetCategory,
    thread.title,
    threadSearchBodyWithPrefix(
      [
        thread.body,
        poll.question,
        ...options.map((option) => option.label),
      ].join("\n"),
      prefixLabel,
    ),
    author,
  );
}

const THREAD_MOVE_SYNC_PHASES: ThreadMoveSyncPhase[] = [
  "posts",
  "attachments",
  "polls",
  "reports",
  "notifications",
  "notificationEmails",
  "reputations",
  "warnings",
  "moderationEvents",
  "views",
  "reads",
  "activeSubscriptions",
  "mutedSubscriptions",
];

function nextThreadMoveSyncPhase(phase: ThreadMoveSyncPhase) {
  const index = THREAD_MOVE_SYNC_PHASES.indexOf(phase);
  return index === -1 ? null : (THREAD_MOVE_SYNC_PHASES[index + 1] ?? null);
}

async function scheduleMovedThreadCategoryReferenceSync(
  ctx: MutationCtx,
  args: {
    threadId: Id<"forumThreads">;
    targetCategoryId: Id<"forumCategories">;
    now: number;
    token: string;
    phase: ThreadMoveSyncPhase;
    cursor?: string;
  },
) {
  await ctx.scheduler.runAfter(
    0,
    internal.forum.continueMovedThreadCategoryReferenceSync,
    {
      threadId: args.threadId,
      targetCategoryId: args.targetCategoryId,
      now: args.now,
      token: args.token,
      phase: args.phase,
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    },
  );
}

async function syncMovedThreadCategoryReferenceBatch(
  ctx: MutationCtx,
  args: {
    threadId: Id<"forumThreads">;
    targetCategoryId: Id<"forumCategories">;
    now: number;
    token: string;
    phase: ThreadMoveSyncPhase;
    cursor?: string;
  },
) {
  const thread = await ctx.db.get(args.threadId);
  if (
    thread === null ||
    thread.categoryId !== args.targetCategoryId ||
    thread.categoryReferenceSyncToken !== args.token
  ) {
    return;
  }

  const paginationOpts = {
    numItems: THREAD_MOVE_RELATED_RECORD_BATCH_LIMIT,
    cursor: args.cursor ?? null,
  };
  let isDone = true;
  let continueCursor: string | undefined;

  switch (args.phase) {
    case "posts": {
      const page = await ctx.db
        .query("forumPosts")
        .withIndex("by_threadId_and_createdAt", (q) =>
          q.eq("threadId", args.threadId),
        )
        .paginate(paginationOpts);
      for (const post of page.page) {
        await ctx.db.patch(post._id, {
          categoryId: args.targetCategoryId,
          moderationMovedAt: args.now,
          updatedAt: args.now,
        });
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      break;
    }
    case "attachments": {
      const page = await ctx.db
        .query("forumAttachments")
        .withIndex("by_threadId_and_status_and_createdAt", (q) =>
          q.eq("threadId", args.threadId).eq("status", "active"),
        )
        .paginate(paginationOpts);
      for (const attachment of page.page) {
        await ctx.db.patch(attachment._id, {
          categoryId: args.targetCategoryId,
          updatedAt: args.now,
        });
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      break;
    }
    case "polls": {
      const page = await ctx.db
        .query("forumPolls")
        .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
        .paginate(paginationOpts);
      for (const poll of page.page) {
        await ctx.db.patch(poll._id, {
          categoryId: args.targetCategoryId,
          updatedAt: args.now,
        });
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      break;
    }
    case "reports": {
      const page = await ctx.db
        .query("forumReports")
        .withIndex("by_threadId_and_createdAt", (q) =>
          q.eq("threadId", args.threadId),
        )
        .paginate(paginationOpts);
      for (const report of page.page) {
        await ctx.db.patch(report._id, {
          categoryId: args.targetCategoryId,
          updatedAt: args.now,
        });
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      break;
    }
    case "notifications": {
      const page = await ctx.db
        .query("forumNotifications")
        .withIndex("by_threadId_and_createdAt", (q) =>
          q.eq("threadId", args.threadId),
        )
        .paginate(paginationOpts);
      for (const notification of page.page) {
        await ctx.db.patch(notification._id, {
          categoryId: args.targetCategoryId,
          updatedAt: args.now,
        });
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      break;
    }
    case "notificationEmails": {
      const page = await ctx.db
        .query("forumNotificationEmailDeliveries")
        .withIndex("by_threadId_and_recipientUserId_and_type", (q) =>
          q.eq("threadId", args.threadId),
        )
        .paginate(paginationOpts);
      for (const delivery of page.page) {
        await ctx.db.patch(delivery._id, {
          categoryId: args.targetCategoryId,
          updatedAt: args.now,
        });
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      break;
    }
    case "reputations": {
      const page = await ctx.db
        .query("forumReputations")
        .withIndex("by_threadId_and_updatedAt", (q) =>
          q.eq("threadId", args.threadId),
        )
        .paginate(paginationOpts);
      for (const reputation of page.page) {
        await ctx.db.patch(reputation._id, {
          categoryId: args.targetCategoryId,
          updatedAt: args.now,
        });
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      break;
    }
    case "warnings": {
      const page = await ctx.db
        .query("forumWarnings")
        .withIndex("by_threadId_and_createdAt", (q) =>
          q.eq("threadId", args.threadId),
        )
        .paginate(paginationOpts);
      for (const warning of page.page) {
        await ctx.db.patch(warning._id, {
          categoryId: args.targetCategoryId,
          updatedAt: args.now,
        });
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      break;
    }
    case "moderationEvents": {
      const page = await ctx.db
        .query("forumModerationEvents")
        .withIndex("by_threadId_and_createdAt", (q) =>
          q.eq("threadId", args.threadId),
        )
        .paginate(paginationOpts);
      for (const event of page.page) {
        await ctx.db.patch(event._id, {
          categoryId: args.targetCategoryId,
        });
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      break;
    }
    case "views": {
      const page = await ctx.db
        .query("forumThreadViews")
        .withIndex("by_threadId_and_updatedAt", (q) =>
          q.eq("threadId", args.threadId),
        )
        .paginate(paginationOpts);
      for (const view of page.page) {
        await ctx.db.patch(view._id, {
          categoryId: args.targetCategoryId,
          updatedAt: args.now,
        });
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      break;
    }
    case "reads": {
      const page = await ctx.db
        .query("forumThreadReads")
        .withIndex("by_threadId_and_updatedAt", (q) =>
          q.eq("threadId", args.threadId),
        )
        .paginate(paginationOpts);
      for (const read of page.page) {
        await ctx.db.patch(read._id, {
          categoryId: args.targetCategoryId,
          updatedAt: args.now,
        });
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      break;
    }
    case "activeSubscriptions":
    case "mutedSubscriptions": {
      const status = args.phase === "activeSubscriptions" ? "active" : "muted";
      const page = await ctx.db
        .query("forumThreadSubscriptions")
        .withIndex("by_threadId_and_status", (q) =>
          q.eq("threadId", args.threadId).eq("status", status),
        )
        .paginate(paginationOpts);
      for (const subscription of page.page) {
        await ctx.db.patch(subscription._id, {
          categoryId: args.targetCategoryId,
          updatedAt: args.now,
        });
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      break;
    }
  }

  if (!isDone && continueCursor !== undefined) {
    await scheduleMovedThreadCategoryReferenceSync(ctx, {
      ...args,
      cursor: continueCursor,
    });
    return;
  }

  const nextPhase = nextThreadMoveSyncPhase(args.phase);
  if (nextPhase !== null) {
    await scheduleMovedThreadCategoryReferenceSync(ctx, {
      threadId: args.threadId,
      targetCategoryId: args.targetCategoryId,
      now: args.now,
      token: args.token,
      phase: nextPhase,
    });
    return;
  }

  await ctx.db.patch(thread._id, {
    categoryReferenceSyncToken: undefined,
    updatedAt: args.now,
  });
}

async function loadUserNamesById(
  ctx: QueryCtx | MutationCtx,
  userIds: Array<Id<"users">>,
) {
  const distinctUserIds = [...new Set(userIds)];
  const users = await Promise.all(
    distinctUserIds.map(
      async (userId) => [userId, await ctx.db.get(userId)] as const,
    ),
  );
  return new Map(users.map(([userId, user]) => [userId, displayName(user)]));
}

async function loadPublicUserIdentitiesById(
  ctx: QueryCtx | MutationCtx,
  userIds: Array<Id<"users">>,
) {
  const distinctUserIds = [...new Set(userIds)];
  const users = await Promise.all(
    distinctUserIds.map(
      async (userId) => [userId, await ctx.db.get(userId)] as const,
    ),
  );
  return new Map(
    users.map(([userId, user]) => [
      userId,
      {
        username: user?.usernameNormalized ?? user?.username ?? user?.name,
        image: user?.image,
        joinedAt: user?._creationTime,
      },
    ]),
  );
}

async function recordForumContentEdit(
  ctx: MutationCtx,
  args: {
    entityType: ForumContentEditDoc["entityType"];
    threadId: Id<"forumThreads">;
    postId?: Id<"forumPosts">;
    actorUserId: Id<"users">;
    targetUserId: Id<"users">;
    previousTitle?: string;
    nextTitle?: string;
    previousPrefixId?: Id<"forumThreadPrefixes">;
    nextPrefixId?: Id<"forumThreadPrefixes">;
    previousPrefixLabel?: string;
    nextPrefixLabel?: string;
    previousBody: string;
    nextBody: string;
    editReason?: string;
    createdAt: number;
  },
) {
  await ctx.db.insert("forumContentEdits", {
    entityType: args.entityType,
    threadId: args.threadId,
    postId: args.postId,
    actorUserId: args.actorUserId,
    targetUserId: args.targetUserId,
    previousTitle: args.previousTitle,
    nextTitle: args.nextTitle,
    previousPrefixId: args.previousPrefixId,
    nextPrefixId: args.nextPrefixId,
    previousPrefixLabel: args.previousPrefixLabel,
    nextPrefixLabel: args.nextPrefixLabel,
    previousBody: args.previousBody,
    nextBody: args.nextBody,
    editReason: args.editReason,
    createdAt: args.createdAt,
  });
}

async function loadThreadsById(
  ctx: QueryCtx | MutationCtx,
  threadIds: Array<Id<"forumThreads">>,
) {
  const distinctThreadIds = [...new Set(threadIds)];
  const threads = await Promise.all(
    distinctThreadIds.map(
      async (threadId) => [threadId, await ctx.db.get(threadId)] as const,
    ),
  );
  return new Map(
    threads.flatMap(([threadId, thread]) =>
      thread === null ? [] : [[threadId, thread] as const],
    ),
  );
}

async function loadCategoriesById(
  ctx: QueryCtx | MutationCtx,
  categoryIds: Array<Id<"forumCategories">>,
) {
  const distinctCategoryIds = [...new Set(categoryIds)];
  const categories = await Promise.all(
    distinctCategoryIds.map(
      async (categoryId) => [categoryId, await ctx.db.get(categoryId)] as const,
    ),
  );
  return new Map(
    categories.flatMap(([categoryId, category]) =>
      category === null ? [] : [[categoryId, category] as const],
    ),
  );
}

async function activeThreadPrefixesForCategory(
  ctx: QueryCtx | MutationCtx,
  categoryId: Id<"forumCategories">,
) {
  const [globalPrefixes, categoryPrefixes] = await Promise.all([
    ctx.db
      .query("forumThreadPrefixes")
      .withIndex("by_categoryId_and_status_and_position", (q) =>
        q.eq("categoryId", undefined).eq("status", "active"),
      )
      .take(THREAD_PREFIX_LIST_LIMIT),
    ctx.db
      .query("forumThreadPrefixes")
      .withIndex("by_categoryId_and_status_and_position", (q) =>
        q.eq("categoryId", categoryId).eq("status", "active"),
      )
      .take(THREAD_PREFIX_LIST_LIMIT),
  ]);

  return [...globalPrefixes, ...categoryPrefixes]
    .sort((left, right) => {
      const positionDelta = left.position - right.position;
      return positionDelta === 0
        ? left.label.localeCompare(right.label)
        : positionDelta;
    })
    .slice(0, THREAD_PREFIX_LIST_LIMIT);
}

async function activeGlobalAnnouncements(ctx: QueryCtx | MutationCtx) {
  return await globalAnnouncements(ctx, "active");
}

async function globalAnnouncements(
  ctx: QueryCtx | MutationCtx,
  status: ForumAnnouncementDoc["status"] | undefined,
) {
  if (status === undefined) {
    return await ctx.db
      .query("forumAnnouncements")
      .withIndex("by_categoryId_and_position", (q) =>
        q.eq("categoryId", undefined),
      )
      .take(FORUM_ANNOUNCEMENT_LIST_LIMIT);
  }
  return await ctx.db
    .query("forumAnnouncements")
    .withIndex("by_categoryId_and_status_and_position", (q) =>
      q.eq("categoryId", undefined).eq("status", status),
    )
    .take(FORUM_ANNOUNCEMENT_LIST_LIMIT);
}

async function activeAnnouncementsForCategory(
  ctx: QueryCtx | MutationCtx,
  categoryId: Id<"forumCategories">,
) {
  return await announcementsForCategory(ctx, categoryId, "active");
}

async function announcementsForCategory(
  ctx: QueryCtx | MutationCtx,
  categoryId: Id<"forumCategories">,
  status: ForumAnnouncementDoc["status"] | undefined,
) {
  const [globalRows, categoryAnnouncements] = await Promise.all([
    globalAnnouncements(ctx, status),
    status === undefined
      ? ctx.db
          .query("forumAnnouncements")
          .withIndex("by_categoryId_and_position", (q) =>
            q.eq("categoryId", categoryId),
          )
          .take(FORUM_ANNOUNCEMENT_LIST_LIMIT)
      : ctx.db
          .query("forumAnnouncements")
          .withIndex("by_categoryId_and_status_and_position", (q) =>
            q.eq("categoryId", categoryId).eq("status", status),
          )
          .take(FORUM_ANNOUNCEMENT_LIST_LIMIT),
  ]);

  return [...globalRows, ...categoryAnnouncements]
    .sort(compareForumPageRecords)
    .slice(0, FORUM_ANNOUNCEMENT_LIST_LIMIT);
}

async function activeBoardRulesForCategory(
  ctx: QueryCtx | MutationCtx,
  categoryId: Id<"forumCategories">,
) {
  const rules = await ctx.db
    .query("forumBoardRules")
    .withIndex("by_categoryId_and_status_and_updatedAt", (q) =>
      q.eq("categoryId", categoryId).eq("status", "active"),
    )
    .order("desc")
    .take(1);
  return rules[0] ?? null;
}

function compareForumPageRecords(
  left: ForumAnnouncementDoc,
  right: ForumAnnouncementDoc,
) {
  const positionDelta = left.position - right.position;
  return positionDelta === 0
    ? left.title.localeCompare(right.title)
    : positionDelta;
}

async function resolveThreadPrefixForCategory(
  ctx: QueryCtx | MutationCtx,
  prefixId: Id<"forumThreadPrefixes"> | null,
  category: ForumCategoryDoc,
) {
  if (prefixId === null) {
    return null;
  }
  const prefix = await ctx.db.get(prefixId);
  if (
    prefix === null ||
    prefix.status !== "active" ||
    (prefix.categoryId !== undefined && prefix.categoryId !== category._id)
  ) {
    throw forumError(
      "THREAD_PREFIX_NOT_AVAILABLE",
      "That thread prefix is not available for this board.",
    );
  }
  return prefix;
}

async function requirePrefixCategory(
  ctx: QueryCtx | MutationCtx,
  categoryId: Id<"forumCategories">,
) {
  const category = await ctx.db.get(categoryId);
  if (category === null) {
    throw forumError("CATEGORY_NOT_FOUND", "That board no longer exists.");
  }
  if (!isBoardCategory(category)) {
    throw forumError(
      "INVALID_THREAD_PREFIX_CATEGORY",
      "Prefixes can only be scoped to boards.",
    );
  }
  return category;
}

async function requireForumPageCategory(
  ctx: QueryCtx | MutationCtx,
  categoryId: Id<"forumCategories">,
) {
  const category = await ctx.db.get(categoryId);
  if (category === null) {
    throw forumError("CATEGORY_NOT_FOUND", "That board no longer exists.");
  }
  if (!isBoardCategory(category)) {
    throw forumError(
      "INVALID_FORUM_PAGE_CATEGORY",
      "Forum page content can only be scoped to boards.",
    );
  }
  return category;
}

async function threadPrefixSnapshotForMove(
  ctx: QueryCtx | MutationCtx,
  thread: ForumThreadDoc,
  targetCategoryId: Id<"forumCategories">,
) {
  if (thread.prefixId === undefined) {
    return threadPrefixSnapshotFromThread(thread);
  }
  const prefix = await ctx.db.get(thread.prefixId);
  if (
    prefix !== null &&
    (prefix.categoryId === undefined || prefix.categoryId === targetCategoryId)
  ) {
    return threadPrefixSnapshotFromThread(thread);
  }
  return threadPrefixSnapshot(null);
}

async function syncThreadsForPrefixUpdate(
  ctx: MutationCtx,
  prefix: ForumThreadPrefixDoc,
) {
  const affectedThreads = await ctx.db
    .query("forumThreads")
    .withIndex("by_prefixId_and_updatedAt", (q) => q.eq("prefixId", prefix._id))
    .take(THREAD_PREFIX_THREAD_SYNC_LIMIT + 1);
  const syncThreads = affectedThreads.slice(0, THREAD_PREFIX_THREAD_SYNC_LIMIT);

  for (const thread of syncThreads) {
    const category = await ctx.db.get(thread.categoryId);
    if (category === null) {
      continue;
    }
    const nextSnapshot =
      prefix.categoryId === undefined || prefix.categoryId === thread.categoryId
        ? threadPrefixSnapshot(prefix)
        : threadPrefixSnapshot(null);
    const author = displayName(await ctx.db.get(thread.authorId));
    await ctx.db.patch(thread._id, {
      ...nextSnapshot,
      searchText: await movedThreadSearchText(
        ctx,
        thread,
        category,
        author,
        nextSnapshot.prefixLabel,
      ),
      updatedAt: Date.now(),
    });
  }

  return {
    updated: syncThreads.length,
    truncated: affectedThreads.length > THREAD_PREFIX_THREAD_SYNC_LIMIT,
  };
}

async function loadPostsById(
  ctx: QueryCtx | MutationCtx,
  postIds: Array<Id<"forumPosts">>,
) {
  const distinctPostIds = [...new Set(postIds)];
  const posts = await Promise.all(
    distinctPostIds.map(
      async (postId) => [postId, await ctx.db.get(postId)] as const,
    ),
  );
  return new Map(
    posts.flatMap(([postId, post]) =>
      post === null ? [] : [[postId, post] as const],
    ),
  );
}

async function insertForumAttachments(
  ctx: MutationCtx,
  args: {
    attachments: Array<{
      pendingUploadId: Id<"forumPendingUploads">;
      storageId: Id<"_storage">;
      filename: string;
      contentType: string;
      size: number;
    }>;
    authorId: Id<"users">;
    categoryId: Id<"forumCategories">;
    postId?: Id<"forumPosts">;
    threadId: Id<"forumThreads">;
    now: number;
  },
) {
  for (const attachment of args.attachments) {
    await ctx.db.insert("forumAttachments", {
      threadId: args.threadId,
      postId: args.postId,
      categoryId: args.categoryId,
      authorId: args.authorId,
      storageId: attachment.storageId,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      status: "active",
      createdAt: args.now,
      updatedAt: args.now,
    });
    await ctx.db.patch(attachment.pendingUploadId, {
      status: "consumed",
      consumedAt: args.now,
      updatedAt: args.now,
    });
  }
}

async function loadActiveForumAttachmentsForPost(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"forumThreads">,
  postId: Id<"forumPosts"> | undefined,
) {
  return await ctx.db
    .query("forumAttachments")
    .withIndex("by_threadId_and_postId_and_status_and_createdAt", (q) =>
      q.eq("threadId", threadId).eq("postId", postId).eq("status", "active"),
    )
    .take(FORUM_ATTACHMENT_MAX_PER_POST);
}

async function hydrateForumAttachments(
  ctx: QueryCtx | MutationCtx,
  attachments: ForumAttachmentDoc[],
) {
  const records = await Promise.all(
    attachments.map(async (attachment) => {
      const url = await ctx.storage.getUrl(attachment.storageId);
      if (url === null) {
        return null;
      }
      return publicForumAttachmentRecord(attachment, url);
    }),
  );
  return records.flatMap((record) => (record === null ? [] : [record]));
}

async function loadReportsById(
  ctx: QueryCtx | MutationCtx,
  reportIds: Array<Id<"forumReports">>,
) {
  const distinctReportIds = [...new Set(reportIds)];
  const reports = await Promise.all(
    distinctReportIds.map(
      async (reportId) => [reportId, await ctx.db.get(reportId)] as const,
    ),
  );
  return new Map(
    reports.flatMap(([reportId, report]) =>
      report === null ? [] : [[reportId, report] as const],
    ),
  );
}

async function loadPrivateMessagesById(
  ctx: QueryCtx | MutationCtx,
  messageIds: Array<Id<"forumPrivateMessages">>,
) {
  const distinctMessageIds = [...new Set(messageIds)];
  const messages = await Promise.all(
    distinctMessageIds.map(
      async (messageId) => [messageId, await ctx.db.get(messageId)] as const,
    ),
  );
  return new Map(
    messages.flatMap(([messageId, message]) =>
      message === null ? [] : [[messageId, message] as const],
    ),
  );
}

async function loadThreadRead(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  threadId: Id<"forumThreads">,
) {
  return await ctx.db
    .query("forumThreadReads")
    .withIndex("by_userId_and_threadId", (q) =>
      q.eq("userId", userId).eq("threadId", threadId),
    )
    .unique();
}

async function loadCategoryRead(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  categoryId: Id<"forumCategories">,
) {
  return await ctx.db
    .query("forumCategoryReads")
    .withIndex("by_userId_and_categoryId", (q) =>
      q.eq("userId", userId).eq("categoryId", categoryId),
    )
    .unique();
}

async function upsertThreadRead(
  ctx: MutationCtx,
  userId: Id<"users">,
  categoryId: Id<"forumCategories">,
  threadId: Id<"forumThreads">,
  args: {
    lastPostAt: number;
    lastReadAt: number;
    lastReadPostNumber?: number;
  },
) {
  const existing = await loadThreadRead(ctx, userId, threadId);
  if (existing === null) {
    return await ctx.db.insert("forumThreadReads", {
      userId,
      threadId,
      categoryId,
      lastReadAt: args.lastReadAt,
      lastReadPostNumber: args.lastReadPostNumber,
      lastPostAt: args.lastPostAt,
      createdAt: args.lastReadAt,
      updatedAt: args.lastReadAt,
    });
  }

  await ctx.db.patch(existing._id, {
    lastReadAt: args.lastReadAt,
    lastReadPostNumber: args.lastReadPostNumber,
    lastPostAt: args.lastPostAt,
    updatedAt: args.lastReadAt,
  });
  return existing._id;
}

async function upsertCategoryRead(
  ctx: MutationCtx,
  userId: Id<"users">,
  categoryId: Id<"forumCategories">,
  args: {
    lastPostAt: number;
    lastReadAt: number;
  },
) {
  const existing = await loadCategoryRead(ctx, userId, categoryId);
  if (existing === null) {
    return await ctx.db.insert("forumCategoryReads", {
      userId,
      categoryId,
      lastReadAt: args.lastReadAt,
      lastPostAt: args.lastPostAt,
      createdAt: args.lastReadAt,
      updatedAt: args.lastReadAt,
    });
  }

  await ctx.db.patch(existing._id, {
    lastReadAt: Math.max(existing.lastReadAt, args.lastReadAt),
    lastPostAt: Math.max(existing.lastPostAt, args.lastPostAt),
    updatedAt: args.lastReadAt,
  });
  return existing._id;
}

async function loadThreadReads(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  threadIds: Array<Id<"forumThreads">>,
) {
  const reads = await Promise.all(
    [...new Set(threadIds)].map(
      async (threadId) =>
        [threadId, await loadThreadRead(ctx, userId, threadId)] as const,
    ),
  );
  return new Map(
    reads.flatMap(([threadId, read]) =>
      read === null ? [] : [[threadId, read] as const],
    ),
  );
}

async function loadCategoryReads(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  categoryIds: Array<Id<"forumCategories">>,
) {
  const reads = await Promise.all(
    [...new Set(categoryIds)].map(
      async (categoryId) =>
        [categoryId, await loadCategoryRead(ctx, userId, categoryId)] as const,
    ),
  );
  return new Map(
    reads.flatMap(([categoryId, read]) =>
      read === null ? [] : [[categoryId, read] as const],
    ),
  );
}

async function loadFirstUnreadPostNumbers(
  ctx: QueryCtx,
  threads: ForumThreadDoc[],
  readsByThreadId: Map<Id<"forumThreads">, ForumThreadReadDoc>,
  categoryReadsById: Map<Id<"forumCategories">, ForumCategoryReadDoc>,
) {
  const entries = await Promise.all(
    threads.map(async (thread) => {
      const read = effectiveThreadRead(
        readsByThreadId.get(thread._id),
        categoryReadsById.get(thread.categoryId),
      );
      const firstUnread =
        read === null
          ? 1
          : await resolveFirstUnreadPostNumber(ctx, thread, read);
      return [thread._id, firstUnread] as const;
    }),
  );
  return new Map(
    entries.flatMap(([threadId, postNumber]) =>
      postNumber === undefined ? [] : [[threadId, postNumber] as const],
    ),
  );
}

async function resolveFirstUnreadPostNumber(
  ctx: QueryCtx | MutationCtx,
  thread: ForumThreadDoc,
  read: ForumReadSnapshot,
) {
  if (readCoversThread(thread, read)) {
    return undefined;
  }
  if (
    (read.lastReadPostNumber ?? 0) < 1 &&
    threadRootReadActivityAt(thread) > read.lastReadAt
  ) {
    return 1;
  }
  if (read.lastReadPostNumber !== undefined) {
    const laterNumberedPosts = await ctx.db
      .query("forumPosts")
      .withIndex("by_threadId_and_status_and_postNumber", (q) =>
        q
          .eq("threadId", thread._id)
          .eq("status", "active")
          .gt("postNumber", read.lastReadPostNumber),
      )
      .order("asc")
      .take(POST_PAGE_SCAN_LIMIT);
    const firstUnreadNumberedPost = laterNumberedPosts.find(
      (post) => postReadActivityAt(post) >= read.lastReadAt,
    );
    if (firstUnreadNumberedPost !== undefined) {
      return await postNumberForPost(ctx, firstUnreadNumberedPost);
    }
  }
  const unreadReplies = await ctx.db
    .query("forumPosts")
    .withIndex("by_threadId_and_status_and_createdAt", (q) =>
      q
        .eq("threadId", thread._id)
        .eq("status", "active")
        .gt("createdAt", read.lastReadAt),
    )
    .order("asc")
    .first();
  if (unreadReplies === null) {
    const movedReplies = await ctx.db
      .query("forumPosts")
      .withIndex("by_threadId_and_status_and_moderationMovedAt", (q) =>
        q
          .eq("threadId", thread._id)
          .eq("status", "active")
          .gt("moderationMovedAt", read.lastReadAt),
      )
      .order("asc")
      .take(POST_MOVE_LIMIT);
    const firstMovedReply = sortedForumPostsForAppend(movedReplies)[0];
    if (firstMovedReply !== undefined) {
      return await postNumberForPost(ctx, firstMovedReply);
    }
    if (
      read.lastReadPostNumber !== undefined &&
      (thread.moderationActivityAt ?? 0) >= read.lastReadAt &&
      read.lastReadPostNumber < threadPostNumberCeiling(thread)
    ) {
      return read.lastReadPostNumber + 1;
    }
    return (thread.moderationActivityAt ?? 0) > read.lastReadAt ? 1 : undefined;
  }
  return await postNumberForPost(ctx, unreadReplies);
}

async function postNumberForPost(
  ctx: QueryCtx | MutationCtx,
  post: ForumPostDoc,
) {
  if (typeof post.postNumber === "number" && post.postNumber >= 2) {
    return post.postNumber;
  }
  const earlierPosts = await ctx.db
    .query("forumPosts")
    .withIndex("by_threadId_and_status_and_createdAt", (q) =>
      q.eq("threadId", post.threadId).eq("status", "active"),
    )
    .order("asc")
    .take(POST_PAGE_SCAN_LIMIT);
  const replyIndex = earlierPosts.findIndex(
    (candidate) => candidate._id === post._id,
  );
  return replyIndex < 0 ? undefined : replyIndex + 2;
}

async function timestampForPostNumber(
  ctx: QueryCtx | MutationCtx,
  thread: ForumThreadDoc,
  postNumber: number,
) {
  if (postNumber <= 1) {
    return threadRootReadActivityAt(thread);
  }

  const numberedPost = await ctx.db
    .query("forumPosts")
    .withIndex("by_threadId_and_status_and_postNumber", (q) =>
      q
        .eq("threadId", thread._id)
        .eq("status", "active")
        .lte("postNumber", postNumber),
    )
    .order("desc")
    .first();
  if (numberedPost !== null) {
    return postReadActivityAt(numberedPost);
  }

  return thread.createdAt;
}

async function loadThreadLastPostTargets(
  ctx: QueryCtx | MutationCtx,
  threads: ForumThreadDoc[],
) {
  const postsById = await loadPostsById(
    ctx,
    threads.flatMap((thread) =>
      thread.lastPostId === undefined ? [] : [thread.lastPostId],
    ),
  );
  const targets = await Promise.all(
    threads.map(async (thread) => {
      const target = await threadLastPostTarget(
        ctx,
        thread,
        thread.lastPostId === undefined
          ? undefined
          : postsById.get(thread.lastPostId),
      );
      return [thread._id, target] as const;
    }),
  );

  return new Map(targets);
}

async function threadLastPostTarget(
  ctx: QueryCtx | MutationCtx,
  thread: ForumThreadDoc,
  lastPost?: ForumPostDoc,
): Promise<ForumLastPostTarget> {
  if (thread.lastPostId === undefined) {
    return {
      lastPostNumber: 1,
      lastPostPage: pageForPostNumber(1, POST_PAGE_SIZE),
    };
  }
  if (lastPost === undefined || lastPost.threadId !== thread._id) {
    return {};
  }

  const lastPostNumber = await postNumberForPost(ctx, lastPost);
  if (lastPostNumber === undefined) {
    return {};
  }
  return {
    lastPostNumber,
    lastPostPage: pageForPostNumber(lastPostNumber, POST_PAGE_SIZE),
  };
}

async function nextPostNumberForThread(
  ctx: MutationCtx,
  thread: ForumThreadDoc,
) {
  if (
    typeof thread.lastAssignedPostNumber === "number" &&
    thread.lastAssignedPostNumber >= 1
  ) {
    return thread.lastAssignedPostNumber + 1;
  }

  const latestNumberedPost = await ctx.db
    .query("forumPosts")
    .withIndex("by_threadId_and_postNumber", (q) =>
      q.eq("threadId", thread._id),
    )
    .order("desc")
    .first();
  const latestPostNumber =
    latestNumberedPost !== null &&
    typeof latestNumberedPost.postNumber === "number"
      ? latestNumberedPost.postNumber
      : 1;

  return Math.max(1, latestPostNumber, thread.replyCount + 1) + 1;
}

async function existingForumNotificationEmailDelivery(
  ctx: MutationCtx,
  args: {
    recipientUserId: Id<"users">;
    threadId: Id<"forumThreads">;
    postId?: Id<"forumPosts">;
    type: ForumNotificationDoc["type"];
  },
) {
  if (args.type === "reply" && args.postId !== undefined) {
    const deliveries = await ctx.db
      .query("forumNotificationEmailDeliveries")
      .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
        q
          .eq("postId", args.postId)
          .eq("recipientUserId", args.recipientUserId)
          .eq("type", args.type),
      )
      .take(1);
    return deliveries[0] ?? null;
  }

  const deliveries = await ctx.db
    .query("forumNotificationEmailDeliveries")
    .withIndex("by_threadId_and_recipientUserId_and_type", (q) =>
      q
        .eq("threadId", args.threadId)
        .eq("recipientUserId", args.recipientUserId)
        .eq("type", args.type),
    )
    .take(1);
  return deliveries[0] ?? null;
}

async function maybeQueueForumNotificationEmailDelivery(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    categoryId: Id<"forumCategories">;
    notificationId?: Id<"forumNotifications">;
    postId?: Id<"forumPosts">;
    recipient: UserDoc;
    threadId: Id<"forumThreads">;
    type: ForumNotificationDoc["type"];
    now: number;
  },
) {
  const toEmail = forumEmailDestination(args.recipient);
  if (toEmail === null) {
    return null;
  }

  const existing = await existingForumNotificationEmailDelivery(ctx, {
    recipientUserId: args.recipient._id,
    threadId: args.threadId,
    postId: args.postId,
    type: args.type,
  });
  if (existing !== null) {
    return existing._id;
  }

  const deliveryId = await ctx.db.insert("forumNotificationEmailDeliveries", {
    notificationId: args.notificationId,
    recipientUserId: args.recipient._id,
    actorUserId: args.actorUserId,
    threadId: args.threadId,
    categoryId: args.categoryId,
    postId: args.postId,
    type: args.type,
    status: "queued",
    toEmail,
    createdAt: args.now,
    updatedAt: args.now,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.forumNotificationEmails.processQueuedDelivery,
    { deliveryId },
  );
  return deliveryId;
}

async function createReplyNotifications(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    categoryId: Id<"forumCategories">;
    postId: Id<"forumPosts">;
    threadId: Id<"forumThreads">;
    now: number;
    cursor?: string;
  },
) {
  const category = await ctx.db.get(args.categoryId);
  if (category === null) {
    return;
  }
  const subscriptionPage = await ctx.db
    .query("forumThreadSubscriptions")
    .withIndex("by_threadId_and_status", (q) =>
      q.eq("threadId", args.threadId).eq("status", "active"),
    )
    .paginate({
      numItems: REPLY_NOTIFICATION_FANOUT_BATCH_LIMIT,
      cursor: args.cursor ?? null,
    });

  for (const subscription of subscriptionPage.page) {
    if (subscription.userId === args.actorUserId) {
      continue;
    }
    const recipient = await ctx.db.get(subscription.userId);
    if (!(await canViewCategoryWithAncestors(ctx, recipient, category))) {
      continue;
    }
    if (recipient === null) {
      continue;
    }
    const preferences = forumNotificationPreferenceSettings(
      await loadForumNotificationPreferences(ctx, subscription.userId),
    );
    const existingNotification = await ctx.db
      .query("forumNotifications")
      .withIndex("by_postId_and_recipientUserId", (q) =>
        q.eq("postId", args.postId).eq("recipientUserId", subscription.userId),
      )
      .take(1);
    let notificationId = existingNotification[0]?._id;
    if (preferences.inAppReplies && notificationId === undefined) {
      notificationId = await ctx.db.insert("forumNotifications", {
        recipientUserId: subscription.userId,
        actorUserId: args.actorUserId,
        threadId: args.threadId,
        categoryId: args.categoryId,
        postId: args.postId,
        type: "reply",
        status: "unread",
        createdAt: args.now,
        updatedAt: args.now,
      });
    }
    if (preferences.emailReplies) {
      await maybeQueueForumNotificationEmailDelivery(ctx, {
        actorUserId: args.actorUserId,
        categoryId: args.categoryId,
        notificationId,
        postId: args.postId,
        recipient,
        threadId: args.threadId,
        type: "reply",
        now: args.now,
      });
    }
  }

  if (!subscriptionPage.isDone) {
    await ctx.scheduler.runAfter(0, internal.forum.continueReplyNotifications, {
      actorUserId: args.actorUserId,
      categoryId: args.categoryId,
      postId: args.postId,
      threadId: args.threadId,
      now: args.now,
      cursor: subscriptionPage.continueCursor,
    });
  }
}

async function createNewThreadNotifications(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    categoryId: Id<"forumCategories">;
    threadId: Id<"forumThreads">;
    now: number;
    cursor?: string;
  },
) {
  const [category, thread] = await Promise.all([
    ctx.db.get(args.categoryId),
    ctx.db.get(args.threadId),
  ]);
  if (
    category === null ||
    thread === null ||
    !isVisibleThreadStatus(thread.status)
  ) {
    return;
  }

  const subscriptionPage = await ctx.db
    .query("forumCategorySubscriptions")
    .withIndex("by_categoryId_and_status", (q) =>
      q.eq("categoryId", args.categoryId).eq("status", "active"),
    )
    .paginate({
      numItems: NEW_THREAD_NOTIFICATION_FANOUT_BATCH_LIMIT,
      cursor: args.cursor ?? null,
    });

  for (const subscription of subscriptionPage.page) {
    if (subscription.userId === args.actorUserId) {
      continue;
    }
    const recipient = await ctx.db.get(subscription.userId);
    if (!(await canViewCategoryWithAncestors(ctx, recipient, category))) {
      continue;
    }
    if (recipient === null) {
      continue;
    }
    const preferences = forumNotificationPreferenceSettings(
      await loadForumNotificationPreferences(ctx, subscription.userId),
    );
    const existingNotification = await ctx.db
      .query("forumNotifications")
      .withIndex("by_threadId_and_recipientUserId_and_type", (q) =>
        q
          .eq("threadId", args.threadId)
          .eq("recipientUserId", subscription.userId)
          .eq("type", "newThread"),
      )
      .take(1);
    let notificationId = existingNotification[0]?._id;
    if (preferences.inAppNewThreads && notificationId === undefined) {
      notificationId = await ctx.db.insert("forumNotifications", {
        recipientUserId: subscription.userId,
        actorUserId: args.actorUserId,
        threadId: args.threadId,
        categoryId: args.categoryId,
        type: "newThread",
        status: "unread",
        createdAt: args.now,
        updatedAt: args.now,
      });
    }
    if (preferences.emailNewThreads) {
      await maybeQueueForumNotificationEmailDelivery(ctx, {
        actorUserId: args.actorUserId,
        categoryId: args.categoryId,
        notificationId,
        recipient,
        threadId: args.threadId,
        type: "newThread",
        now: args.now,
      });
    }
  }

  if (!subscriptionPage.isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.forum.continueNewThreadNotifications,
      {
        actorUserId: args.actorUserId,
        categoryId: args.categoryId,
        threadId: args.threadId,
        now: args.now,
        cursor: subscriptionPage.continueCursor,
      },
    );
  }
}

async function loadVisibleForumNotifications(
  ctx: QueryCtx | MutationCtx,
  args: {
    user: UserDoc;
    status?: ForumNotificationDoc["status"];
    scanLimit: number;
    visibleLimit: number;
  },
) {
  const status = args.status;
  const query =
    status === undefined
      ? ctx.db
          .query("forumNotifications")
          .withIndex("by_recipientUserId_and_createdAt", (q) =>
            q.eq("recipientUserId", args.user._id),
          )
          .order("desc")
      : ctx.db
          .query("forumNotifications")
          .withIndex("by_recipientUserId_and_status_and_createdAt", (q) =>
            q.eq("recipientUserId", args.user._id).eq("status", status),
          )
          .order("desc");
  const threadsById = new Map<Id<"forumThreads">, ForumThreadDoc | null>();
  const categoriesById = new Map<
    Id<"forumCategories">,
    ForumCategoryDoc | null
  >();
  const categoryVisibility = new Map<Id<"forumCategories">, boolean>();
  const visible: Array<{
    category: ForumCategoryDoc;
    notification: ForumNotificationDoc;
    thread: ForumThreadDoc;
  }> = [];
  let scanned = 0;
  let limited = false;

  for await (const notification of query) {
    scanned += 1;
    if (scanned > args.scanLimit) {
      limited = true;
      break;
    }
    let thread = threadsById.get(notification.threadId);
    if (thread === undefined) {
      thread = await ctx.db.get(notification.threadId);
      threadsById.set(notification.threadId, thread);
    }
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      continue;
    }

    let category = categoriesById.get(thread.categoryId);
    if (category === undefined) {
      category = await ctx.db.get(thread.categoryId);
      categoriesById.set(thread.categoryId, category);
    }
    if (category === null) {
      continue;
    }

    let canView = categoryVisibility.get(category._id);
    if (canView === undefined) {
      canView =
        isBoardCategory(category) &&
        (await canViewCategoryWithAncestors(ctx, args.user, category));
      categoryVisibility.set(category._id, canView);
    }
    if (!canView) {
      continue;
    }

    visible.push({ category, notification, thread });
    if (visible.length >= args.visibleLimit) {
      break;
    }
  }

  return { limited, visible };
}

async function visibleUnreadForumNotificationSummary(
  ctx: QueryCtx,
  user: UserDoc,
) {
  const unread = await loadVisibleForumNotifications(ctx, {
    user,
    status: "unread",
    scanLimit: NOTIFICATION_VISIBILITY_SCAN_LIMIT,
    visibleLimit: NOTIFICATION_UNREAD_SCAN_LIMIT + 1,
  });

  return {
    unreadCount: Math.min(
      unread.visible.length,
      NOTIFICATION_UNREAD_SCAN_LIMIT,
    ),
    unreadCountLimited:
      unread.visible.length > NOTIFICATION_UNREAD_SCAN_LIMIT || unread.limited,
  };
}

async function unreadPrivateMessageSummary(ctx: QueryCtx, userId: Id<"users">) {
  const unreadRows = await ctx.db
    .query("forumPrivateMessages")
    .withIndex("by_recipientUserId_and_recipientDeletedAt_and_readAt", (q) =>
      q
        .eq("recipientUserId", userId)
        .eq("recipientDeletedAt", undefined)
        .eq("readAt", undefined),
    )
    .take(PRIVATE_MESSAGE_UNREAD_SCAN_LIMIT + 1);

  return {
    unreadCount: Math.min(unreadRows.length, PRIVATE_MESSAGE_UNREAD_SCAN_LIMIT),
    unreadCountLimited: unreadRows.length > PRIVATE_MESSAGE_UNREAD_SCAN_LIMIT,
  };
}

async function privateMessageQuotaSummary(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  const [recipientRows, senderRows] = await Promise.all([
    ctx.db
      .query("forumPrivateMessages")
      .withIndex("by_recipient_and_purged_and_deleted_and_created", (q) =>
        q.eq("recipientUserId", userId).eq("recipientPurgedAt", undefined),
      )
      .take(PRIVATE_MESSAGE_QUOTA_LIMIT + 1),
    ctx.db
      .query("forumPrivateMessages")
      .withIndex("by_sender_and_purged_and_deleted_and_created", (q) =>
        q.eq("senderUserId", userId).eq("senderPurgedAt", undefined),
      )
      .take(PRIVATE_MESSAGE_QUOTA_LIMIT + 1),
  ]);
  const used = Math.min(
    recipientRows.length + senderRows.length,
    PRIVATE_MESSAGE_QUOTA_LIMIT,
  );
  return {
    used,
    limit: PRIVATE_MESSAGE_QUOTA_LIMIT,
    percent: Math.min(
      100,
      Math.round((used / PRIVATE_MESSAGE_QUOTA_LIMIT) * 100),
    ),
    limited:
      recipientRows.length > PRIVATE_MESSAGE_QUOTA_LIMIT ||
      senderRows.length > PRIVATE_MESSAGE_QUOTA_LIMIT ||
      recipientRows.length + senderRows.length > PRIVATE_MESSAGE_QUOTA_LIMIT,
  };
}

async function loadPrivateMailboxRows(
  ctx: QueryCtx,
  userId: Id<"users">,
  box: ForumPrivateMessageBox,
  limit: number,
) {
  if (box === "sent") {
    const rows = await ctx.db
      .query("forumPrivateMessages")
      .withIndex("by_senderUserId_and_senderDeletedAt_and_createdAt", (q) =>
        q.eq("senderUserId", userId).eq("senderDeletedAt", undefined),
      )
      .order("desc")
      .take(limit);
    return { limited: rows.length >= limit, rows };
  }

  if (box === "trash") {
    const [recipientRows, senderRows] = await Promise.all([
      ctx.db
        .query("forumPrivateMessages")
        .withIndex("by_recipient_and_purged_and_deleted_and_created", (q) =>
          q
            .eq("recipientUserId", userId)
            .eq("recipientPurgedAt", undefined)
            .gt("recipientDeletedAt", 0),
        )
        .order("desc")
        .take(limit),
      ctx.db
        .query("forumPrivateMessages")
        .withIndex("by_sender_and_purged_and_deleted_and_created", (q) =>
          q
            .eq("senderUserId", userId)
            .eq("senderPurgedAt", undefined)
            .gt("senderDeletedAt", 0),
        )
        .order("desc")
        .take(limit),
    ]);
    const rows = [...recipientRows, ...senderRows]
      .filter((message) =>
        message.recipientUserId === userId
          ? message.recipientDeletedAt !== undefined
          : message.senderDeletedAt !== undefined,
      )
      .sort((left, right) => {
        const leftTrashedAt =
          left.recipientUserId === userId
            ? (left.recipientDeletedAt ?? 0)
            : (left.senderDeletedAt ?? 0);
        const rightTrashedAt =
          right.recipientUserId === userId
            ? (right.recipientDeletedAt ?? 0)
            : (right.senderDeletedAt ?? 0);
        return (
          rightTrashedAt - leftTrashedAt || right.createdAt - left.createdAt
        );
      })
      .slice(0, limit);
    return {
      limited:
        recipientRows.length >= limit ||
        senderRows.length >= limit ||
        recipientRows.length + senderRows.length > limit,
      rows,
    };
  }

  const rows = await ctx.db
    .query("forumPrivateMessages")
    .withIndex("by_recipientUserId_and_recipientDeletedAt_and_createdAt", (q) =>
      q.eq("recipientUserId", userId).eq("recipientDeletedAt", undefined),
    )
    .order("desc")
    .take(limit);
  return { limited: rows.length >= limit, rows };
}

async function ensureThreadParticipantSubscription(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    threadId: Id<"forumThreads">;
    categoryId: Id<"forumCategories">;
    now: number;
  },
) {
  const existing = await loadThreadSubscription(
    ctx,
    args.userId,
    args.threadId,
  );
  if (existing === null) {
    await ctx.db.insert("forumThreadSubscriptions", {
      userId: args.userId,
      threadId: args.threadId,
      categoryId: args.categoryId,
      status: "active",
      createdAt: args.now,
      updatedAt: args.now,
    });
    return;
  }

  if (existing.status !== "active") {
    return;
  }

  if (existing.categoryId !== args.categoryId) {
    await ctx.db.patch(existing._id, {
      categoryId: args.categoryId,
      updatedAt: args.now,
    });
  }
}

async function loadThreadSubscription(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  threadId: Id<"forumThreads">,
) {
  return await ctx.db
    .query("forumThreadSubscriptions")
    .withIndex("by_userId_and_threadId", (q) =>
      q.eq("userId", userId).eq("threadId", threadId),
    )
    .unique();
}

async function loadThreadRating(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  threadId: Id<"forumThreads">,
): Promise<ForumThreadRatingDoc | null> {
  return await ctx.db
    .query("forumThreadRatings")
    .withIndex("by_userId_and_threadId", (q) =>
      q.eq("userId", userId).eq("threadId", threadId),
    )
    .unique();
}

async function loadCategorySubscription(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  categoryId: Id<"forumCategories">,
): Promise<ForumCategorySubscriptionDoc | null> {
  return await ctx.db
    .query("forumCategorySubscriptions")
    .withIndex("by_userId_and_categoryId", (q) =>
      q.eq("userId", userId).eq("categoryId", categoryId),
    )
    .unique();
}

async function loadForumUserRelationship(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  targetUserId: Id<"users">,
  kind: ForumUserRelationshipDoc["kind"],
) {
  return await ctx.db
    .query("forumUserRelationships")
    .withIndex("by_userId_and_targetUserId_and_kind", (q) =>
      q.eq("userId", userId).eq("targetUserId", targetUserId).eq("kind", kind),
    )
    .unique();
}

async function loadForumUserProfile(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("forumUserProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

async function loadForumNotificationPreferences(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("forumNotificationPreferences")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

function forumNotificationPreferenceSettings(
  preferences: ForumNotificationPreferencesDoc | null | undefined,
) {
  return {
    inAppReplies:
      preferences?.inAppReplies ??
      DEFAULT_FORUM_NOTIFICATION_PREFERENCES.inAppReplies,
    inAppNewThreads:
      preferences?.inAppNewThreads ??
      DEFAULT_FORUM_NOTIFICATION_PREFERENCES.inAppNewThreads,
    emailReplies:
      preferences?.emailReplies ??
      DEFAULT_FORUM_NOTIFICATION_PREFERENCES.emailReplies,
    emailNewThreads:
      preferences?.emailNewThreads ??
      DEFAULT_FORUM_NOTIFICATION_PREFERENCES.emailNewThreads,
  };
}

async function loadForumUserProfilesByUserIds(
  ctx: QueryCtx | MutationCtx,
  userIds: Array<Id<"users">>,
) {
  const profiles = await Promise.all(
    [...new Set(userIds)].map(
      async (userId) =>
        [userId, await loadForumUserProfile(ctx, userId)] as const,
    ),
  );
  return new Map(
    profiles.flatMap(([userId, profile]) =>
      profile === null ? [] : [[userId, profile] as const],
    ),
  );
}

function buildThreadReputationTargetKey(threadId: Id<"forumThreads">) {
  return `thread:${threadId}`;
}

function buildPostReputationTargetKey(postId: Id<"forumPosts">) {
  return `post:${postId}`;
}

async function loadForumReputation(
  ctx: QueryCtx | MutationCtx,
  fromUserId: Id<"users">,
  targetKey: string,
) {
  return await ctx.db
    .query("forumReputations")
    .withIndex("by_fromUserId_and_targetKey", (q) =>
      q.eq("fromUserId", fromUserId).eq("targetKey", targetKey),
    )
    .unique();
}

async function loadForumReputationsByTargetKey(
  ctx: QueryCtx | MutationCtx,
  fromUserId: Id<"users">,
  targetKeys: string[],
) {
  const rows = await Promise.all(
    [...new Set(targetKeys)].map(
      async (targetKey) =>
        [
          targetKey,
          await loadForumReputation(ctx, fromUserId, targetKey),
        ] as const,
    ),
  );
  return new Map(
    rows.flatMap(([targetKey, reputation]) =>
      reputation === null ? [] : [[targetKey, reputation] as const],
    ),
  );
}

function profileReputationScore(
  profile: ForumUserProfileDoc | null | undefined,
) {
  return profile?.reputationScore ?? 0;
}

async function forumUserReputationScore(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  const profile = await loadForumUserProfile(ctx, userId);
  return profileReputationScore(profile);
}

async function bumpForumUserProfileReputation(
  ctx: MutationCtx,
  userId: Id<"users">,
  reputationDelta: number,
  now: number,
) {
  const profile = await loadForumUserProfile(ctx, userId);
  if (profile === null) {
    const reputationScore = reputationDelta;
    await ctx.db.insert("forumUserProfiles", {
      userId,
      showSignatures: true,
      threadCount: 0,
      postCount: 0,
      reputationScore,
      createdAt: now,
      updatedAt: now,
    });
    return reputationScore;
  }

  const reputationScore = profileReputationScore(profile) + reputationDelta;
  await ctx.db.patch(profile._id, {
    reputationScore,
    updatedAt: now,
  });
  return reputationScore;
}

async function bumpForumUserProfileStats(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: {
    threadDelta?: number;
    postDelta?: number;
    now: number;
  },
) {
  const profile = await loadForumUserProfile(ctx, userId);
  const threadDelta = args.threadDelta ?? 0;
  const postDelta = args.postDelta ?? 0;
  if (profile === null) {
    await ctx.db.insert("forumUserProfiles", {
      userId,
      showSignatures: true,
      threadCount: Math.max(0, threadDelta),
      postCount: Math.max(0, postDelta),
      createdAt: args.now,
      updatedAt: args.now,
    });
    return;
  }

  await ctx.db.patch(profile._id, {
    threadCount: Math.max(0, profile.threadCount + threadDelta),
    postCount: Math.max(0, profile.postCount + postDelta),
    updatedAt: args.now,
  });
}

async function applyThreadVisibilityProfileDeltas(
  ctx: MutationCtx,
  thread: ForumThreadDoc,
  args: {
    isVisible: boolean;
    now: number;
    token: string;
  },
) {
  const direction = args.isVisible ? 1 : -1;
  await bumpForumUserProfileStats(ctx, thread.authorId, {
    threadDelta: direction,
    postDelta: direction,
    now: args.now,
  });

  await applyThreadVisibilityReplyProfileDeltaBatch(ctx, {
    threadId: thread._id,
    isVisible: args.isVisible,
    now: args.now,
    token: args.token,
  });
}

async function applyThreadVisibilityReplyProfileDeltaBatch(
  ctx: MutationCtx,
  args: {
    threadId: Id<"forumThreads">;
    isVisible: boolean;
    now: number;
    token: string;
    cursor?: string;
  },
) {
  const thread = await ctx.db.get(args.threadId);
  if (thread === null || thread.visibilityProfileDeltaToken !== args.token) {
    return;
  }
  const activeReplies = await ctx.db
    .query("forumPosts")
    .withIndex("by_threadId_and_status_and_createdAt", (q) =>
      q.eq("threadId", args.threadId).eq("status", "active"),
    )
    .paginate({
      numItems: THREAD_VISIBILITY_PROFILE_DELTA_BATCH_LIMIT,
      cursor: args.cursor ?? null,
    });
  const direction = args.isVisible ? 1 : -1;
  const deltasByUserId = new Map<
    Id<"users">,
    { threadDelta: number; postDelta: number }
  >();
  for (const post of activeReplies.page) {
    addForumProfileDelta(deltasByUserId, post.authorId, {
      threadDelta: 0,
      postDelta: direction,
    });
  }

  for (const [userId, delta] of deltasByUserId) {
    await bumpForumUserProfileStats(ctx, userId, {
      ...delta,
      now: args.now,
    });
  }

  if (!activeReplies.isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.forum.continueThreadVisibilityProfileDeltas,
      {
        threadId: args.threadId,
        isVisible: args.isVisible,
        now: args.now,
        token: args.token,
        cursor: activeReplies.continueCursor,
      },
    );
  }
}

function addForumProfileDelta(
  deltasByUserId: Map<Id<"users">, { threadDelta: number; postDelta: number }>,
  userId: Id<"users">,
  delta: { threadDelta: number; postDelta: number },
) {
  const current = deltasByUserId.get(userId) ?? {
    threadDelta: 0,
    postDelta: 0,
  };
  deltasByUserId.set(userId, {
    threadDelta: current.threadDelta + delta.threadDelta,
    postDelta: current.postDelta + delta.postDelta,
  });
}

async function loadPublicPollForThread(
  ctx: QueryCtx | MutationCtx,
  thread: ForumThreadDoc,
  viewer: UserDoc | null | undefined,
  category: ForumCategoryDoc,
  viewerCanVoteInCategory?: boolean,
  viewerCanModerateCategory = canModerate(viewer),
) {
  const polls = await ctx.db
    .query("forumPolls")
    .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
    .take(1);
  const poll = polls[0];
  if (poll === undefined) {
    return null;
  }
  return await publicPollRecord(
    ctx,
    poll,
    thread,
    viewer?._id,
    viewerCanVoteInCategory,
    poll.status === "open" &&
      poll.totalVotes === 0 &&
      canEditThread(viewer, thread, category, viewerCanModerateCategory),
  );
}

async function loadPollVote(
  ctx: QueryCtx | MutationCtx,
  pollId: Id<"forumPolls">,
  userId: Id<"users">,
) {
  const votes = await ctx.db
    .query("forumPollVotes")
    .withIndex("by_pollId_and_userId", (q) =>
      q.eq("pollId", pollId).eq("userId", userId),
    )
    .take(1);
  return votes[0] ?? null;
}

async function hydrateAdminReports(
  ctx: QueryCtx | MutationCtx,
  reports: ForumReportDoc[],
  options: { canViewPrivateMessageBodies: boolean },
) {
  const threadsById = await loadThreadsById(
    ctx,
    reports.flatMap((report) =>
      report.threadId === undefined ? [] : [report.threadId],
    ),
  );
  const postsById = await loadPostsById(
    ctx,
    reports.flatMap((report) =>
      report.postId === undefined ? [] : [report.postId],
    ),
  );
  const messagesById = await loadPrivateMessagesById(
    ctx,
    reports.flatMap((report) =>
      report.messageId === undefined ? [] : [report.messageId],
    ),
  );
  const categoriesById = await loadCategoriesById(
    ctx,
    reports.flatMap((report) =>
      report.categoryId === undefined ? [] : [report.categoryId],
    ),
  );
  const usersById = await loadUserNamesById(ctx, [
    ...reports.map((report) => report.reporterId),
    ...reports.flatMap((report) =>
      report.reviewedBy === undefined ? [] : [report.reviewedBy],
    ),
  ]);
  const targetUserIds = reports.flatMap((report) => {
    const thread =
      report.threadId === undefined
        ? undefined
        : threadsById.get(report.threadId);
    const post =
      report.postId === undefined ? undefined : postsById.get(report.postId);
    const message =
      report.messageId === undefined
        ? undefined
        : messagesById.get(report.messageId);
    const targetUserId = reportTargetUserId(report, thread, post, message);
    return targetUserId === undefined ? [] : [targetUserId];
  });
  const targetUsersById = await loadUserNamesById(ctx, targetUserIds);
  const warningSummariesByUserId = await activeWarningSummariesForUsers(
    ctx,
    targetUserIds,
    Date.now(),
  );

  return reports.map((report) =>
    adminReportRecord(
      report,
      report.threadId === undefined
        ? undefined
        : threadsById.get(report.threadId),
      report.postId === undefined ? undefined : postsById.get(report.postId),
      report.messageId === undefined
        ? undefined
        : messagesById.get(report.messageId),
      report.categoryId === undefined
        ? undefined
        : categoriesById.get(report.categoryId),
      usersById.get(report.reporterId),
      report.reviewedBy === undefined
        ? undefined
        : usersById.get(report.reviewedBy),
      targetUsersById,
      warningSummariesByUserId,
      options,
    ),
  );
}

async function hydrateForumWarnings(
  ctx: QueryCtx | MutationCtx,
  warnings: ForumWarningDoc[],
) {
  const [usersById, categoriesById, threadsById, postsById, reportsById] =
    await Promise.all([
      loadUserNamesById(ctx, [
        ...warnings.map((warning) => warning.targetUserId),
        ...warnings.map((warning) => warning.actorUserId),
        ...warnings.flatMap((warning) =>
          warning.revokedBy === undefined ? [] : [warning.revokedBy],
        ),
      ]),
      loadCategoriesById(
        ctx,
        warnings.flatMap((warning) =>
          warning.categoryId === undefined ? [] : [warning.categoryId],
        ),
      ),
      loadThreadsById(
        ctx,
        warnings.flatMap((warning) =>
          warning.threadId === undefined ? [] : [warning.threadId],
        ),
      ),
      loadPostsById(
        ctx,
        warnings.flatMap((warning) =>
          warning.postId === undefined ? [] : [warning.postId],
        ),
      ),
      loadReportsById(
        ctx,
        warnings.flatMap((warning) =>
          warning.reportId === undefined ? [] : [warning.reportId],
        ),
      ),
    ]);

  return warnings.map((warning) =>
    adminWarningRecord(
      warning,
      usersById.get(warning.targetUserId),
      usersById.get(warning.actorUserId),
      warning.revokedBy === undefined
        ? undefined
        : usersById.get(warning.revokedBy),
      warning.categoryId === undefined
        ? undefined
        : categoriesById.get(warning.categoryId),
      warning.threadId === undefined
        ? undefined
        : threadsById.get(warning.threadId),
      warning.postId === undefined ? undefined : postsById.get(warning.postId),
      warning.reportId === undefined
        ? undefined
        : reportsById.get(warning.reportId),
    ),
  );
}

async function loadVisibleMyForumReputationHistory(
  ctx: QueryCtx | MutationCtx,
  reputations: AsyncIterable<ForumReputationDoc>,
  viewer: UserDoc,
  visibleLimit: number,
) {
  const visible: Array<
    Awaited<ReturnType<typeof hydrateMyForumReputationHistory>>[number]
  > = [];
  let scanned = 0;
  let batch: ForumReputationDoc[] = [];

  async function flushBatch() {
    if (batch.length === 0 || visible.length >= visibleLimit) {
      return;
    }
    visible.push(
      ...(await hydrateMyForumReputationHistory(ctx, batch, viewer)),
    );
    batch = [];
  }

  for await (const reputation of reputations) {
    scanned += 1;
    batch.push(reputation);
    if (batch.length >= MY_FORUM_REPUTATION_HISTORY_BATCH_SIZE) {
      await flushBatch();
      if (
        visible.length >= visibleLimit ||
        scanned >= MY_FORUM_REPUTATION_HISTORY_SCAN_LIMIT
      ) {
        break;
      }
    }
    if (scanned >= MY_FORUM_REPUTATION_HISTORY_SCAN_LIMIT) {
      break;
    }
  }

  await flushBatch();
  return visible.slice(0, visibleLimit);
}

async function hydrateMyForumReputationHistory(
  ctx: QueryCtx | MutationCtx,
  reputations: ForumReputationDoc[],
  viewer: UserDoc,
) {
  const [membersById, threadsById, postsById] = await Promise.all([
    loadUserNamesById(ctx, [
      ...reputations.map((reputation) => reputation.fromUserId),
      ...reputations.map((reputation) => reputation.toUserId),
    ]),
    loadThreadsById(
      ctx,
      reputations.map((reputation) => reputation.threadId),
    ),
    loadPostsById(
      ctx,
      reputations.flatMap((reputation) =>
        reputation.postId === undefined ? [] : [reputation.postId],
      ),
    ),
  ]);
  const categoriesById = await loadCategoriesById(
    ctx,
    Array.from(threadsById.values()).map((thread) => thread.categoryId),
  );

  const visibleCategoryIds = new Set<Id<"forumCategories">>();
  await Promise.all(
    Array.from(categoriesById.values()).map(async (category) => {
      if (await canViewCategoryWithAncestors(ctx, viewer, category)) {
        visibleCategoryIds.add(category._id);
      }
    }),
  );

  return reputations.flatMap((reputation) => {
    const thread = threadsById.get(reputation.threadId);
    if (
      thread === undefined ||
      !isVisibleThreadStatus(thread.status) ||
      !visibleCategoryIds.has(thread.categoryId)
    ) {
      return [];
    }

    const category = categoriesById.get(thread.categoryId);
    if (category === undefined) {
      return [];
    }

    const post =
      reputation.postId === undefined
        ? undefined
        : postsById.get(reputation.postId);
    if (reputation.postId !== undefined) {
      if (
        post === undefined ||
        post.threadId !== thread._id ||
        post.status !== "active"
      ) {
        return [];
      }
    }

    const postNumber = post?.postNumber;

    return [
      {
        _id: reputation._id,
        _creationTime: reputation._creationTime,
        fromUserId: reputation.fromUserId,
        fromUsername: membersById.get(reputation.fromUserId) ?? UNKNOWN_AUTHOR,
        toUserId: reputation.toUserId,
        toUsername: membersById.get(reputation.toUserId) ?? UNKNOWN_AUTHOR,
        targetType: reputation.targetType,
        score: reputation.score,
        comment: reputation.comment,
        categoryId: category._id,
        categorySlug: category.slug,
        categoryName: category.name,
        threadId: thread._id,
        threadSlug: thread.slug,
        threadTitle: thread.title,
        postId: post?._id,
        postNumber,
        postPage:
          postNumber === undefined
            ? undefined
            : pageForPostNumber(postNumber, POST_PAGE_SIZE),
        createdAt: reputation.createdAt,
        updatedAt: reputation.updatedAt,
      },
    ];
  });
}

async function hydrateMyForumWarnings(
  ctx: QueryCtx | MutationCtx,
  warnings: ForumWarningDoc[],
  viewer: UserDoc,
  now: number,
) {
  const [moderatorNamesById, categoriesById, threadsById, postsById] =
    await Promise.all([
      loadUserNamesById(
        ctx,
        warnings.map((warning) => warning.actorUserId),
      ),
      loadCategoriesById(
        ctx,
        warnings.flatMap((warning) =>
          warning.categoryId === undefined ? [] : [warning.categoryId],
        ),
      ),
      loadThreadsById(
        ctx,
        warnings.flatMap((warning) =>
          warning.threadId === undefined ? [] : [warning.threadId],
        ),
      ),
      loadPostsById(
        ctx,
        warnings.flatMap((warning) =>
          warning.postId === undefined ? [] : [warning.postId],
        ),
      ),
    ]);

  const visibleCategoryIds = new Set<Id<"forumCategories">>();
  await Promise.all(
    Array.from(categoriesById.values()).map(async (category) => {
      if (await canViewCategoryWithAncestors(ctx, viewer, category)) {
        visibleCategoryIds.add(category._id);
      }
    }),
  );

  return warnings.map((warning) => {
    const category =
      warning.categoryId === undefined ||
      !visibleCategoryIds.has(warning.categoryId)
        ? undefined
        : categoriesById.get(warning.categoryId);
    const thread =
      category === undefined || warning.threadId === undefined
        ? undefined
        : threadsById.get(warning.threadId);
    const post =
      category === undefined || warning.postId === undefined
        ? undefined
        : postsById.get(warning.postId);
    const status =
      warning.status === "active" &&
      warning.expiresAt !== undefined &&
      warning.expiresAt <= now
        ? "expired"
        : warning.status;
    const postNumber = post?.postNumber;

    return {
      _id: warning._id,
      _creationTime: warning._creationTime,
      status,
      active: status === "active",
      points: warning.points,
      reason: warning.reason,
      moderator: moderatorNamesById.get(warning.actorUserId) ?? UNKNOWN_AUTHOR,
      categoryId: category?._id,
      categorySlug: category?.slug,
      categoryName: category?.name,
      threadId: thread?._id,
      threadSlug: thread?.slug,
      threadTitle: thread?.title,
      postId: post?._id,
      postNumber,
      postPage:
        postNumber === undefined
          ? undefined
          : pageForPostNumber(postNumber, POST_PAGE_SIZE),
      reportId: warning.reportId,
      expiresAt: warning.expiresAt,
      revokedAt: warning.revokedAt,
      createdAt: warning.createdAt,
      updatedAt: warning.updatedAt,
    };
  });
}

async function hydrateMyPendingForumContent(
  ctx: QueryCtx | MutationCtx,
  threads: ForumThreadDoc[],
  posts: ForumPostDoc[],
  viewer: UserDoc,
) {
  const [threadCategoriesById, postThreadsById] = await Promise.all([
    loadCategoriesById(
      ctx,
      threads.map((thread) => thread.categoryId),
    ),
    loadThreadsById(
      ctx,
      posts.map((post) => post.threadId),
    ),
  ]);
  const postCategoriesById = await loadCategoriesById(
    ctx,
    Array.from(postThreadsById.values()).map((thread) => thread.categoryId),
  );

  const visibleThreadCategoryIds = new Set<Id<"forumCategories">>();
  await Promise.all(
    Array.from(threadCategoriesById.values()).map(async (category) => {
      if (await canViewCategoryWithAncestors(ctx, viewer, category)) {
        visibleThreadCategoryIds.add(category._id);
      }
    }),
  );

  const visiblePostCategoryIds = new Set<Id<"forumCategories">>();
  await Promise.all(
    Array.from(postCategoriesById.values()).map(async (category) => {
      if (await canViewCategoryWithAncestors(ctx, viewer, category)) {
        visiblePostCategoryIds.add(category._id);
      }
    }),
  );

  return {
    threads: threads.map((thread) => {
      const category = visibleThreadCategoryIds.has(thread.categoryId)
        ? threadCategoriesById.get(thread.categoryId)
        : undefined;
      return {
        _id: thread._id,
        _creationTime: thread._creationTime,
        type: "thread" as const,
        title: thread.title,
        excerpt: excerpt(thread.body, 180),
        categoryId: category?._id,
        categorySlug: category?.slug,
        categoryName: category?.name,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      };
    }),
    posts: posts.map((post) => {
      const thread = postThreadsById.get(post.threadId);
      const category =
        thread !== undefined && visiblePostCategoryIds.has(thread.categoryId)
          ? postCategoriesById.get(thread.categoryId)
          : undefined;
      return {
        _id: post._id,
        _creationTime: post._creationTime,
        type: "reply" as const,
        excerpt: excerpt(post.body, 180),
        threadId: thread?._id,
        threadSlug: category === undefined ? undefined : thread?.slug,
        threadTitle: category === undefined ? undefined : thread?.title,
        categoryId: category?._id,
        categorySlug: category?.slug,
        categoryName: category?.name,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
      };
    }),
  };
}

type ForumWarningContext = {
  categoryId?: Id<"forumCategories">;
  threadId?: Id<"forumThreads">;
  postId?: Id<"forumPosts">;
  report: ForumReportDoc | null;
};

async function resolveForumWarningContext(
  ctx: QueryCtx | MutationCtx,
  args: {
    targetUserId: Id<"users">;
    categoryId?: Id<"forumCategories">;
    threadId?: Id<"forumThreads">;
    postId?: Id<"forumPosts">;
    reportId?: Id<"forumReports">;
  },
): Promise<ForumWarningContext> {
  if (args.reportId !== undefined) {
    const report = await ctx.db.get(args.reportId);
    if (report === null) {
      throw forumError("REPORT_NOT_FOUND", "That report no longer exists.");
    }
    const thread =
      report.threadId === undefined ? null : await ctx.db.get(report.threadId);
    const post =
      report.postId === undefined ? null : await ctx.db.get(report.postId);
    const message =
      report.messageId === undefined
        ? null
        : await ctx.db.get(report.messageId);
    const targetUserId = reportTargetUserId(
      report,
      thread ?? undefined,
      post ?? undefined,
      message ?? undefined,
    );
    if (targetUserId === undefined || targetUserId !== args.targetUserId) {
      throw forumError(
        "INVALID_WARNING_TARGET",
        "The warning target no longer matches the reported content.",
      );
    }
    return {
      categoryId: report.categoryId,
      threadId: report.threadId,
      postId: report.postId,
      report,
    };
  }

  if (args.postId !== undefined) {
    const post = await ctx.db.get(args.postId);
    if (post === null) {
      throw forumError("POST_NOT_FOUND", "That reply is not available.");
    }
    if (post.authorId !== args.targetUserId) {
      throw forumError(
        "INVALID_WARNING_TARGET",
        "The reply author does not match.",
      );
    }
    return {
      categoryId: post.categoryId,
      threadId: post.threadId,
      postId: post._id,
      report: null,
    };
  }

  if (args.threadId !== undefined) {
    const thread = await ctx.db.get(args.threadId);
    if (thread === null) {
      throw forumError("THREAD_NOT_FOUND", "That thread is not available.");
    }
    if (thread.authorId !== args.targetUserId) {
      throw forumError(
        "INVALID_WARNING_TARGET",
        "The thread author does not match.",
      );
    }
    return {
      categoryId: thread.categoryId,
      threadId: thread._id,
      report: null,
    };
  }

  return {
    categoryId: args.categoryId,
    report: null,
  };
}

function reportTargetUserId(
  report: ForumReportDoc,
  thread?: ForumThreadDoc,
  post?: ForumPostDoc,
  message?: ForumPrivateMessageDoc,
) {
  if (report.entityType === "privateMessage") {
    return message?.senderUserId ?? report.snapshotAuthorId;
  }
  if (report.entityType === "post") {
    return post?.authorId ?? report.snapshotAuthorId;
  }
  return thread?.authorId ?? report.snapshotAuthorId;
}

function threadPrefixKey(
  categoryId: Id<"forumCategories"> | undefined,
  slug: string,
) {
  return categoryId === undefined
    ? `global:${slug}`
    : `category:${categoryId}:${slug}`;
}

function forumAnnouncementKey(
  categoryId: Id<"forumCategories"> | undefined,
  slug: string,
) {
  return categoryId === undefined
    ? `global:${slug}`
    : `category:${categoryId}:${slug}`;
}

function forumVisibilityProfileDeltaToken(
  threadId: Id<"forumThreads">,
  isVisible: boolean,
  now: number,
) {
  return `${threadId}:${isVisible ? "visible" : "hidden"}:${now}`;
}

function movedThreadCategorySyncToken(
  threadId: Id<"forumThreads">,
  categoryId: Id<"forumCategories">,
  now: number,
) {
  return `${threadId}:moved:${categoryId}:${now}`;
}

function threadPrefixSnapshot(prefix: ForumThreadPrefixDoc | null | undefined) {
  return {
    prefixId: prefix?._id,
    prefixSlug: prefix?.slug,
    prefixLabel: prefix?.label,
    prefixColor: prefix?.color,
  };
}

function threadPrefixSnapshotFromThread(thread: ForumThreadDoc) {
  return {
    prefixId: thread.prefixId,
    prefixSlug: thread.prefixSlug,
    prefixLabel: thread.prefixLabel,
    prefixColor: thread.prefixColor,
  };
}

function hasThreadPrefixSnapshotChanged(
  thread: ForumThreadDoc,
  snapshot: ReturnType<typeof threadPrefixSnapshot>,
) {
  return (
    (thread.prefixId ?? null) !== (snapshot.prefixId ?? null) ||
    (thread.prefixSlug ?? null) !== (snapshot.prefixSlug ?? null) ||
    (thread.prefixLabel ?? null) !== (snapshot.prefixLabel ?? null) ||
    (thread.prefixColor ?? null) !== (snapshot.prefixColor ?? null)
  );
}

function threadSearchBodyWithPrefix(body: string, prefixLabel?: string) {
  return prefixLabel === undefined ? body : `${prefixLabel}\n${body}`;
}

function publicThreadPrefixRecord(prefix: ForumThreadPrefixDoc) {
  return {
    _id: prefix._id,
    _creationTime: prefix._creationTime,
    categoryId: prefix.categoryId,
    slug: prefix.slug,
    label: prefix.label,
    description: prefix.description,
    color: prefix.color,
    status: prefix.status,
    position: prefix.position,
  };
}

function publicThreadPrefixRecordFromThread(thread: ForumThreadDoc) {
  if (thread.prefixLabel === undefined && thread.prefixSlug === undefined) {
    return null;
  }
  return {
    _id: thread.prefixId,
    slug: thread.prefixSlug ?? "legacy",
    label: thread.prefixLabel ?? thread.prefixSlug ?? "Prefix",
    color: thread.prefixColor,
  };
}

function adminThreadPrefixRecord(
  prefix: ForumThreadPrefixDoc,
  category?: ForumCategoryDoc,
) {
  return {
    ...publicThreadPrefixRecord(prefix),
    categorySlug: category?.slug,
    categoryName: category?.name,
    createdAt: prefix.createdAt,
    updatedAt: prefix.updatedAt,
  };
}

function publicForumAnnouncementRecord(
  announcement: ForumAnnouncementDoc,
  category?: ForumCategoryDoc,
) {
  return {
    _id: announcement._id,
    _creationTime: announcement._creationTime,
    categoryId: announcement.categoryId,
    categorySlug: category?.slug,
    categoryName: category?.name,
    slug: announcement.slug,
    title: announcement.title,
    body: announcement.body,
    status: announcement.status,
    position: announcement.position,
    createdAt: announcement.createdAt,
    updatedAt: announcement.updatedAt,
  };
}

function adminForumAnnouncementRecord(
  announcement: ForumAnnouncementDoc,
  category?: ForumCategoryDoc,
  createdByName?: string,
  updatedByName?: string,
) {
  return {
    ...publicForumAnnouncementRecord(announcement, category),
    key: announcement.key,
    createdBy: announcement.createdBy,
    updatedBy: announcement.updatedBy,
    createdByName: createdByName ?? UNKNOWN_AUTHOR,
    updatedByName: updatedByName ?? UNKNOWN_AUTHOR,
  };
}

function publicForumHelpDocumentRecord(document: ForumHelpDocumentDoc) {
  return {
    _id: document._id,
    _creationTime: document._creationTime,
    slug: document.slug,
    title: document.title,
    body: document.body,
    status: document.status,
    position: document.position,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function publicForumHelpDocumentSummaryRecord(document: ForumHelpDocumentDoc) {
  return {
    _id: document._id,
    _creationTime: document._creationTime,
    slug: document.slug,
    title: document.title,
    excerpt: forumHelpDocumentExcerpt(document.body),
    status: document.status,
    position: document.position,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function adminForumHelpDocumentRecord(
  document: ForumHelpDocumentDoc,
  createdByName?: string,
  updatedByName?: string,
) {
  return {
    ...publicForumHelpDocumentRecord(document),
    createdBy: document.createdBy,
    updatedBy: document.updatedBy,
    createdByName: createdByName ?? UNKNOWN_AUTHOR,
    updatedByName: updatedByName ?? UNKNOWN_AUTHOR,
  };
}

function publicForumCalendarEventRecord(event: ForumCalendarEventDoc) {
  return {
    _id: event._id,
    _creationTime: event._creationTime,
    slug: event.slug,
    title: event.title,
    body: event.body,
    status: event.status,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    month: event.month,
    day: event.day,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function publicForumCalendarEventSummaryRecord(event: ForumCalendarEventDoc) {
  return {
    _id: event._id,
    _creationTime: event._creationTime,
    slug: event.slug,
    title: event.title,
    excerpt: forumCalendarEventExcerpt(event.body),
    status: event.status,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    month: event.month,
    day: event.day,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function adminForumCalendarEventRecord(
  event: ForumCalendarEventDoc,
  createdByName?: string,
  updatedByName?: string,
) {
  return {
    ...publicForumCalendarEventRecord(event),
    createdBy: event.createdBy,
    updatedBy: event.updatedBy,
    createdByName: createdByName ?? UNKNOWN_AUTHOR,
    updatedByName: updatedByName ?? UNKNOWN_AUTHOR,
  };
}

function publicForumBoardRulesRecord(
  rules: ForumBoardRulesDoc,
  category?: ForumCategoryDoc,
) {
  return {
    _id: rules._id,
    _creationTime: rules._creationTime,
    categoryId: rules.categoryId,
    categorySlug: category?.slug,
    categoryName: category?.name,
    title: rules.title,
    body: rules.body,
    status: rules.status,
    createdAt: rules.createdAt,
    updatedAt: rules.updatedAt,
  };
}

function adminForumBoardRulesRecord(
  rules: ForumBoardRulesDoc,
  category?: ForumCategoryDoc,
  createdByName?: string,
  updatedByName?: string,
) {
  return {
    ...publicForumBoardRulesRecord(rules, category),
    createdBy: rules.createdBy,
    updatedBy: rules.updatedBy,
    createdByName: createdByName ?? UNKNOWN_AUTHOR,
    updatedByName: updatedByName ?? UNKNOWN_AUTHOR,
  };
}

async function activeWarningSummariesForUsers(
  ctx: QueryCtx | MutationCtx,
  userIds: Array<Id<"users">>,
  now: number,
) {
  const entries = await Promise.all(
    [...new Set(userIds)].map(async (userId) => {
      const warnings = await ctx.db
        .query("forumWarnings")
        .withIndex("by_targetUserId_and_status_and_createdAt", (q) =>
          q.eq("targetUserId", userId).eq("status", "active"),
        )
        .order("desc")
        .take(100);
      const activeWarnings = warnings.filter(
        (warning) => warning.expiresAt === undefined || warning.expiresAt > now,
      );
      return [
        userId,
        {
          activeWarningCount: activeWarnings.length,
          activeWarningPoints: activeWarnings.reduce(
            (total, warning) => total + warning.points,
            0,
          ),
        },
      ] as const;
    }),
  );

  return new Map(entries);
}

async function activeWarningSummaryForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  now: number,
) {
  const summaries = await activeWarningSummariesForUsers(ctx, [userId], now);
  return (
    summaries.get(userId) ?? {
      activeWarningCount: 0,
      activeWarningPoints: 0,
    }
  );
}

async function hydrateForumModerationEvents(
  ctx: QueryCtx | MutationCtx,
  events: ForumModerationEventDoc[],
) {
  const [actorsById, categoriesById, threadsById] = await Promise.all([
    loadUserNamesById(
      ctx,
      events.map((event) => event.actorUserId),
    ),
    loadCategoriesById(
      ctx,
      events.flatMap((event) =>
        event.categoryId === undefined ? [] : [event.categoryId],
      ),
    ),
    loadThreadsById(
      ctx,
      events.flatMap((event) =>
        event.threadId === undefined ? [] : [event.threadId],
      ),
    ),
  ]);

  return events.map((event) =>
    forumModerationEventRecord(
      event,
      actorsById.get(event.actorUserId),
      event.categoryId === undefined
        ? undefined
        : categoriesById.get(event.categoryId),
      event.threadId === undefined
        ? undefined
        : threadsById.get(event.threadId),
    ),
  );
}

function publicCategoryRecord(
  category: ForumCategoryDoc,
  lastThread?: ForumThreadDoc,
  lastPostTarget?: ForumLastPostTarget,
  options?: {
    viewerHasRead?: boolean;
  },
) {
  return {
    _id: category._id,
    _creationTime: category._creationTime,
    slug: category.slug,
    name: category.name,
    description: category.description,
    kind: categoryKind(category),
    parentCategoryId: category.parentCategoryId,
    isPostable: isBoardCategory(category),
    status: category.status,
    viewAccess: categoryViewAccess(category),
    threadAccess: categoryThreadAccess(category),
    replyAccess: categoryReplyAccess(category),
    pollAccess: categoryPollAccess(category),
    position: category.position,
    threadCount: category.threadCount,
    postCount: category.postCount,
    lastPostAt: category.lastPostAt,
    viewerHasRead: options?.viewerHasRead,
    viewerUnread:
      options?.viewerHasRead === undefined ? undefined : !options.viewerHasRead,
    lastThread: lastThread
      ? {
          threadId: lastThread._id,
          categorySlug: lastThread.categorySlug,
          slug: lastThread.slug,
          title: lastThread.title,
          status: lastThread.status,
          pinned: lastThread.pinned,
          lastPostNumber: lastPostTarget?.lastPostNumber,
          lastPostPage: lastPostTarget?.lastPostPage,
        }
      : undefined,
  };
}

function adminCategoryRecord(
  category: ForumCategoryDoc,
  lastThread?: ForumThreadDoc,
  moderators: ForumCategoryModeratorSummaryRecord[] = [],
) {
  return {
    ...publicCategoryRecord(category, lastThread),
    lastThreadId: category.lastThreadId,
    lastPostId: category.lastPostId,
    moderators,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

type ForumCategoryModeratorSummaryRecord = {
  _id: Id<"forumCategoryModerators">;
  userId: Id<"users">;
  username?: string;
  displayName: string;
  assignedAt: number;
  assignedBy?: Id<"users">;
  assignedByName: string;
};

async function loadCategoryModeratorSummaries(
  ctx: QueryCtx | MutationCtx,
  categoryId: Id<"forumCategories">,
) {
  const assignments = await ctx.db
    .query("forumCategoryModerators")
    .withIndex("by_categoryId", (q) => q.eq("categoryId", categoryId))
    .take(50);
  return await hydrateCategoryModeratorRecords(ctx, assignments);
}

async function loadCategoryModeratorSummariesByCategoryId(
  ctx: QueryCtx | MutationCtx,
  categoryIds: Array<Id<"forumCategories">>,
) {
  const entries = await Promise.all(
    [...new Set(categoryIds)].map(
      async (categoryId) =>
        [
          categoryId,
          await loadCategoryModeratorSummaries(ctx, categoryId),
        ] as const,
    ),
  );
  return new Map(entries);
}

async function hydrateCategoryModeratorRecords(
  ctx: QueryCtx | MutationCtx,
  assignments: ForumCategoryModeratorDoc[],
): Promise<ForumCategoryModeratorSummaryRecord[]> {
  const userIds = assignments.flatMap((assignment) => [
    assignment.userId,
    assignment.assignedBy,
  ]);
  const users = await Promise.all(
    [...new Set(userIds)].map(
      async (userId) => [userId, await ctx.db.get(userId)] as const,
    ),
  );
  const usersById = new Map(users);
  return assignments
    .map((assignment) => {
      const user = usersById.get(assignment.userId);
      const assignedBy = usersById.get(assignment.assignedBy);
      return {
        _id: assignment._id,
        userId: assignment.userId,
        username: user?.usernameNormalized ?? user?.username,
        displayName: displayName(user),
        assignedAt: assignment.createdAt,
        assignedBy: assignment.assignedBy,
        assignedByName: displayName(assignedBy),
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

type PublicForumCategoryRecord = ReturnType<typeof publicCategoryRecord> & {
  ancestors?: PublicForumCategoryRecord[];
  children?: PublicForumCategoryRecord[];
};

async function publicCategoryRecordWithAncestors(
  ctx: QueryCtx | MutationCtx,
  category: ForumCategoryDoc,
  user: UserDoc | null,
) {
  const ancestors: PublicForumCategoryRecord[] = [];
  let parentCategoryId = category.parentCategoryId;

  for (
    let depth = 0;
    depth < 10 && parentCategoryId !== undefined;
    depth += 1
  ) {
    const parent = await ctx.db.get(parentCategoryId);
    if (
      parent === null ||
      !(await canViewCategoryWithAncestors(ctx, user, parent))
    ) {
      break;
    }
    ancestors.unshift(publicCategoryRecord(parent));
    parentCategoryId = parent.parentCategoryId;
  }

  const [subscription, categoryRead] =
    user === null
      ? [null, null]
      : await Promise.all([
          loadCategorySubscription(ctx, user._id, category._id),
          loadCategoryRead(ctx, user._id, category._id),
        ]);
  const userCanModerateCategory = await canModerateCategory(
    ctx,
    user,
    category,
  );
  const record = {
    ...publicCategoryRecord(category, undefined, undefined, {
      viewerHasRead:
        user === null ? undefined : hasReadCategory(category, categoryRead),
    }),
    viewerCanCreateThread: canStartThreadInCategory(
      user,
      category,
      userCanModerateCategory,
    ),
    viewerCanReply: canReplyInCategory(user, category, userCanModerateCategory),
    viewerCanCreatePoll: canVoteInCategory(
      user,
      category,
      userCanModerateCategory,
    ),
    viewerSubscribedToCategory:
      user === null ? undefined : subscription?.status === "active",
  };
  return ancestors.length > 0 ? { ...record, ancestors } : record;
}

async function publicCategoryRecordWithNavigation(
  ctx: QueryCtx | MutationCtx,
  category: ForumCategoryDoc,
  user: UserDoc | null,
) {
  const [record, childRows] = await Promise.all([
    publicCategoryRecordWithAncestors(ctx, category, user),
    ctx.db
      .query("forumCategories")
      .withIndex("by_parentCategoryId_and_position", (q) =>
        q.eq("parentCategoryId", category._id),
      )
      .take(CATEGORY_LIST_LIMIT),
  ]);
  const children = (
    await visibleCategoriesForUser(
      ctx,
      childRows.filter(
        (child) => child.status === "active" && isBoardCategory(child),
      ),
      user,
    )
  ).map((child) => publicCategoryRecord(child));
  const latestActivity = children.reduce(
    (latest, child) =>
      (child.lastPostAt ?? 0) > (latest.lastPostAt ?? 0) ? child : latest,
    record,
  );

  return {
    ...record,
    threadCount:
      record.threadCount +
      children.reduce((total, child) => total + child.threadCount, 0),
    postCount:
      record.postCount +
      children.reduce((total, child) => total + child.postCount, 0),
    lastPostAt: latestActivity.lastPostAt,
    lastThread: latestActivity.lastThread,
    children,
  };
}

function buildPublicCategorySections(categories: PublicForumCategoryRecord[]) {
  const recordsById = new Map(
    categories.map((category) => [category._id, category]),
  );
  const boards = categories.filter((category) => category.kind === "board");
  const sections = categories.filter((category) => category.kind === "section");
  const childBoardsByParentId = new Map<string, typeof boards>();

  for (const board of boards) {
    if (board.parentCategoryId === undefined) {
      continue;
    }
    const parent = recordsById.get(board.parentCategoryId);
    if (parent?.kind !== "board") {
      continue;
    }
    const children = childBoardsByParentId.get(board.parentCategoryId) ?? [];
    children.push(board);
    childBoardsByParentId.set(board.parentCategoryId, children);
  }

  const attachChildren = (board: (typeof boards)[number]) => {
    const children = childBoardsByParentId.get(board._id) ?? [];
    if (children.length === 0) {
      return board;
    }
    const latestActivity = children.reduce(
      (latest, child) =>
        (child.lastPostAt ?? 0) > (latest.lastPostAt ?? 0) ? child : latest,
      board,
    );
    return {
      ...board,
      threadCount:
        board.threadCount +
        children.reduce((total, child) => total + child.threadCount, 0),
      postCount:
        board.postCount +
        children.reduce((total, child) => total + child.postCount, 0),
      lastPostAt: latestActivity.lastPostAt,
      lastThread: latestActivity.lastThread,
      children,
    };
  };
  const sectionGroups = sections.map((section) => {
    const sectionBoards = boards
      .filter((board) => board.parentCategoryId === section._id)
      .map(attachChildren);
    return publicCategorySectionRecord(section, sectionBoards);
  });
  const rootBoards = boards
    .filter((board) => board.parentCategoryId === undefined)
    .map(attachChildren);

  return rootBoards.length > 0 || sectionGroups.length === 0
    ? [publicCategorySectionRecord(null, rootBoards), ...sectionGroups]
    : sectionGroups;
}

function publicCategorySectionRecord(
  section: PublicForumCategoryRecord | null,
  boards: PublicForumCategoryRecord[],
) {
  return {
    section,
    boards,
    threadCount: boards.reduce((total, board) => total + board.threadCount, 0),
    postCount: boards.reduce((total, board) => total + board.postCount, 0),
  };
}

function publicThreadListRecord(
  thread: ForumThreadDoc,
  author?: string,
  options?: {
    categoryName?: string;
    lastPostAuthor?: string;
    lastPostTarget?: ForumLastPostTarget;
    viewerHasRead?: boolean;
    firstUnreadPostNumber?: number;
  },
) {
  const firstUnreadPostNumber = options?.firstUnreadPostNumber;
  return {
    _id: thread._id,
    _creationTime: thread._creationTime,
    categoryId: thread.categoryId,
    categorySlug: thread.categorySlug,
    categoryName: options?.categoryName,
    prefixId: thread.prefixId,
    prefix: publicThreadPrefixRecordFromThread(thread),
    slug: thread.slug,
    title: thread.title,
    status: thread.status,
    pinned: thread.pinned,
    replyCount: thread.replyCount,
    viewCount: thread.viewCount,
    ratingCount: thread.ratingCount ?? 0,
    ratingAverage: threadRatingAverage(thread),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastPostAt: thread.lastPostAt,
    lastPostNumber: options?.lastPostTarget?.lastPostNumber,
    lastPostPage: options?.lastPostTarget?.lastPostPage,
    author: author ?? UNKNOWN_AUTHOR,
    lastPostAuthor: options?.lastPostAuthor ?? UNKNOWN_AUTHOR,
    viewerHasRead: options?.viewerHasRead,
    viewerUnread:
      options?.viewerHasRead === undefined ? undefined : !options.viewerHasRead,
    firstUnreadPostNumber,
    firstUnreadPage:
      firstUnreadPostNumber === undefined
        ? undefined
        : pageForPostNumber(firstUnreadPostNumber, POST_PAGE_SIZE),
  };
}

function publicThreadDetailRecord(
  thread: ForumThreadDoc,
  author?: string,
  lastPostAuthor?: string,
  options?: {
    viewerCanReply: boolean;
    viewerCanModerate: boolean;
    viewerCanEdit?: boolean;
    viewerCanDelete?: boolean;
    viewerHasRead?: boolean;
    viewerSubscribed?: boolean;
    viewerCanRateThread?: boolean;
    viewerRating?: number;
    viewerCanGiveReputation?: boolean;
    viewerReputationScore?: number;
    authorProfile?: ForumUserProfileDoc;
    authorIdentity?: {
      username?: string;
      image?: string;
      joinedAt?: number;
    };
    firstUnreadPostNumber?: number;
    lastEditedByName?: string;
    attachments?: ReturnType<typeof publicForumAttachmentRecord>[];
  },
) {
  return {
    ...publicThreadListRecord(thread, author, {
      lastPostAuthor,
      viewerHasRead: options?.viewerHasRead,
      firstUnreadPostNumber: options?.firstUnreadPostNumber,
    }),
    body: thread.body,
    lastEditedAt: thread.lastEditedAt,
    lastEditedBy: thread.lastEditedBy,
    lastEditedByName: options?.lastEditedByName,
    lastEditReason: thread.lastEditReason,
    editCount: thread.editCount ?? 0,
    attachments: options?.attachments ?? [],
    viewerCanReply: options?.viewerCanReply ?? false,
    viewerCanModerate: options?.viewerCanModerate ?? false,
    viewerCanEdit: options?.viewerCanEdit ?? false,
    viewerCanDelete: options?.viewerCanDelete ?? false,
    viewerSubscribed: options?.viewerSubscribed ?? false,
    viewerCanRateThread: options?.viewerCanRateThread ?? false,
    viewerRating: options?.viewerRating ?? 0,
    viewerCanGiveReputation: options?.viewerCanGiveReputation ?? false,
    viewerReputationScore: options?.viewerReputationScore ?? 0,
    ...publicAuthorForumProfile(
      options?.authorProfile,
      author,
      options?.authorIdentity,
    ),
  };
}

function adminThreadListRecord(
  thread: ForumThreadDoc,
  category?: ForumCategoryDoc,
  author?: string,
  lastPostAuthor?: string,
) {
  return {
    ...publicThreadListRecord(thread, author, { lastPostAuthor }),
    categoryName: category?.name,
    lastPostId: thread.lastPostId,
    lockedAt: thread.lockedAt,
    lockedBy: thread.lockedBy,
    deletedAt: thread.deletedAt,
    deletedBy: thread.deletedBy,
    moderationReason: thread.moderationReason,
  };
}

function adminThreadDetailRecord(
  thread: ForumThreadDoc,
  category: ForumCategoryDoc,
  author?: string,
  lastPostAuthor?: string,
) {
  return {
    ...adminThreadListRecord(thread, category, author, lastPostAuthor),
    body: thread.body,
  };
}

function adminContentEditRecord(
  edit: ForumContentEditDoc,
  actor?: string,
  target?: string,
) {
  return {
    _id: edit._id,
    _creationTime: edit._creationTime,
    entityType: edit.entityType,
    threadId: edit.threadId,
    postId: edit.postId,
    actorUserId: edit.actorUserId,
    actor: actor ?? UNKNOWN_AUTHOR,
    targetUserId: edit.targetUserId,
    target: target ?? UNKNOWN_AUTHOR,
    previousTitle: edit.previousTitle,
    nextTitle: edit.nextTitle,
    previousPrefixId: edit.previousPrefixId,
    nextPrefixId: edit.nextPrefixId,
    previousPrefixLabel: edit.previousPrefixLabel,
    nextPrefixLabel: edit.nextPrefixLabel,
    previousBody: edit.previousBody,
    nextBody: edit.nextBody,
    editReason: edit.editReason,
    createdAt: edit.createdAt,
  };
}

function publicForumAttachmentRecord(
  attachment: ForumAttachmentDoc,
  url: string,
) {
  return {
    _id: attachment._id,
    _creationTime: attachment._creationTime,
    threadId: attachment.threadId,
    postId: attachment.postId,
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
    altText: attachment.altText,
    credit: attachment.credit,
    sourceUrl: attachment.sourceUrl,
    url,
    createdAt: attachment.createdAt,
  };
}

function publicPostRecord(
  post: ForumPostDoc,
  author?: string,
  options?: {
    viewerCanEdit?: boolean;
    viewerCanDelete?: boolean;
    viewerCanGiveReputation?: boolean;
    viewerReputationScore?: number;
    authorProfile?: ForumUserProfileDoc;
    authorIdentity?: {
      username?: string;
      image?: string;
      joinedAt?: number;
    };
    postNumberFallback?: number;
    lastEditedByName?: string;
    attachments?: ReturnType<typeof publicForumAttachmentRecord>[];
  },
) {
  const postNumber = post.postNumber ?? options?.postNumberFallback;
  return {
    _id: post._id,
    _creationTime: post._creationTime,
    threadId: post.threadId,
    categoryId: post.categoryId,
    authorId: post.authorId,
    body: post.body,
    postNumber,
    postPage:
      postNumber === undefined
        ? undefined
        : pageForPostNumber(postNumber, POST_PAGE_SIZE),
    status: post.status,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    lastEditedAt: post.lastEditedAt,
    lastEditedBy: post.lastEditedBy,
    lastEditedByName: options?.lastEditedByName,
    lastEditReason: post.lastEditReason,
    editCount: post.editCount ?? 0,
    attachments: options?.attachments ?? [],
    author: author ?? UNKNOWN_AUTHOR,
    viewerCanEdit: options?.viewerCanEdit ?? false,
    viewerCanDelete: options?.viewerCanDelete ?? false,
    viewerCanGiveReputation: options?.viewerCanGiveReputation ?? false,
    viewerReputationScore: options?.viewerReputationScore ?? 0,
    ...publicAuthorForumProfile(
      options?.authorProfile,
      author,
      options?.authorIdentity,
    ),
  };
}

function publicNotificationRecord(
  notification: ForumNotificationDoc,
  thread: ForumThreadDoc,
  category: ForumCategoryDoc,
  actor?: string,
  post?: ForumPostDoc,
) {
  const postNumber = post?.postNumber;
  return {
    _id: notification._id,
    _creationTime: notification._creationTime,
    type: notification.type,
    status: notification.status,
    threadId: thread._id,
    threadSlug: thread.slug,
    threadTitle: thread.title,
    categoryId: category._id,
    categorySlug: category.slug,
    categoryName: category.name,
    postId: notification.postId,
    postNumber,
    postPage:
      postNumber === undefined
        ? undefined
        : pageForPostNumber(postNumber, POST_PAGE_SIZE),
    actor: actor ?? UNKNOWN_AUTHOR,
    createdAt: notification.createdAt,
    readAt: notification.readAt,
  };
}

type PrivateMessageUserIdentity = {
  username?: string;
  joinedAt?: number;
};

function privateMessageListRecord(
  message: ForumPrivateMessageDoc,
  viewerUserId: Id<"users">,
  usersById: Map<Id<"users">, PrivateMessageUserIdentity>,
  boxOverride?: ForumPrivateMessageBox,
) {
  const detail = privateMessageDetailRecord(
    message,
    viewerUserId,
    usersById,
    boxOverride,
  );
  return {
    ...detail,
    body: undefined,
    excerpt: excerpt(message.body, 180),
  };
}

function privateMessageDetailRecord(
  message: ForumPrivateMessageDoc,
  viewerUserId: Id<"users">,
  usersById: Map<Id<"users">, PrivateMessageUserIdentity>,
  boxOverride?: ForumPrivateMessageBox,
) {
  const sourceBox = privateMessageSourceBox(message, viewerUserId, boxOverride);
  const box = boxOverride ?? sourceBox;
  const senderUsername =
    usersById.get(message.senderUserId)?.username ?? UNKNOWN_AUTHOR;
  const recipientUsername =
    usersById.get(message.recipientUserId)?.username ?? UNKNOWN_AUTHOR;
  return {
    _id: message._id,
    _creationTime: message._creationTime,
    senderUserId: message.senderUserId,
    recipientUserId: message.recipientUserId,
    senderUsername,
    recipientUsername,
    otherUsername: sourceBox === "inbox" ? senderUsername : recipientUsername,
    box,
    sourceBox,
    subject: message.subject,
    body: message.body,
    readAt: message.readAt,
    unread:
      box === "inbox" && sourceBox === "inbox" && message.readAt === undefined,
    trashedAt:
      sourceBox === "inbox"
        ? message.recipientDeletedAt
        : message.senderDeletedAt,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function privateMessageSourceBox(
  message: ForumPrivateMessageDoc,
  viewerUserId: Id<"users">,
  boxOverride?: ForumPrivateMessageBox,
): ForumPrivateMessageSide {
  if (boxOverride === "inbox") {
    return "inbox";
  }
  if (boxOverride === "sent") {
    return "sent";
  }
  if (boxOverride === "trash") {
    if (
      message.recipientUserId === viewerUserId &&
      message.recipientDeletedAt !== undefined &&
      message.recipientPurgedAt === undefined
    ) {
      return "inbox";
    }
    return "sent";
  }
  return message.recipientUserId === viewerUserId &&
    message.recipientDeletedAt === undefined
    ? "inbox"
    : "sent";
}

function privateMessageMatchesQuery(
  message: ForumPrivateMessageDoc,
  viewerUserId: Id<"users">,
  usersById: Map<Id<"users">, PrivateMessageUserIdentity>,
  searchQuery: string,
  boxOverride?: ForumPrivateMessageBox,
) {
  if (searchQuery.length === 0) {
    return true;
  }
  const sourceBox = privateMessageSourceBox(message, viewerUserId, boxOverride);
  const senderUsername =
    usersById.get(message.senderUserId)?.username ?? UNKNOWN_AUTHOR;
  const recipientUsername =
    usersById.get(message.recipientUserId)?.username ?? UNKNOWN_AUTHOR;
  const otherUsername =
    sourceBox === "inbox" ? senderUsername : recipientUsername;
  return [
    message.subject,
    message.body,
    senderUsername,
    recipientUsername,
    otherUsername,
  ]
    .join("\n")
    .toLowerCase()
    .includes(searchQuery);
}

async function requirePrivateMessageForUser(
  ctx: QueryCtx,
  messageId: Id<"forumPrivateMessages">,
  user: UserDoc,
  box?: ForumPrivateMessageBox,
) {
  const message = await ctx.db.get(messageId);
  if (message === null) {
    throw forumError(
      "PRIVATE_MESSAGE_NOT_FOUND",
      "That private message is not available.",
    );
  }

  const visibleAsRecipient =
    message.recipientUserId === user._id &&
    message.recipientPurgedAt === undefined &&
    (box === "trash"
      ? message.recipientDeletedAt !== undefined
      : message.recipientDeletedAt === undefined);
  const visibleAsSender =
    message.senderUserId === user._id &&
    message.senderPurgedAt === undefined &&
    (box === "trash"
      ? message.senderDeletedAt !== undefined
      : message.senderDeletedAt === undefined);
  const requestedBoxVisible =
    box === "inbox"
      ? visibleAsRecipient
      : box === "sent"
        ? visibleAsSender
        : box === "trash"
          ? visibleAsRecipient || visibleAsSender
          : visibleAsRecipient || visibleAsSender;
  if (!requestedBoxVisible) {
    throw forumError(
      "PRIVATE_MESSAGE_NOT_FOUND",
      "That private message is not available.",
    );
  }
  return message;
}

function publicAuthorForumProfile(
  profile: ForumUserProfileDoc | undefined,
  author?: string,
  identity?: {
    username?: string;
    image?: string;
    joinedAt?: number;
  },
) {
  const customTitle = profile?.customTitle;
  const rank = "Forum Member";
  return {
    role: customTitle ?? rank,
    authorTitle: customTitle,
    authorRank: rank,
    authorPostCount: profile?.postCount ?? 0,
    authorReputationScore: profileReputationScore(profile),
    authorSignature:
      profile?.showSignatures === false ? undefined : profile?.signature,
    authorShowSignatures: profile?.showSignatures ?? true,
    authorDisplayName: author ?? UNKNOWN_AUTHOR,
    authorUsername: identity?.username,
    authorImage: profile?.avatarUrl ?? identity?.image,
    authorLocation: profile?.location,
    authorJoinedAt: identity?.joinedAt,
  };
}

function myForumProfileRecord(
  user: UserDoc,
  profile: ForumUserProfileDoc | null,
  warningSummary: { activeWarningCount: number; activeWarningPoints: number },
) {
  const postCount = profile?.postCount ?? 0;
  return {
    _id: profile?._id,
    userId: user._id,
    username: displayName(user),
    signature: profile?.signature ?? "",
    customTitle: profile?.customTitle ?? "",
    showSignatures: profile?.showSignatures ?? true,
    threadCount: profile?.threadCount ?? 0,
    postCount,
    reputationScore: profileReputationScore(profile),
    rank: forumRankForPostCount(postCount),
    trusted: isTrustedForumUser(user),
    activeWarningCount: warningSummary.activeWarningCount,
    activeWarningPoints: warningSummary.activeWarningPoints,
    avatarUrl: profile?.avatarUrl ?? user.image,
    authAvatarUrl: user.image,
    bio: profile?.bio ?? "",
    birthday: profile?.birthday ?? "",
    location: profile?.location ?? "",
    timeZone: profile?.timeZone ?? "",
    websiteUrl: profile?.websiteUrl ?? "",
    updatedAt: profile?.updatedAt,
  };
}

function myForumNotificationPreferencesRecord(
  user: UserDoc,
  preferences: ForumNotificationPreferencesDoc | null,
) {
  const settings = forumNotificationPreferenceSettings(preferences);
  const emailDestination = forumEmailDestination(user);
  return {
    _id: preferences?._id,
    userId: user._id,
    ...settings,
    emailDestinationAvailable: emailDestination !== null,
    emailDeliveryEnabled: env.FORUM_EMAIL_NOTIFICATIONS_ENABLED === "true",
    emailDestinationLabel:
      emailDestination === null
        ? undefined
        : forumEmailDestinationLabel(emailDestination),
    createdAt: preferences?.createdAt,
    updatedAt: preferences?.updatedAt,
  };
}

function publicForumRelationshipRecords(
  relationships: ForumUserRelationshipDoc[],
  usersById: Map<Id<"users">, UserDoc>,
  profilesByUserId: Map<Id<"users">, ForumUserProfileDoc>,
) {
  return relationships.flatMap((relationship) => {
    const targetUser = usersById.get(relationship.targetUserId);
    if (targetUser === undefined) {
      return [];
    }
    return [
      publicForumRelationshipRecord(
        relationship,
        targetUser,
        profilesByUserId.get(relationship.targetUserId),
      ),
    ];
  });
}

function publicForumRelationshipRecord(
  relationship: ForumUserRelationshipDoc,
  targetUser: UserDoc,
  profile?: ForumUserProfileDoc | null,
) {
  const postCount = profile?.postCount ?? 0;
  return {
    _id: relationship._id,
    _creationTime: relationship._creationTime,
    targetUserId: relationship.targetUserId,
    kind: relationship.kind,
    username: publicForumUsername(targetUser),
    displayName: displayName(targetUser),
    avatarUrl: profile?.avatarUrl ?? targetUser.image,
    customTitle: profile?.customTitle,
    rank: forumRankForPostCount(postCount),
    postCount,
    reputationScore: profileReputationScore(profile),
    createdAt: relationship.createdAt,
    updatedAt: relationship.updatedAt,
  };
}

function publicForumMemberRecord(
  user: UserDoc,
  profile: ForumUserProfileDoc | null,
  counts: { threadCount: number; postCount: number },
  presence?: ForumPresenceDoc | null,
) {
  return {
    _id: profile?._id ?? user._id,
    username: publicForumUsername(user),
    displayName: displayName(user),
    avatarUrl: profile?.avatarUrl ?? user.image,
    customTitle: profile?.customTitle,
    location: profile?.location,
    rank: forumRankForPostCount(counts.postCount),
    threadCount: counts.threadCount,
    postCount: counts.postCount,
    reputationScore: profileReputationScore(profile),
    joinedAt: user._creationTime,
    isOnline: presence !== undefined && presence !== null,
    lastSeenAt: presence?.lastSeenAt,
    onlineLocation: presence ? publicPresenceLocation(presence) : undefined,
  };
}

async function forumBoardStatistics(ctx: QueryCtx) {
  const [memberRows, topPosterProfiles, reputationProfiles] = await Promise.all(
    [
      ctx.db
        .query("users")
        .order("desc")
        .take(MEMBER_LIST_SCAN_LIMIT + 1),
      ctx.db
        .query("forumUserProfiles")
        .withIndex("by_postCount_and_updatedAt")
        .order("desc")
        .take(10),
      ctx.db
        .query("forumUserProfiles")
        .withIndex("by_reputationScore_and_updatedAt")
        .order("desc")
        .take(10),
    ],
  );
  const visibleMemberRows = memberRows.filter(
    (user) =>
      isTrustedForumUser(user) &&
      (user.usernameNormalized !== undefined || user.username !== undefined),
  );

  return {
    memberCount: Math.min(visibleMemberRows.length, MEMBER_LIST_SCAN_LIMIT),
    memberCountLimited: memberRows.length > MEMBER_LIST_SCAN_LIMIT,
    newestMember: await firstForumStatisticsUser(ctx, visibleMemberRows),
    topPoster: await firstForumStatisticsMember(ctx, topPosterProfiles),
    reputationLeader: await firstForumStatisticsMember(ctx, reputationProfiles),
  };
}

async function firstForumStatisticsUser(ctx: QueryCtx, users: UserDoc[]) {
  for (const user of users) {
    if (!isTrustedForumUser(user)) {
      continue;
    }
    const profile = await loadForumUserProfile(ctx, user._id);
    return publicForumStatisticsMemberRecord(user, profile);
  }
  return null;
}

async function firstForumStatisticsMember(
  ctx: QueryCtx,
  profiles: ForumUserProfileDoc[],
) {
  for (const profile of profiles) {
    const user = await ctx.db.get(profile.userId);
    if (user !== null && isTrustedForumUser(user)) {
      return publicForumStatisticsMemberRecord(user, profile);
    }
  }
  return null;
}

function publicForumStatisticsMemberRecord(
  user: UserDoc,
  profile: ForumUserProfileDoc | null,
) {
  const threadCount = profile?.threadCount ?? 0;
  const postCount = profile?.postCount ?? 0;
  return {
    userId: user._id,
    username: publicForumUsername(user),
    displayName: displayName(user),
    avatarUrl: profile?.avatarUrl ?? user.image,
    customTitle: profile?.customTitle,
    rank: forumRankForPostCount(postCount),
    threadCount,
    postCount,
    reputationScore: profileReputationScore(profile),
    joinedAt: user._creationTime,
  };
}

async function loadForumMemberProfilesForList(
  ctx: QueryCtx,
  sortKey: ForumMemberSortKey,
) {
  switch (sortKey) {
    case "threads-desc":
      return await ctx.db
        .query("forumUserProfiles")
        .withIndex("by_threadCount_and_updatedAt")
        .order("desc")
        .take(MEMBER_LIST_SCAN_LIMIT);
    case "reputation-desc":
      return await ctx.db
        .query("forumUserProfiles")
        .withIndex("by_reputationScore_and_updatedAt")
        .order("desc")
        .take(MEMBER_LIST_SCAN_LIMIT);
    case "joined-asc":
      return await ctx.db
        .query("forumUserProfiles")
        .withIndex("by_createdAt")
        .order("asc")
        .take(MEMBER_LIST_SCAN_LIMIT);
    case "joined-desc":
      return await ctx.db
        .query("forumUserProfiles")
        .withIndex("by_createdAt")
        .order("desc")
        .take(MEMBER_LIST_SCAN_LIMIT);
    case "name-asc":
    case "online-desc":
    case "posts-desc":
    default:
      return await ctx.db
        .query("forumUserProfiles")
        .withIndex("by_postCount_and_updatedAt")
        .order("desc")
        .take(MEMBER_LIST_SCAN_LIMIT);
  }
}

async function loadForumDirectoryUsers(ctx: QueryCtx) {
  const users = await ctx.db
    .query("users")
    .order("desc")
    .take(MEMBER_LIST_SCAN_LIMIT);
  return users.filter(
    (user) =>
      isTrustedForumUser(user) &&
      (user.usernameNormalized !== undefined || user.username !== undefined),
  );
}

type ForumMemberSortKey =
  | "posts-desc"
  | "threads-desc"
  | "reputation-desc"
  | "joined-desc"
  | "joined-asc"
  | "name-asc"
  | "online-desc";

type ForumMemberListRecord = ReturnType<typeof publicForumMemberRecord>;

function sortForumMemberRecords(
  members: ForumMemberListRecord[],
  sortKey: ForumMemberSortKey,
) {
  return [...members].sort((left, right) => {
    const nameComparison = compareForumMemberNames(left, right);
    switch (sortKey) {
      case "threads-desc":
        return right.threadCount - left.threadCount || nameComparison;
      case "reputation-desc":
        return right.reputationScore - left.reputationScore || nameComparison;
      case "joined-desc":
        return right.joinedAt - left.joinedAt || nameComparison;
      case "joined-asc":
        return left.joinedAt - right.joinedAt || nameComparison;
      case "name-asc":
        return nameComparison;
      case "online-desc":
        return (
          Number(right.isOnline) - Number(left.isOnline) ||
          (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0) ||
          nameComparison
        );
      case "posts-desc":
      default:
        return right.postCount - left.postCount || nameComparison;
    }
  });
}

function compareForumMemberNames(
  left: ForumMemberListRecord,
  right: ForumMemberListRecord,
) {
  return (left.displayName || left.username).localeCompare(
    right.displayName || right.username,
    "en",
    { numeric: true, sensitivity: "base" },
  );
}

function memberMatchesServerQuery(
  member: ForumMemberListRecord,
  normalizedQuery: string,
) {
  if (normalizedQuery.length === 0) {
    return true;
  }
  return [
    member.displayName,
    member.username,
    member.customTitle,
    member.location,
    member.rank,
    member.isOnline ? "online" : "offline",
    member.onlineLocation?.label,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery));
}

async function onlineForumSummary(ctx: QueryCtx, now: number, limit: number) {
  const presences = await ctx.db
    .query("forumPresence")
    .withIndex("by_lastSeenAt")
    .order("desc")
    .take(FORUM_PRESENCE_SCAN_LIMIT);
  const activePresences = presences.filter((presence) =>
    isActiveForumPresence(presence, now),
  );
  const activePresenceUsers = await Promise.all(
    activePresences.map(
      async (presence) =>
        [presence, await ctx.db.get(presence.userId)] as const,
    ),
  );
  const visiblePresenceUsers = activePresenceUsers.flatMap(
    ([presence, user]) =>
      user !== null && isTrustedForumUser(user)
        ? [[presence, user] as const]
        : [],
  );
  const displayPresenceUsers = visiblePresenceUsers.slice(0, limit);
  const profilesByUserId = await loadForumUserProfilesByUserIds(
    ctx,
    displayPresenceUsers.map(([presence]) => presence.userId),
  );

  return {
    activeSince: now - FORUM_PRESENCE_WINDOW_MS,
    registeredCount: visiblePresenceUsers.length,
    registeredCountLimited: presences.length >= FORUM_PRESENCE_SCAN_LIMIT,
    members: displayPresenceUsers.map(([presence, user]) =>
      publicForumPresenceMemberRecord(
        presence,
        user,
        profilesByUserId.get(presence.userId),
      ),
    ),
  };
}

async function loadActivePresenceByUserIds(
  ctx: QueryCtx | MutationCtx,
  userIds: Array<Id<"users">>,
  now: number,
) {
  const presences = await Promise.all(
    [...new Set(userIds)].map(async (userId) => {
      const [presence, user] = await Promise.all([
        ctx.db
          .query("forumPresence")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique(),
        ctx.db.get(userId),
      ]);
      return [
        userId,
        presence !== null &&
        user !== null &&
        isTrustedForumUser(user) &&
        isActiveForumPresence(presence, now)
          ? presence
          : null,
      ] as const;
    }),
  );
  return new Map(
    presences.flatMap(([userId, presence]) =>
      presence === null ? [] : [[userId, presence] as const],
    ),
  );
}

function publicForumPresenceMemberRecord(
  presence: ForumPresenceDoc,
  user: UserDoc,
  profile?: ForumUserProfileDoc,
) {
  const postCount = profile?.postCount ?? 0;
  return {
    userId: user._id,
    username: publicForumUsername(user),
    displayName: displayName(user),
    avatarUrl: profile?.avatarUrl ?? user.image,
    customTitle: profile?.customTitle,
    rank: forumRankForPostCount(postCount),
    postCount,
    reputationScore: profileReputationScore(profile),
    lastSeenAt: presence.lastSeenAt,
    location: publicPresenceLocation(presence),
  };
}

function publicPresenceLocation(presence: ForumPresenceDoc) {
  if (presence.locationType === "index") {
    return {
      type: "index",
      label: "Board index",
      href: "/forum",
    };
  }
  if (presence.locationType === "search") {
    return {
      type: "search",
      label: "Searching forums",
      href: "/forum/search",
    };
  }
  if (presence.locationType === "members") {
    return {
      type: "members",
      label: "Member directory",
      href: "/forum/members",
    };
  }
  if (presence.locationType === "online") {
    return {
      type: "online",
      label: "Who's online",
      href: "/forum/online",
    };
  }
  if (presence.locationType === "newPosts") {
    return {
      type: "newPosts",
      label: "Viewing new posts",
      href: "/forum/new-posts",
    };
  }
  if (presence.locationType === "help") {
    return {
      type: "help",
      label: "Reading help",
      href: "/forum/help",
    };
  }
  if (presence.locationType === "calendar") {
    return {
      type: "calendar",
      label: "Browsing calendar",
      href: "/forum/calendar",
    };
  }
  if (presence.locationType === "board") {
    return {
      type: "board",
      label: "Viewing board",
    };
  }
  if (presence.locationType === "thread") {
    return {
      type: "thread",
      label: "Reading thread",
    };
  }

  return {
    type: presence.locationType,
    label: "Forum tools",
  };
}

function isActiveForumPresence(presence: ForumPresenceDoc, now: number) {
  return now - presence.lastSeenAt <= FORUM_PRESENCE_WINDOW_MS;
}

function startOfCurrentDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function compareThreadsByLastPostAtDesc(
  left: ForumThreadDoc,
  right: ForumThreadDoc,
) {
  return right.lastPostAt - left.lastPostAt;
}

function publicForumUsername(user: UserDoc) {
  return (
    user.usernameNormalized ?? user.username ?? user.name ?? UNKNOWN_AUTHOR
  );
}

function forumRankForPostCount(postCount: number) {
  if (postCount >= 1_000) {
    return "Forum Elder";
  }
  if (postCount >= 250) {
    return "Senior Member";
  }
  if (postCount >= 50) {
    return "Full Member";
  }
  if (postCount >= 10) {
    return "Member";
  }
  return "New Member";
}

async function publicPollRecord(
  ctx: QueryCtx | MutationCtx,
  poll: ForumPollDoc,
  thread: ForumThreadDoc,
  viewerId: Id<"users"> | undefined,
  viewerCanVoteInCategory = viewerId !== undefined,
  viewerCanEdit = false,
) {
  const [options, viewerVote] = await Promise.all([
    ctx.db
      .query("forumPollOptions")
      .withIndex("by_pollId_and_position", (q) => q.eq("pollId", poll._id))
      .take(POLL_MAX_OPTIONS),
    viewerId === undefined ? null : loadPollVote(ctx, poll._id, viewerId),
  ]);
  const totalVotes = Math.max(0, poll.totalVotes);
  const viewerCanSeeResults = poll.status === "closed" || viewerVote !== null;
  const visibleTotalVotes = viewerCanSeeResults ? totalVotes : 0;

  return {
    _id: poll._id,
    _creationTime: poll._creationTime,
    threadId: poll.threadId,
    categoryId: poll.categoryId,
    question: poll.question,
    status: poll.status,
    optionCount: poll.optionCount,
    totalVotes: visibleTotalVotes,
    createdAt: poll.createdAt,
    updatedAt: poll.updatedAt,
    closedAt: poll.closedAt,
    viewerCanEdit,
    viewerOptionId: viewerVote?.optionId,
    viewerCanVote:
      viewerId !== undefined &&
      viewerCanVoteInCategory &&
      viewerVote === null &&
      poll.status === "open" &&
      thread.status === "active",
    options: options.map((option) => ({
      _id: option._id,
      label: option.label,
      position: option.position,
      voteCount: viewerCanSeeResults ? option.voteCount : 0,
      percent:
        !viewerCanSeeResults || totalVotes === 0
          ? 0
          : Math.round((option.voteCount / totalVotes) * 100),
    })),
  };
}

function adminPostRecord(post: ForumPostDoc, author?: string) {
  return {
    ...publicPostRecord(post, author),
    deletedAt: post.deletedAt,
    deletedBy: post.deletedBy,
    moderationReason: post.moderationReason,
  };
}

function adminReportRecord(
  report: ForumReportDoc,
  thread?: ForumThreadDoc,
  post?: ForumPostDoc,
  message?: ForumPrivateMessageDoc,
  category?: ForumCategoryDoc,
  reporter?: string,
  reviewer?: string,
  targetUsersById?: Map<Id<"users">, string>,
  warningSummariesByUserId?: Map<
    Id<"users">,
    { activeWarningCount: number; activeWarningPoints: number }
  >,
  options: { canViewPrivateMessageBodies: boolean } = {
    canViewPrivateMessageBodies: false,
  },
) {
  const targetUserId = reportTargetUserId(report, thread, post, message);
  const warningSummary =
    targetUserId === undefined
      ? undefined
      : warningSummariesByUserId?.get(targetUserId);
  const reportTitle =
    report.snapshotTitle ??
    thread?.title ??
    message?.subject ??
    (report.entityType === "privateMessage"
      ? "Private message"
      : "Forum report");
  const canShowSnapshotBody =
    report.entityType !== "privateMessage" ||
    options.canViewPrivateMessageBodies;
  const visibleSnapshotBody = canShowSnapshotBody
    ? report.snapshotBody
    : undefined;
  const visibleBodyForExcerpt = canShowSnapshotBody
    ? (report.snapshotBody ??
      (post === undefined ? (thread?.body ?? message?.body ?? "") : post.body))
    : "Private message report body hidden from moderator view.";
  return {
    _id: report._id,
    _creationTime: report._creationTime,
    reporterId: report.reporterId,
    reporter: reporter ?? UNKNOWN_AUTHOR,
    entityType: report.entityType,
    threadId: report.threadId,
    threadSlug: thread?.slug,
    threadTitle: reportTitle,
    threadPrefix:
      report.snapshotPrefixLabel === undefined
        ? thread === undefined
          ? null
          : publicThreadPrefixRecordFromThread(thread)
        : {
            slug: report.snapshotPrefixSlug ?? "snapshot",
            label: report.snapshotPrefixLabel,
            color: report.snapshotPrefixColor,
          },
    postId: report.postId,
    messageId: report.messageId,
    targetUserId,
    targetUser:
      targetUserId === undefined
        ? undefined
        : targetUsersById?.get(targetUserId),
    targetActiveWarningCount: warningSummary?.activeWarningCount ?? 0,
    targetActiveWarningPoints: warningSummary?.activeWarningPoints ?? 0,
    postNumber: post?.postNumber,
    postPage:
      post?.postNumber === undefined
        ? undefined
        : pageForPostNumber(post.postNumber, POST_PAGE_SIZE),
    categoryId: report.categoryId,
    categorySlug: category?.slug,
    categoryName: category?.name,
    reason: report.reason,
    details: report.details,
    status: report.status,
    excerpt: excerpt(visibleBodyForExcerpt, 220),
    snapshotTitle: report.snapshotTitle,
    snapshotPrefixSlug: report.snapshotPrefixSlug,
    snapshotPrefixLabel: report.snapshotPrefixLabel,
    snapshotPrefixColor: report.snapshotPrefixColor,
    snapshotBody: visibleSnapshotBody,
    snapshotAuthor: report.snapshotAuthorName,
    snapshotPostNumber: report.snapshotPostNumber,
    snapshotCreatedAt: report.snapshotCreatedAt,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    reviewedAt: report.reviewedAt,
    reviewedBy: report.reviewedBy,
    reviewer,
    moderationNote: report.moderationNote,
  };
}

function adminWarningRecord(
  warning: ForumWarningDoc,
  targetUser?: string,
  actor?: string,
  revokedBy?: string,
  category?: ForumCategoryDoc,
  thread?: ForumThreadDoc,
  post?: ForumPostDoc,
  report?: ForumReportDoc,
) {
  const postNumber = post?.postNumber;
  return {
    _id: warning._id,
    _creationTime: warning._creationTime,
    targetUserId: warning.targetUserId,
    targetUser: targetUser ?? UNKNOWN_AUTHOR,
    actorUserId: warning.actorUserId,
    actor: actor ?? UNKNOWN_AUTHOR,
    status: warning.status,
    points: warning.points,
    reason: warning.reason,
    moderationNote: warning.moderationNote,
    categoryId: warning.categoryId,
    categorySlug: category?.slug,
    categoryName: category?.name,
    threadId: warning.threadId,
    threadSlug: thread?.slug,
    threadTitle: thread?.title,
    postId: warning.postId,
    postNumber,
    postPage:
      postNumber === undefined
        ? undefined
        : pageForPostNumber(postNumber, POST_PAGE_SIZE),
    reportId: warning.reportId,
    reportStatus: report?.status,
    expiresAt: warning.expiresAt,
    revokedAt: warning.revokedAt,
    revokedBy: warning.revokedBy,
    revokedByName: revokedBy,
    createdAt: warning.createdAt,
    updatedAt: warning.updatedAt,
  };
}

function forumModerationEventRecord(
  event: ForumModerationEventDoc,
  actor?: string,
  category?: ForumCategoryDoc,
  thread?: ForumThreadDoc,
) {
  return {
    _id: event._id,
    _creationTime: event._creationTime,
    actorUserId: event.actorUserId,
    actor: actor ?? UNKNOWN_AUTHOR,
    entityType: event.entityType,
    entityId: event.entityId,
    eventType: event.eventType,
    message: event.message,
    categoryId: event.categoryId,
    categorySlug: category?.slug,
    categoryName: category?.name,
    threadId: event.threadId,
    threadSlug: thread?.slug,
    threadTitle: thread?.title,
    postId: event.postId,
    reportId: event.reportId,
    warningId: event.warningId,
    pollId: event.pollId,
    metadataJson: event.metadataJson,
    createdAt: event.createdAt,
  };
}

type ThreadListSortKey =
  | "lastPostAt"
  | "createdAt"
  | "replies"
  | "views"
  | "rating"
  | "title";
type ThreadListSortOrder = "desc" | "asc";

function normalizeThreadListDays(days: number | undefined) {
  if (days === undefined || !Number.isFinite(days)) {
    return undefined;
  }
  const normalized = Math.floor(days);
  if (normalized <= 0) {
    return undefined;
  }
  return Math.min(normalized, THREAD_LIST_MAX_DAYS);
}

function filterThreadListByDays(
  threads: ForumThreadDoc[],
  days: number | undefined,
) {
  if (days === undefined) {
    return threads;
  }
  const threshold = Date.now() - days * THREAD_LIST_DAY_MS;
  return threads.filter((thread) => thread.lastPostAt >= threshold);
}

function sortThreadListRecords(
  threads: ForumThreadDoc[],
  sortKey: ThreadListSortKey,
  sortOrder: ThreadListSortOrder,
) {
  return [...threads].sort((left, right) =>
    compareThreadListRecords(left, right, sortKey, sortOrder),
  );
}

function compareThreadListRecords(
  left: ForumThreadDoc,
  right: ForumThreadDoc,
  sortKey: ThreadListSortKey,
  sortOrder: ThreadListSortOrder,
) {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }
  const comparison = compareThreadListSortValue(left, right, sortKey);
  if (comparison !== 0) {
    return sortOrder === "asc" ? comparison : -comparison;
  }
  return (
    right.lastPostAt - left.lastPostAt ||
    left.title.localeCompare(right.title) ||
    String(left._id).localeCompare(String(right._id))
  );
}

function compareThreadListSortValue(
  left: ForumThreadDoc,
  right: ForumThreadDoc,
  sortKey: ThreadListSortKey,
) {
  switch (sortKey) {
    case "createdAt":
      return left.createdAt - right.createdAt;
    case "replies":
      return left.replyCount - right.replyCount;
    case "views":
      return left.viewCount - right.viewCount;
    case "rating": {
      const leftRating = threadRatingAverage(left);
      const rightRating = threadRatingAverage(right);
      return (
        leftRating - rightRating ||
        (left.ratingCount ?? 0) - (right.ratingCount ?? 0)
      );
    }
    case "title":
      return left.title.localeCompare(right.title);
    case "lastPostAt":
    default:
      return left.lastPostAt - right.lastPostAt;
  }
}

type ThreadListPrefixFilter =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "prefix"; prefixId: Id<"forumThreadPrefixes"> };

async function resolveThreadListPrefixFilter(
  ctx: QueryCtx,
  category: ForumCategoryDoc,
  prefixId: Id<"forumThreadPrefixes"> | null | undefined,
): Promise<ThreadListPrefixFilter> {
  if (prefixId === undefined) {
    return { kind: "all" };
  }
  if (prefixId === null) {
    return { kind: "none" };
  }
  const prefix = await ctx.db.get(prefixId);
  if (prefix === null || prefix.categoryId !== category._id) {
    throw forumError(
      "THREAD_PREFIX_NOT_FOUND",
      "That thread prefix is not available for this board.",
    );
  }
  return { kind: "prefix", prefixId: prefix._id };
}

async function loadThreadListBucket(
  ctx: QueryCtx,
  categoryId: Id<"forumCategories">,
  prefixFilter: ThreadListPrefixFilter,
  status: "active" | "locked",
  pinned: boolean,
  limit: number,
) {
  if (prefixFilter.kind === "all") {
    return await ctx.db
      .query("forumThreads")
      .withIndex("by_categoryId_and_status_and_pinned_and_lastPostAt", (q) =>
        q
          .eq("categoryId", categoryId)
          .eq("status", status)
          .eq("pinned", pinned),
      )
      .order("desc")
      .take(limit);
  }

  return await ctx.db
    .query("forumThreads")
    .withIndex(
      "by_categoryId_and_prefixId_and_status_and_pinned_and_lastPostAt",
      (q) =>
        q
          .eq("categoryId", categoryId)
          .eq(
            "prefixId",
            prefixFilter.kind === "none" ? undefined : prefixFilter.prefixId,
          )
          .eq("status", status)
          .eq("pinned", pinned),
    )
    .order("desc")
    .take(limit);
}

function buildThreadSearchText(
  category: ForumCategoryDoc,
  title: string,
  body: string,
  author: string,
) {
  return [title, body, category.name, category.slug, author].join("\n");
}

function excerpt(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

function forumHelpDocumentExcerpt(body: string) {
  return (
    excerpt(
      body
        .replace(/\[quote(?:=[^\]]+)?\]([\s\S]*?)\[\/quote\]/gi, "$1")
        .replace(/\[code\]([\s\S]*?)\[\/code\]/gi, "$1")
        .replace(/\[list\]([\s\S]*?)\[\/list\]/gi, "$1")
        .replace(/\[\*\]/g, " ")
        .replace(/\[url(?:=[^\]]+)?\]([\s\S]*?)\[\/url\]/gi, "$1")
        .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, " ")
        .replace(/\[([bius])\]([\s\S]*?)\[\/\1\]/gi, "$2"),
      FORUM_HELP_DOCUMENT_EXCERPT_MAX_LENGTH,
    ) || "No text preview available."
  );
}

function forumCalendarEventExcerpt(body: string) {
  return (
    excerpt(
      body
        .replace(/\[quote(?:=[^\]]+)?\]([\s\S]*?)\[\/quote\]/gi, "$1")
        .replace(/\[code\]([\s\S]*?)\[\/code\]/gi, "$1")
        .replace(/\[list\]([\s\S]*?)\[\/list\]/gi, "$1")
        .replace(/\[\*\]/g, " ")
        .replace(/\[url(?:=[^\]]+)?\]([\s\S]*?)\[\/url\]/gi, "$1")
        .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, " ")
        .replace(/\[([bius])\]([\s\S]*?)\[\/\1\]/gi, "$2"),
      FORUM_CALENDAR_EVENT_EXCERPT_MAX_LENGTH,
    ) || "No text preview available."
  );
}

type ForumSearchTarget = "all" | "titles" | "bodies";
type ForumSearchSortKey =
  | "relevance"
  | "newest"
  | "oldest"
  | "replies"
  | "views";
type SearchThreadOptions = {
  days?: number;
  sortKey: ForumSearchSortKey;
  target?: ForumSearchTarget;
};
type SearchPostOptions = {
  days?: number;
  sortKey: ForumSearchSortKey;
  target?: ForumSearchTarget;
};

function normalizeSearchDays(days: number | undefined) {
  if (days === undefined || !Number.isFinite(days)) {
    return undefined;
  }
  const normalized = Math.floor(days);
  if (normalized <= 0) {
    return undefined;
  }
  return Math.min(normalized, THREAD_LIST_MAX_DAYS);
}

function searchSinceTimestamp(days: number | undefined) {
  return days === undefined
    ? undefined
    : Date.now() - days * THREAD_LIST_DAY_MS;
}

function applySearchThreadOptions(
  threads: ForumThreadDoc[],
  query: string | null,
  options: SearchThreadOptions,
) {
  const since = searchSinceTimestamp(options.days);
  const normalizedQuery = query?.toLowerCase() ?? null;
  const target = options.target ?? "all";
  const filtered = threads.filter((thread) => {
    if (since !== undefined && thread.lastPostAt < since) {
      return false;
    }
    if (normalizedQuery === null || target === "all") {
      return true;
    }
    const searchableText = target === "titles" ? thread.title : thread.body;
    return searchableText.toLowerCase().includes(normalizedQuery);
  });
  if (options.sortKey === "relevance") {
    return filtered;
  }
  return filtered.sort((left, right) =>
    compareSearchThreads(left, right, options.sortKey),
  );
}

function applySearchPostOptions(
  hits: Array<{ post: ForumPostDoc; thread: ForumThreadDoc }>,
  query: string | null,
  options: SearchPostOptions,
) {
  const since = searchSinceTimestamp(options.days);
  const normalizedQuery = query?.toLowerCase() ?? null;
  const target = options.target ?? "all";
  const filtered = hits.filter(({ post }) => {
    if (since !== undefined && post.createdAt < since) {
      return false;
    }
    if (target === "titles") {
      return false;
    }
    return (
      normalizedQuery === null ||
      target === "all" ||
      post.body.toLowerCase().includes(normalizedQuery)
    );
  });
  if (options.sortKey === "relevance") {
    return filtered;
  }
  return filtered.sort((left, right) =>
    compareSearchPosts(left, right, options.sortKey),
  );
}

function compareSearchThreads(
  left: ForumThreadDoc,
  right: ForumThreadDoc,
  sortKey: ForumSearchSortKey,
) {
  switch (sortKey) {
    case "oldest":
      return left.lastPostAt - right.lastPostAt;
    case "replies":
      return (
        right.replyCount - left.replyCount || right.lastPostAt - left.lastPostAt
      );
    case "views":
      return (
        right.viewCount - left.viewCount || right.lastPostAt - left.lastPostAt
      );
    case "newest":
    case "relevance":
    default:
      return right.lastPostAt - left.lastPostAt;
  }
}

function compareSearchPosts(
  left: { post: ForumPostDoc; thread: ForumThreadDoc },
  right: { post: ForumPostDoc; thread: ForumThreadDoc },
  sortKey: ForumSearchSortKey,
) {
  switch (sortKey) {
    case "oldest":
      return left.post.createdAt - right.post.createdAt;
    case "replies":
      return (
        right.thread.replyCount - left.thread.replyCount ||
        right.post.createdAt - left.post.createdAt
      );
    case "views":
      return (
        right.thread.viewCount - left.thread.viewCount ||
        right.post.createdAt - left.post.createdAt
      );
    case "newest":
    case "relevance":
    default:
      return right.post.createdAt - left.post.createdAt;
  }
}

async function searchVisibleThreads(
  ctx: QueryCtx,
  searchQuery: string,
  limit: number,
  category: ForumCategoryDoc | null,
  user: UserDoc | null,
  authorId?: Id<"users">,
  options: SearchThreadOptions = { sortKey: "relevance" },
) {
  const activeFetchLimit =
    category === null ? searchVisibilityFetchLimit(limit) : limit;
  const activeRaw = category
    ? await ctx.db
        .query("forumThreads")
        .withSearchIndex("search_by_searchText", (q) => {
          const search = q
            .search("searchText", searchQuery)
            .eq("status", "active")
            .eq("categorySlug", category.slug);
          return authorId === undefined
            ? search
            : search.eq("authorId", authorId);
        })
        .take(activeFetchLimit)
    : await ctx.db
        .query("forumThreads")
        .withSearchIndex("search_by_searchText", (q) => {
          const search = q
            .search("searchText", searchQuery)
            .eq("status", "active");
          return authorId === undefined
            ? search
            : search.eq("authorId", authorId);
        })
        .take(activeFetchLimit);

  const active = await filterThreadsForPublicCategory(
    ctx,
    activeRaw,
    category,
    user,
  );
  const remainingLimit = Math.max(1, limit - active.length);
  const lockedFetchLimit =
    category === null
      ? searchVisibilityFetchLimit(remainingLimit)
      : remainingLimit;
  const lockedRaw = category
    ? await ctx.db
        .query("forumThreads")
        .withSearchIndex("search_by_searchText", (q) => {
          const search = q
            .search("searchText", searchQuery)
            .eq("status", "locked")
            .eq("categorySlug", category.slug);
          return authorId === undefined
            ? search
            : search.eq("authorId", authorId);
        })
        .take(lockedFetchLimit)
    : await ctx.db
        .query("forumThreads")
        .withSearchIndex("search_by_searchText", (q) => {
          const search = q
            .search("searchText", searchQuery)
            .eq("status", "locked");
          return authorId === undefined
            ? search
            : search.eq("authorId", authorId);
        })
        .take(lockedFetchLimit);

  const locked = await filterThreadsForPublicCategory(
    ctx,
    lockedRaw,
    category,
    user,
  );
  const items = applySearchThreadOptions(
    [...active, ...locked],
    searchQuery,
    options,
  ).slice(0, limit);
  return {
    items,
    limited:
      category === null &&
      ((activeRaw.length >= activeFetchLimit && active.length < limit) ||
        (lockedRaw.length >= lockedFetchLimit && items.length < limit)),
  };
}

async function searchVisibleThreadsByAuthor(
  ctx: QueryCtx,
  limit: number,
  category: ForumCategoryDoc | null,
  user: UserDoc | null,
  authorId: Id<"users">,
  options: SearchThreadOptions = { sortKey: "relevance" },
) {
  const fetchLimit =
    category === null
      ? searchVisibilityFetchLimit(limit)
      : Math.min(limit * 3, SEARCH_VISIBILITY_SCAN_LIMIT);
  const [activeRaw, lockedRaw] = await Promise.all([
    ctx.db
      .query("forumThreads")
      .withIndex("by_authorId_and_status_and_createdAt", (q) =>
        q.eq("authorId", authorId).eq("status", "active"),
      )
      .order("desc")
      .take(fetchLimit),
    ctx.db
      .query("forumThreads")
      .withIndex("by_authorId_and_status_and_createdAt", (q) =>
        q.eq("authorId", authorId).eq("status", "locked"),
      )
      .order("desc")
      .take(fetchLimit),
  ]);
  const rawThreads = [...activeRaw, ...lockedRaw]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, fetchLimit);
  const categoryThreads =
    category === null
      ? rawThreads
      : rawThreads.filter((thread) => thread.categoryId === category._id);
  const visibleThreads = await filterThreadsForPublicCategory(
    ctx,
    categoryThreads,
    category,
    user,
  );

  return {
    items: applySearchThreadOptions(visibleThreads, null, options).slice(
      0,
      limit,
    ),
    limited: rawThreads.length >= fetchLimit && visibleThreads.length < limit,
  };
}

async function searchVisiblePosts(
  ctx: QueryCtx,
  searchQuery: string,
  limit: number,
  category: ForumCategoryDoc | null,
  user: UserDoc | null,
  authorId?: Id<"users">,
  options: SearchPostOptions = { sortKey: "relevance" },
) {
  const postFetchLimit =
    category === null
      ? searchVisibilityFetchLimit(limit)
      : Math.min(limit * 2, SEARCH_VISIBILITY_SCAN_LIMIT);
  const postHits = category
    ? await ctx.db
        .query("forumPosts")
        .withSearchIndex("search_by_body", (q) => {
          const search = q
            .search("body", searchQuery)
            .eq("status", "active")
            .eq("categoryId", category._id);
          return authorId === undefined
            ? search
            : search.eq("authorId", authorId);
        })
        .take(postFetchLimit)
    : await ctx.db
        .query("forumPosts")
        .withSearchIndex("search_by_body", (q) => {
          const search = q.search("body", searchQuery).eq("status", "active");
          return authorId === undefined
            ? search
            : search.eq("authorId", authorId);
        })
        .take(postFetchLimit);

  const results: Array<{ post: ForumPostDoc; thread: ForumThreadDoc }> = [];
  for (const post of postHits) {
    const thread = await ctx.db.get(post.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      continue;
    }
    const threadCategory = category ?? (await ctx.db.get(thread.categoryId));
    if (
      threadCategory === null ||
      !(await canViewCategoryWithAncestors(ctx, user, threadCategory))
    ) {
      continue;
    }
    if (category !== null && thread.categoryId !== category._id) {
      continue;
    }
    results.push({ post, thread });
    if (results.length >= limit) {
      break;
    }
  }
  return {
    items: applySearchPostOptions(results, searchQuery, options).slice(
      0,
      limit,
    ),
    limited: postHits.length >= postFetchLimit && results.length < limit,
  };
}

async function searchVisiblePostsByAuthor(
  ctx: QueryCtx,
  limit: number,
  category: ForumCategoryDoc | null,
  user: UserDoc | null,
  authorId: Id<"users">,
  options: SearchPostOptions = { sortKey: "relevance" },
) {
  const postFetchLimit =
    category === null
      ? searchVisibilityFetchLimit(limit)
      : Math.min(limit * 3, SEARCH_VISIBILITY_SCAN_LIMIT);
  const postHits = await ctx.db
    .query("forumPosts")
    .withIndex("by_authorId_and_status_and_createdAt", (q) =>
      q.eq("authorId", authorId).eq("status", "active"),
    )
    .order("desc")
    .take(postFetchLimit);

  const results: Array<{ post: ForumPostDoc; thread: ForumThreadDoc }> = [];
  for (const post of postHits) {
    const thread = await ctx.db.get(post.threadId);
    if (thread === null || !isVisibleThreadStatus(thread.status)) {
      continue;
    }
    if (category !== null && thread.categoryId !== category._id) {
      continue;
    }
    const threadCategory = category ?? (await ctx.db.get(thread.categoryId));
    if (
      threadCategory === null ||
      !(await canViewCategoryWithAncestors(ctx, user, threadCategory))
    ) {
      continue;
    }
    results.push({ post, thread });
    if (results.length >= limit) {
      break;
    }
  }

  return {
    items: applySearchPostOptions(results, null, options).slice(0, limit),
    limited: postHits.length >= postFetchLimit && results.length < limit,
  };
}

async function recomputeThreadActivity(
  ctx: MutationCtx,
  threadId: Id<"forumThreads">,
) {
  const thread = await ctx.db.get(threadId);
  if (thread === null) {
    return;
  }

  const latestPost = await ctx.db
    .query("forumPosts")
    .withIndex("by_threadId_and_status_and_createdAt", (q) =>
      q.eq("threadId", threadId).eq("status", "active"),
    )
    .order("desc")
    .take(1);

  const newestReply = latestPost[0];
  await ctx.db.patch(threadId, {
    lastPostId: newestReply?._id,
    lastPostAt: newestReply?.createdAt ?? thread.createdAt,
    lastPostUserId: newestReply?.authorId ?? thread.authorId,
    updatedAt: Date.now(),
  });
}

function sortedForumPostsForAppend(posts: ForumPostDoc[]) {
  return [...posts].sort(
    (left, right) =>
      (left.postNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.postNumber ?? Number.MAX_SAFE_INTEGER) ||
      left.createdAt - right.createdAt,
  );
}

function splitThreadBodyFromPost(post: ForumPostDoc) {
  const body = post.body.trim();
  if (body.length === 0) {
    throw forumError(
      "INVALID_INPUT",
      "The promoted reply needs text before it can become a thread.",
    );
  }
  return body;
}

async function activeRepliesForThreadMove(
  ctx: MutationCtx,
  threadId: Id<"forumThreads">,
  limit: number,
) {
  const replies = await ctx.db
    .query("forumPosts")
    .withIndex("by_threadId_and_status_and_postNumber", (q) =>
      q.eq("threadId", threadId).eq("status", "active"),
    )
    .order("asc")
    .take(limit);
  return sortedForumPostsForAppend(replies);
}

async function movePromotedPostAttachmentsToThread(
  ctx: MutationCtx,
  args: {
    postId: Id<"forumPosts">;
    targetThreadId: Id<"forumThreads">;
    targetCategoryId: Id<"forumCategories">;
    now: number;
  },
) {
  const [
    activeAttachments,
    deletedAttachments,
    notificationEmails,
    moderationEvents,
  ] = await Promise.all([
    ctx.db
      .query("forumAttachments")
      .withIndex("by_postId_and_status_and_createdAt", (q) =>
        q.eq("postId", args.postId).eq("status", "active"),
      )
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumAttachments")
      .withIndex("by_postId_and_status_and_createdAt", (q) =>
        q.eq("postId", args.postId).eq("status", "deleted"),
      )
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumNotificationEmailDeliveries")
      .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
        q.eq("postId", args.postId),
      )
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumModerationEvents")
      .withIndex("by_postId_and_createdAt", (q) => q.eq("postId", args.postId))
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
  ]);

  for (const attachment of [...activeAttachments, ...deletedAttachments]) {
    await ctx.db.patch(attachment._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
      postId: undefined,
      updatedAt: args.now,
    });
  }
  for (const delivery of notificationEmails) {
    await ctx.db.patch(delivery._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
      postId: undefined,
      updatedAt: args.now,
    });
  }
  for (const event of moderationEvents) {
    await ctx.db.patch(event._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
      postId: undefined,
    });
  }
}

async function moveThreadRootRecordsToPost(
  ctx: MutationCtx,
  args: {
    sourceThreadId: Id<"forumThreads">;
    targetThreadId: Id<"forumThreads">;
    targetCategoryId: Id<"forumCategories">;
    targetPostId: Id<"forumPosts">;
    now: number;
  },
) {
  const [
    activeAttachments,
    deletedAttachments,
    contentEdits,
    notificationEmails,
    moderationEvents,
  ] = await Promise.all([
    ctx.db
      .query("forumAttachments")
      .withIndex("by_threadId_and_postId_and_status_and_createdAt", (q) =>
        q
          .eq("threadId", args.sourceThreadId)
          .eq("postId", undefined)
          .eq("status", "active"),
      )
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumAttachments")
      .withIndex("by_threadId_and_postId_and_status_and_createdAt", (q) =>
        q
          .eq("threadId", args.sourceThreadId)
          .eq("postId", undefined)
          .eq("status", "deleted"),
      )
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumContentEdits")
      .withIndex("by_threadId_and_createdAt", (q) =>
        q.eq("threadId", args.sourceThreadId),
      )
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumNotificationEmailDeliveries")
      .withIndex("by_threadId_and_recipientUserId_and_type", (q) =>
        q.eq("threadId", args.sourceThreadId),
      )
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumModerationEvents")
      .withIndex("by_threadId_and_createdAt", (q) =>
        q.eq("threadId", args.sourceThreadId),
      )
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
  ]);

  for (const attachment of [...activeAttachments, ...deletedAttachments]) {
    await ctx.db.patch(attachment._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
      postId: args.targetPostId,
      updatedAt: args.now,
    });
  }
  for (const edit of contentEdits) {
    if (edit.entityType !== "thread" || edit.postId !== undefined) {
      continue;
    }
    await ctx.db.patch(edit._id, {
      entityType: "post",
      threadId: args.targetThreadId,
      postId: args.targetPostId,
    });
  }
  for (const delivery of notificationEmails) {
    if (delivery.postId !== undefined) {
      continue;
    }
    await ctx.db.patch(delivery._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
      postId: args.targetPostId,
      updatedAt: args.now,
    });
  }
  for (const event of moderationEvents) {
    if (event.postId !== undefined) {
      continue;
    }
    await ctx.db.patch(event._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
      postId: args.targetPostId,
    });
  }
}

async function movePostRelatedRecords(
  ctx: MutationCtx,
  args: {
    postId: Id<"forumPosts">;
    targetThreadId: Id<"forumThreads">;
    targetCategoryId: Id<"forumCategories">;
    now: number;
  },
) {
  const [
    activeAttachments,
    deletedAttachments,
    edits,
    reports,
    warnings,
    reputations,
    notifications,
    notificationEmails,
    moderationEvents,
  ] = await Promise.all([
    ctx.db
      .query("forumAttachments")
      .withIndex("by_postId_and_status_and_createdAt", (q) =>
        q.eq("postId", args.postId).eq("status", "active"),
      )
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumAttachments")
      .withIndex("by_postId_and_status_and_createdAt", (q) =>
        q.eq("postId", args.postId).eq("status", "deleted"),
      )
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumContentEdits")
      .withIndex("by_postId_and_createdAt", (q) => q.eq("postId", args.postId))
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumReports")
      .withIndex("by_postId_and_createdAt", (q) => q.eq("postId", args.postId))
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumWarnings")
      .withIndex("by_postId_and_createdAt", (q) => q.eq("postId", args.postId))
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumReputations")
      .withIndex("by_postId_and_createdAt", (q) => q.eq("postId", args.postId))
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumNotifications")
      .withIndex("by_postId_and_createdAt", (q) => q.eq("postId", args.postId))
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumNotificationEmailDeliveries")
      .withIndex("by_postId_and_recipientUserId_and_type", (q) =>
        q.eq("postId", args.postId),
      )
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
    ctx.db
      .query("forumModerationEvents")
      .withIndex("by_postId_and_createdAt", (q) => q.eq("postId", args.postId))
      .take(POST_MOVE_RELATED_RECORD_BATCH_LIMIT),
  ]);

  for (const attachment of [...activeAttachments, ...deletedAttachments]) {
    await ctx.db.patch(attachment._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
      updatedAt: args.now,
    });
  }
  for (const edit of edits) {
    await ctx.db.patch(edit._id, {
      threadId: args.targetThreadId,
    });
  }
  for (const report of reports) {
    await ctx.db.patch(report._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
      updatedAt: args.now,
    });
  }
  for (const warning of warnings) {
    await ctx.db.patch(warning._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
      updatedAt: args.now,
    });
  }
  for (const reputation of reputations) {
    await ctx.db.patch(reputation._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
      updatedAt: args.now,
    });
  }
  for (const notification of notifications) {
    await ctx.db.patch(notification._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
      updatedAt: args.now,
    });
  }
  for (const delivery of notificationEmails) {
    await ctx.db.patch(delivery._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
      updatedAt: args.now,
    });
  }
  for (const event of moderationEvents) {
    await ctx.db.patch(event._id, {
      threadId: args.targetThreadId,
      categoryId: args.targetCategoryId,
    });
  }
}

async function maybePromoteCategorySummary(
  ctx: MutationCtx,
  categoryId: Id<"forumCategories">,
  threadId: Id<"forumThreads">,
) {
  const [category, thread] = await Promise.all([
    ctx.db.get(categoryId),
    ctx.db.get(threadId),
  ]);
  if (
    category === null ||
    thread === null ||
    !isVisibleThreadStatus(thread.status)
  ) {
    return;
  }

  if ((category.lastPostAt ?? 0) <= thread.lastPostAt) {
    await ctx.db.patch(categoryId, {
      lastThreadId: thread._id,
      lastPostId: thread.lastPostId,
      lastPostAt: thread.lastPostAt,
      updatedAt: Date.now(),
    });
  }
}

async function recomputeCategorySummary(
  ctx: MutationCtx,
  categoryId: Id<"forumCategories">,
) {
  const category = await ctx.db.get(categoryId);
  if (category === null) {
    return;
  }

  const candidates = (
    await Promise.all([
      ctx.db
        .query("forumThreads")
        .withIndex("by_categoryId_and_status_and_pinned_and_lastPostAt", (q) =>
          q
            .eq("categoryId", categoryId)
            .eq("status", "active")
            .eq("pinned", true),
        )
        .order("desc")
        .take(1),
      ctx.db
        .query("forumThreads")
        .withIndex("by_categoryId_and_status_and_pinned_and_lastPostAt", (q) =>
          q
            .eq("categoryId", categoryId)
            .eq("status", "active")
            .eq("pinned", false),
        )
        .order("desc")
        .take(1),
      ctx.db
        .query("forumThreads")
        .withIndex("by_categoryId_and_status_and_pinned_and_lastPostAt", (q) =>
          q
            .eq("categoryId", categoryId)
            .eq("status", "locked")
            .eq("pinned", true),
        )
        .order("desc")
        .take(1),
      ctx.db
        .query("forumThreads")
        .withIndex("by_categoryId_and_status_and_pinned_and_lastPostAt", (q) =>
          q
            .eq("categoryId", categoryId)
            .eq("status", "locked")
            .eq("pinned", false),
        )
        .order("desc")
        .take(1),
    ])
  )
    .flatMap((rows) => rows)
    .sort((left, right) => right.lastPostAt - left.lastPostAt);

  const latestThread = candidates[0];

  await ctx.db.patch(categoryId, {
    lastThreadId: latestThread?._id,
    lastPostId: latestThread?.lastPostId,
    lastPostAt: latestThread?.lastPostAt,
    updatedAt: Date.now(),
  });
}

async function bumpCategoryModerationActivity(
  ctx: MutationCtx,
  categoryId: Id<"forumCategories">,
  now: number,
) {
  const category = await ctx.db.get(categoryId);
  if (category === null) {
    return;
  }
  await ctx.db.patch(categoryId, {
    moderationActivityAt: Math.max(category.moderationActivityAt ?? 0, now),
    updatedAt: now,
  });
}

async function recordModerationLog(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    entityType: ForumModerationEntityType;
    entityId: string;
    eventType: ForumModerationEventType;
    message: string;
    fingerprint?: string;
    categoryId?: Id<"forumCategories">;
    threadId?: Id<"forumThreads">;
    postId?: Id<"forumPosts">;
    reportId?: Id<"forumReports">;
    warningId?: Id<"forumWarnings">;
    pollId?: Id<"forumPolls">;
    metadata: Record<string, unknown>;
  },
) {
  const now = Date.now();
  const metadataJson = JSON.stringify(args.metadata);
  await ctx.db.insert("forumModerationEvents", {
    actorUserId: args.actorUserId,
    entityType: args.entityType,
    entityId: args.entityId,
    eventType: args.eventType,
    message: args.message,
    categoryId: args.categoryId,
    threadId: args.threadId,
    postId: args.postId,
    reportId: args.reportId,
    warningId: args.warningId,
    pollId: args.pollId,
    metadataJson,
    createdAt: now,
  });

  const fingerprint =
    args.fingerprint ?? `${args.eventType}:${args.entityType}:${args.entityId}`;
  const existing = await ctx.db
    .query("systemLogs")
    .withIndex("by_fingerprint_and_createdAt", (q) =>
      q.eq("fingerprint", fingerprint),
    )
    .order("desc")
    .take(1);
  if (existing[0] !== undefined) {
    await ctx.db.patch(existing[0]._id, {
      updatedAt: now,
      lastSeenAt: now,
      occurrences: existing[0].occurrences + 1,
      actorUserId: args.actorUserId,
      metadataJson,
    });
    return;
  }

  await ctx.db.insert("systemLogs", {
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    occurrences: 1,
    level: "info",
    status: "open",
    source: "convex",
    scope: "forum",
    eventType: args.eventType,
    message: args.message,
    fingerprint,
    actorUserId: args.actorUserId,
    entityType: args.entityType,
    entityId: args.entityId,
    metadataJson,
  });
}

async function filterThreadsForPublicCategory(
  ctx: QueryCtx,
  threads: ForumThreadDoc[],
  category: ForumCategoryDoc | null,
  user: UserDoc | null,
) {
  if (category !== null) {
    return isBoardCategory(category) &&
      (await canViewCategoryWithAncestors(ctx, user, category))
      ? threads
      : [];
  }

  const categoriesById = await loadCategoriesById(
    ctx,
    threads.map((thread) => thread.categoryId),
  );
  const categoryVisibility = new Map(
    await Promise.all(
      Array.from(categoriesById.values()).map(
        async (threadCategory) =>
          [
            threadCategory._id,
            isBoardCategory(threadCategory) &&
              (await canViewCategoryWithAncestors(ctx, user, threadCategory)),
          ] as const,
      ),
    ),
  );
  return threads.filter((thread) => {
    return categoryVisibility.get(thread.categoryId) === true;
  });
}

function forumError(code: string, message: string) {
  return new ConvexError({ code, message });
}
