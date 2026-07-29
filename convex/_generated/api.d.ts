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
import type * as forumNotificationEmails from "../forumNotificationEmails.js";
import type * as githubPortfolio from "../githubPortfolio.js";
import type * as http from "../http.js";
import type * as interactions from "../interactions.js";
import type * as news from "../news.js";
import type * as newsletter from "../newsletter.js";
import type * as newsletterEmails from "../newsletterEmails.js";
import type * as newsletterModel from "../newsletterModel.js";
import type * as postModel from "../postModel.js";
import type * as posts from "../posts.js";
import type * as resendClient from "../resendClient.js";
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
  forumNotificationEmails: typeof forumNotificationEmails;
  githubPortfolio: typeof githubPortfolio;
  http: typeof http;
  interactions: typeof interactions;
  news: typeof news;
  newsletter: typeof newsletter;
  newsletterEmails: typeof newsletterEmails;
  newsletterModel: typeof newsletterModel;
  postModel: typeof postModel;
  posts: typeof posts;
  resendClient: typeof resendClient;
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
};
