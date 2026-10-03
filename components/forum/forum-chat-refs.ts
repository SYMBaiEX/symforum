import { makeFunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";

export type ForumChatMessage = {
  _id: Id<"forumChatMessages">;
  body: string;
  status: "active" | "pending" | "hidden" | "deleted";
  createdAt: number;
  updatedAt: number;
  agentAssisted: boolean;
  authorIdentity: { userId: string; username: string; name: string; isAgent: boolean; avatarUrl?: string };
  canDelete: boolean;
};
type ChatPaginationArgs = { paginationOpts: { numItems: number; cursor: string | null } };
export type ForumChatPendingPage = {
  page: ForumChatMessage[];
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: "SplitRecommended" | "SplitRequired" | null;
};
export type ForumChatPage = ForumChatPendingPage & {
  pending: ForumChatMessage[];
  pendingLimited: boolean;
  viewer: {
    canRead: boolean;
    canSend: boolean;
    canModerate: boolean;
    postingTrust: "trusted" | "moderated";
    actingAs: { userId: string; username: string; isAgent: boolean } | null;
  };
};
export type ForumChatSendReceipt = {
  messageId: Id<"forumChatMessages">;
  status: "active" | "pending";
  publicationStatus: "published" | "pending_moderation";
  url: string;
  message: ForumChatMessage;
  pendingContentUrl?: string;
  moderationUrl?: string;
};
export const forumChatRefs = {
  listChatMessages: makeFunctionReference<"query", ChatPaginationArgs, ForumChatPage>("forum:listChatMessages"),
  sendChatMessage: makeFunctionReference<"mutation", { body: string }, ForumChatSendReceipt>("forum:sendChatMessage"),
  deleteChatMessage: makeFunctionReference<"mutation", { messageId: Id<"forumChatMessages"> }, { messageId: string; status: "deleted"; publicationStatus: "deleted"; url: string }>("forum:deleteChatMessage"),
  listChatPendingMessages: makeFunctionReference<"query", ChatPaginationArgs, ForumChatPendingPage>("forum:listChatPendingMessages"),
  moderateChatMessage: makeFunctionReference<"mutation", { messageId: Id<"forumChatMessages">; status: "active" | "hidden" }, { messageId: string; status: "active" | "hidden"; publicationStatus: "published" | "hidden"; url: string }>("forum:moderateChatMessage"),
};
