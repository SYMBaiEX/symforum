/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as adminApi from "../adminApi.js";
import type * as analytics from "../analytics.js";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as belleForumAgent from "../belleForumAgent.js";
import type * as comments from "../comments.js";
import type * as contact from "../contact.js";
import type * as contactEmails from "../contactEmails.js";
import type * as contentAccess from "../contentAccess.js";
import type * as crons from "../crons.js";
import type * as dailyNewsletter from "../dailyNewsletter.js";
import type * as forum from "../forum.js";
import type * as forumAgentEditorial from "../forumAgentEditorial.js";
import type * as forumAgentEditorialData from "../forumAgentEditorialData.js";
import type * as forumAgentMemory from "../forumAgentMemory.js";
import type * as forumAgentRoster from "../forumAgentRoster.js";
import type * as forumAgentStyleEntropy from "../forumAgentStyleEntropy.js";
import type * as forumAgentVoices from "../forumAgentVoices.js";
import type * as forumAgentWorkflow from "../forumAgentWorkflow.js";
import type * as forumLimits from "../forumLimits.js";
import type * as forumNotificationEmails from "../forumNotificationEmails.js";
import type * as githubPortfolio from "../githubPortfolio.js";
import type * as http from "../http.js";
import type * as interactions from "../interactions.js";
import type * as modelRouting from "../modelRouting.js";
import type * as news from "../news.js";
import type * as newsletter from "../newsletter.js";
import type * as newsletterAgent from "../newsletterAgent.js";
import type * as newsletterEmails from "../newsletterEmails.js";
import type * as newsletterModel from "../newsletterModel.js";
import type * as newsletterPayload from "../newsletterPayload.js";
import type * as postModel from "../postModel.js";
import type * as posts from "../posts.js";
import type * as resendClient from "../resendClient.js";
import type * as rosterForumAgent from "../rosterForumAgent.js";
import type * as siteContent from "../siteContent.js";
import type * as siteContentModel from "../siteContentModel.js";
import type * as sukiForumAgent from "../sukiForumAgent.js";
import type * as sukiForumAgentData from "../sukiForumAgentData.js";
import type * as sukiForumReplyAgent from "../sukiForumReplyAgent.js";
import type * as systemLogs from "../systemLogs.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  adminApi: typeof adminApi;
  analytics: typeof analytics;
  auth: typeof auth;
  authz: typeof authz;
  belleForumAgent: typeof belleForumAgent;
  comments: typeof comments;
  contact: typeof contact;
  contactEmails: typeof contactEmails;
  contentAccess: typeof contentAccess;
  crons: typeof crons;
  dailyNewsletter: typeof dailyNewsletter;
  forum: typeof forum;
  forumAgentEditorial: typeof forumAgentEditorial;
  forumAgentEditorialData: typeof forumAgentEditorialData;
  forumAgentMemory: typeof forumAgentMemory;
  forumAgentRoster: typeof forumAgentRoster;
  forumAgentStyleEntropy: typeof forumAgentStyleEntropy;
  forumAgentVoices: typeof forumAgentVoices;
  forumAgentWorkflow: typeof forumAgentWorkflow;
  forumLimits: typeof forumLimits;
  forumNotificationEmails: typeof forumNotificationEmails;
  githubPortfolio: typeof githubPortfolio;
  http: typeof http;
  interactions: typeof interactions;
  modelRouting: typeof modelRouting;
  news: typeof news;
  newsletter: typeof newsletter;
  newsletterAgent: typeof newsletterAgent;
  newsletterEmails: typeof newsletterEmails;
  newsletterModel: typeof newsletterModel;
  newsletterPayload: typeof newsletterPayload;
  postModel: typeof postModel;
  posts: typeof posts;
  resendClient: typeof resendClient;
  rosterForumAgent: typeof rosterForumAgent;
  siteContent: typeof siteContent;
  siteContentModel: typeof siteContentModel;
  sukiForumAgent: typeof sukiForumAgent;
  sukiForumAgentData: typeof sukiForumAgentData;
  sukiForumReplyAgent: typeof sukiForumReplyAgent;
  systemLogs: typeof systemLogs;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  rag: import("@convex-dev/rag/_generated/component.js").ComponentApi<"rag">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
