import { makeFunctionReference } from "convex/server";
import type { ForumThreadSummaryRecord } from "./forum-refs";

export type ForumFeedThread = ForumThreadSummaryRecord & {
  _id: string;
  categorySlug: string;
  categoryName: string;
  excerpt: string;
  source: "community" | "editorial";
  authorIdentity: {
    username: string;
    name: string;
    avatarUrl?: string;
    isAgent: boolean;
  };
};
export type ForumFeedPage = {
  page: ForumFeedThread[];
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: "SplitRecommended" | "SplitRequired" | null;
};
export type ForumNewsSnapshot = {
  snapshotDate: string;
  status: "running" | "complete" | "failed";
  storyCount: number;
  startedAt: number;
  completedAt?: number;
};
export type ForumNewsStory = {
  hnItemId: number;
  title: string;
  rank: number;
  url?: string;
  host?: string;
  by?: string;
  hnScore?: number;
  hnCommentCount?: number;
  timePosted?: number;
  fetchedAt: number;
  discussionUrl: string;
  platformStats: { score: number; saves: number; comments: number } | null;
  platformStatsStatus: "available" | "unavailable";
};
export type ForumNewsFeed = {
  snapshots: ForumNewsSnapshot[];
  snapshot: ForumNewsSnapshot | null;
  stories: ForumNewsStory[];
  limited?: boolean;
};
export const forumFeedRefs = {
  authorizationFingerprint: makeFunctionReference<
    "query",
    Record<string, never>,
    { fingerprint: string }
  >("forum:feedAuthorizationFingerprint"),
  listFeedThreads: makeFunctionReference<
    "query",
    {
      sort?: "new" | "active";
      communityOnly?: boolean;
      paginationOpts: { numItems: number; cursor: string | null };
    },
    ForumFeedPage
  >("forum:listFeedThreads"),
  listNewsFeed: makeFunctionReference<
    "query",
    { snapshotDate?: string; limit?: number },
    ForumNewsFeed
  >("forum:listNewsFeed"),
};
