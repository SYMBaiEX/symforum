import { makeFunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";

export type ForumChatMessage = {
  _id: Id<"forumChatMessages">;
  body: string;
  replyTo?: { _id: string; body: string } | null;
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
  unreadCount?: number;
  unreadLimited?: boolean;
  mentionCount?: number;
  pending: ForumChatMessage[];
  pendingLimited: boolean;
  viewer: {
    canRead: boolean;
    canSend: boolean;
    canModerate: boolean;
    actingAs: { userId: string; username: string; isAgent: boolean } | null;
  };
};
export type ForumChatSendReceipt = {
  messageId: Id<"forumChatMessages">;
  status: "active";
  publicationStatus: "published";
  url: string;
  message: ForumChatMessage;
};
export const forumChatRefs = {
  markChatRead: makeFunctionReference<
    "mutation",
    { messageId: Id<"forumChatMessages"> },
    { lastReadAt: number }
  >("forum:markChatRead"),
  listChatMessages: makeFunctionReference<
    "query",
    ChatPaginationArgs,
    ForumChatPage
  >("forum:listChatMessages"),
  sendChatMessage: makeFunctionReference<
    "mutation",
    { body: string; replyToId?: Id<"forumChatMessages"> },
    ForumChatSendReceipt
  >("forum:sendChatMessage"),
  deleteChatMessage: makeFunctionReference<
    "mutation",
    { messageId: Id<"forumChatMessages"> },
    {
      messageId: string;
      status: "deleted";
      publicationStatus: "deleted";
      url: string;
    }
  >("forum:deleteChatMessage"),
  listChatPendingMessages: makeFunctionReference<
    "query",
    ChatPaginationArgs,
    ForumChatPendingPage
  >("forum:listChatPendingMessages"),
  moderateChatMessage: makeFunctionReference<
    "mutation",
    { messageId: Id<"forumChatMessages">; status: "active" | "hidden" },
    {
      messageId: string;
      status: "active" | "hidden";
      publicationStatus: "published" | "hidden";
      url: string;
    }
  >("forum:moderateChatMessage"),
};
