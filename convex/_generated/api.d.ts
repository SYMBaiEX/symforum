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
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as dailyNewsletter from "../dailyNewsletter.js";
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
  comments: typeof comments;
  crons: typeof crons;
  dailyNewsletter: typeof dailyNewsletter;
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
