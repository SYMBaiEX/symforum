import { makeFunctionReference } from "convex/server";

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
  imageUrl?: string;
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
  name?: string;
  email?: string;
  username?: string;
  usernameNormalized?: string;
  role?: "owner" | "reader";
  contactEmail?: string;
};

export type ViewerUserRecord = {
  _id: string;
  _creationTime: number;
  name?: string;
  email?: string;
  username?: string;
  usernameNormalized?: string;
  usernameSource?: "auto" | "chosen";
  role?: "owner" | "reader";
  contactEmail?: string;
  bio?: string;
  onboardedAt?: number;
};

export type PublicProfileCommentRecord = {
  _id: string;
  entityType: "post" | "hnStory";
  entityId: string;
  body: string;
  createdAt: number;
};

export type PublicProfileRecord = {
  user: {
    _creationTime: number;
    username: string;
    usernameNormalized: string;
    bio?: string;
    role?: "owner" | "reader";
    usernameSource?: "auto" | "chosen";
    onboardedAt?: number;
  };
  isCurrentUser: boolean;
  recentComments: PublicProfileCommentRecord[];
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
  entityType: "post" | "hnStory";
  entityId: string;
  parentId?: string;
  body: string;
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

export type NewsletterSubscriberRecord = {
  _id: string;
  _creationTime: number;
  email: string;
  status: "pending" | "confirmed" | "unsubscribed" | "bounced";
  source: string;
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
  status: "draft" | "scheduled" | "sent" | "cancelled" | "failed";
  linkedPostSlug?: string;
  scheduledAt?: number;
  sentAt?: number;
  resendBroadcastId?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
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

export const convexRefs = {
  admin: {
    viewer: makeFunctionReference<
      "query",
      Record<string, never>,
      {
        user: AdminUserRecord | null;
        isOwner: boolean;
        ownerExists: boolean;
      }
    >("admin:viewer"),
    overview: makeFunctionReference<
      "query",
      Record<string, never>,
      {
        user: AdminUserRecord;
        totals: {
          posts: number;
          publishedPosts: number;
          commentsSample: number;
          interactionsSample: number;
        };
        recentComments: AdminCommentRecord[];
        recentInteractions: AdminInteractionRecord[];
      }
    >("admin:overview"),
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
          imageUrl?: string;
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
    deleteComment: makeFunctionReference<
      "mutation",
      { commentId: string },
      { deleted: boolean }
    >("admin:deleteComment"),
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
  },
  comments: {
    list: makeFunctionReference<
      "query",
      { entityType: "post" | "hnStory"; entityId: string },
      Array<{
        _id: string;
        userId: string;
        entityType: "post" | "hnStory";
        entityId: string;
        parentId?: string;
        body: string;
        createdAt: number;
        author: string;
      }>
    >("comments:list"),
    add: makeFunctionReference<
      "mutation",
      {
        entityType: "post" | "hnStory";
        entityId: string;
        body: string;
        parentId?: string;
      },
      null
    >("comments:add"),
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
