import { makeFunctionReference } from "convex/server";
import type {
  ForumThreadRecord,
  MyPendingForumContentRecord,
  ForumCategoryRecord,
  ForumRelationshipRecord,
} from "@/lib/convex-refs";
import type { ForumAuthorFilter, ForumFeedScope } from "@/lib/forum-experience";

export type ForumExperience = {
  defaultFeed: ForumFeedScope;
  authorFilter: ForumAuthorFilter;
  mutedWords: string[];
  mutedUntil?: number;
  onboardingCompleted: boolean;
  followingBoards: ForumCategoryRecord[];
  followingMembers: ForumRelationshipRecord[];
};
export const forumExperienceRefs = {
  event: makeFunctionReference<
    "mutation",
    { event: "feed_open" | "composer_open" | "pending_open" },
    unknown
  >("forum:recordForumExperienceEvent"),
  metrics: makeFunctionReference<
    "query",
    { sinceDay: string },
    {
      rows: {
        dayKey: string;
        actorKind: string;
        event: string;
        count: number;
      }[];
      limited: boolean;
    }
  >("forum:getForumExperienceMetrics"),
  get: makeFunctionReference<"query", Record<string, never>, ForumExperience>(
    "forum:getMyForumExperience",
  ),
  update: makeFunctionReference<
    "mutation",
    Partial<
      Pick<
        ForumExperience,
        "defaultFeed" | "authorFilter" | "mutedWords" | "onboardingCompleted"
      >
    > & { mutedUntil?: number | null },
    unknown
  >("forum:updateMyForumExperience"),
  catchUp: makeFunctionReference<
    "query",
    { limit?: number },
    {
      threads: ForumThreadRecord[];
      saved: ForumThreadRecord[];
      pending: MyPendingForumContentRecord;
      summary: { unread: number; saved: number; pending: number };
      bounded: true;
    }
  >("forum:listMyForumCatchUp"),
  accept: makeFunctionReference<
    "mutation",
    { threadId: string; postId: string | null },
    unknown
  >("forum:setAcceptedAnswer"),
  followBoard: makeFunctionReference<
    "mutation",
    { categorySlug: string; subscribed: boolean },
    unknown
  >("forum:setCategorySubscription"),
  news: makeFunctionReference<
    "query",
    { hnItemId: number },
    {
      story: {
        hnItemId: number;
        title: string;
        url?: string;
        host?: string;
        hnScore?: number;
        hnCommentCount?: number;
      };
      discussion: null | {
        threadId: string;
        categorySlug: string;
        threadSlug: string;
        title: string;
        status: string;
        replyCount: number;
        url: string;
      };
    }
  >("forum:getNewsDiscussion"),
  discussNews: makeFunctionReference<
    "mutation",
    { hnItemId: number; categorySlug: string; body: string },
    {
      categorySlug: string;
      threadSlug: string;
      status: string;
      existing: boolean;
    }
  >("forum:createNewsDiscussion"),
  promoteChat: makeFunctionReference<
    "mutation",
    { categorySlug: string; title: string; messageIds: string[] },
    { categorySlug: string; threadSlug: string; status: string }
  >("forum:createThreadFromChat"),
};
