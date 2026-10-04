import type { ForumPluginCapability } from "./forum-plugin-contract";

const PUBLIC_READ = new Set([
  "listPublicAgents", "getMemberProfile", "getNewsInteractions",
  "listCategories",
  "listCategoryOptions",
  "listThreadPrefixes",
  "listAnnouncements",
  "getAnnouncement",
  "listHelpDocuments",
  "getHelpDocument",
  "listCalendarEvents",
  "getCalendarEvent",
  "overview",
  "listThreads",
  "listResearchFeedThreads",
  "listRecentThreads",
  "listFeedThreads",
  "listNewsFeed",
  "getNewsDiscussion",
  "listChatMessages",
  "getThread",
  "search",
  "listMembers",
  "listOnlineMembers",
  "onlineSummary",
]);
const STAFF = new Set([
  "adminOverview",
  "listChatPendingMessages",
  "moderateChatMessage",
  "listForumThreads",
  "listForumPosts",
  "getForumThread",
  "listForumContentEdits",
  "listForumReports",
  "listForumModerationEvents",
  "listForumWarnings",
  "issueForumWarning",
  "updateForumWarningStatus",
  "updateForumReportStatus",
  "updateForumPollStatus",
  "moveForumThread",
  "moveForumPosts",
  "splitForumPosts",
  "mergeForumThread",
  "updateForumThreadModeration",
  "updateForumPostModeration",
]);
const ADMIN = new Set([
  "upsertForumCategory",
  "reorderForumCategories",
  "assignCategoryModerator",
  "removeCategoryModerator",
]);
const ACCOUNTS = new Set([
  "listUsers",
  "updateUserForumRole",
  "updateUserForumTrust",
  "updateUserForumStatus",
]);
const FEEDBACK = new Set([
  "votePoll",
  "rateThread",
  "setForumReputation",
  "createReport",
  "createPrivateMessageReport",
]);
const ATTACHMENTS = new Set([
  "authorizeForumAttachmentUpload",
  "claimStoredForumAttachmentUpload",
  "uploadAttachments",
]);
const PERSONAL = new Set([
  "getMyForumExperience",
  "updateMyForumExperience",
  "listMyForumCatchUp",
  "recordPresence",
  "recordForumExperienceEvent",
  "markChatRead",
  "markNotificationRead",
  "recordThreadView",
  "markThreadRead",
  "markCategoryRead",
  "markAllForumsRead",
  "setThreadSubscription",
  "setCategorySubscription",
  "setThreadBookmark",
  "updateForumRelationship",
  "updateMyForumProfile",
  "updateMyForumNotificationPreferences",
]);
export function forumOperationPublicRead(operation: string) {
  return PUBLIC_READ.has(operation);
}
export function forumOperationCapability(
  operation: string,
): ForumPluginCapability {
  if (operation === "setNewsInteraction") return "feedback";
  if (ATTACHMENTS.has(operation)) return "attachments";
  if (ACCOUNTS.has(operation)) return "accounts";
  if (STAFF.has(operation)) return "moderate";
  if (ADMIN.has(operation) || operation.endsWith("Admin")) return "administer";
  if (FEEDBACK.has(operation)) return "feedback";
  if (operation.includes("PrivateMessage")) return "messages";
  if (PERSONAL.has(operation) || operation.includes("My")) return "personal";
  return PUBLIC_READ.has(operation) || operation === "status"
    ? "read"
    : "participate";
}
