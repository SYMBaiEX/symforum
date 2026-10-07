/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountEmailVerification from "../accountEmailVerification.js";
import type * as admin from "../admin.js";
import type * as adminAiBudget from "../adminAiBudget.js";
import type * as adminApi from "../adminApi.js";
import type * as agentDataApi from "../agentDataApi.js";
import type * as agentDataHttpErrors from "../agentDataHttpErrors.js";
import type * as agentIdentity from "../agentIdentity.js";
import type * as agentIdentityCrypto from "../agentIdentityCrypto.js";
import type * as agentOAuth from "../agentOAuth.js";
import type * as agentOAuthConnect from "../agentOAuthConnect.js";
import type * as agentOAuthPrincipal from "../agentOAuthPrincipal.js";
import type * as agentQuota from "../agentQuota.js";
import type * as agentSemanticApi from "../agentSemanticApi.js";
import type * as agentServiceAuth from "../agentServiceAuth.js";
import type * as agentServiceAuthHttp from "../agentServiceAuthHttp.js";
import type * as agentServiceAuthPrincipal from "../agentServiceAuthPrincipal.js";
import type * as agentServiceAuthSchema from "../agentServiceAuthSchema.js";
import type * as agentServiceAuthTokens from "../agentServiceAuthTokens.js";
import type * as aiRoutingControlData from "../aiRoutingControlData.js";
import type * as aiTelemetry from "../aiTelemetry.js";
import type * as aiTelemetryHelpers from "../aiTelemetryHelpers.js";
import type * as analytics from "../analytics.js";
import type * as apiCommerce from "../apiCommerce.js";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as belleForumAgent from "../belleForumAgent.js";
import type * as comments from "../comments.js";
import type * as contact from "../contact.js";
import type * as contactEmails from "../contactEmails.js";
import type * as contentAccess from "../contentAccess.js";
import type * as contentAggregates from "../contentAggregates.js";
import type * as cronWatchdog from "../cronWatchdog.js";
import type * as crons from "../crons.js";
import type * as dailyNewsletter from "../dailyNewsletter.js";
import type * as evidence from "../evidence.js";
import type * as evidenceAdmin from "../evidenceAdmin.js";
import type * as evidenceBenchmarks from "../evidenceBenchmarks.js";
import type * as evidenceDocumentExportDigest from "../evidenceDocumentExportDigest.js";
import type * as evidenceFirstParty from "../evidenceFirstParty.js";
import type * as evidenceHealth from "../evidenceHealth.js";
import type * as evidenceIngestion from "../evidenceIngestion.js";
import type * as evidenceJobActions from "../evidenceJobActions.js";
import type * as evidenceJobWorkflows from "../evidenceJobWorkflows.js";
import type * as evidenceJobs from "../evidenceJobs.js";
import type * as evidenceNvd from "../evidenceNvd.js";
import type * as evidencePublicationEpoch from "../evidencePublicationEpoch.js";
import type * as evidenceSourceAdapter from "../evidenceSourceAdapter.js";
import type * as evidenceSourceRegistry from "../evidenceSourceRegistry.js";
import type * as evidenceVersionExportDigest from "../evidenceVersionExportDigest.js";
import type * as evidenceVisibility from "../evidenceVisibility.js";
import type * as evidenceWatchlists from "../evidenceWatchlists.js";
import type * as evidenceWebhookActions from "../evidenceWebhookActions.js";
import type * as evidenceWebhooks from "../evidenceWebhooks.js";
import type * as forum from "../forum.js";
import type * as forumAgentClaimProvenance from "../forumAgentClaimProvenance.js";
import type * as forumAgentEditorial from "../forumAgentEditorial.js";
import type * as forumAgentEditorialData from "../forumAgentEditorialData.js";
import type * as forumAgentEditorialPolicy from "../forumAgentEditorialPolicy.js";
import type * as forumAgentMaintenance from "../forumAgentMaintenance.js";
import type * as forumAgentMaintenanceData from "../forumAgentMaintenanceData.js";
import type * as forumAgentMemory from "../forumAgentMemory.js";
import type * as forumAgentMemoryData from "../forumAgentMemoryData.js";
import type * as forumAgentMemoryQueue from "../forumAgentMemoryQueue.js";
import type * as forumAgentResearchPackets from "../forumAgentResearchPackets.js";
import type * as forumAgentRoster from "../forumAgentRoster.js";
import type * as forumAgentStyleEntropy from "../forumAgentStyleEntropy.js";
import type * as forumAgentVoices from "../forumAgentVoices.js";
import type * as forumAgentWorkflow from "../forumAgentWorkflow.js";
import type * as forumChat from "../forumChat.js";
import type * as forumCommunityQuality from "../forumCommunityQuality.js";
import type * as forumExperienceMetrics from "../forumExperienceMetrics.js";
import type * as forumLimits from "../forumLimits.js";
import type * as forumNotificationEmails from "../forumNotificationEmails.js";
import type * as forumOperationDefinitions from "../forumOperationDefinitions.js";
import type * as forumPlugin from "../forumPlugin.js";
import type * as forumPluginAccess from "../forumPluginAccess.js";
import type * as forumPluginContext from "../forumPluginContext.js";
import type * as forumPluginHttp from "../forumPluginHttp.js";
import type * as forumPluginOAuth from "../forumPluginOAuth.js";
import type * as forumPluginPrincipal from "../forumPluginPrincipal.js";
import type * as forumPluginSchema from "../forumPluginSchema.js";
import type * as forumPluginToken from "../forumPluginToken.js";
import type * as forumPluginUiOperations from "../forumPluginUiOperations.js";
import type * as forumPluginValidation from "../forumPluginValidation.js";
import type * as forumPresenceComponent from "../forumPresenceComponent.js";
import type * as forumPrivateConversations from "../forumPrivateConversations.js";
import type * as forumReadQuotaRefund from "../forumReadQuotaRefund.js";
import type * as forumSearchProjection from "../forumSearchProjection.js";
import type * as forumSearchProjectionConstants from "../forumSearchProjectionConstants.js";
import type * as forumThreadDigest from "../forumThreadDigest.js";
import type * as forumThreadDigestBackfill from "../forumThreadDigestBackfill.js";
import type * as githubPortfolio from "../githubPortfolio.js";
import type * as http from "../http.js";
import type * as interactions from "../interactions.js";
import type * as migrations from "../migrations.js";
import type * as modelRouting from "../modelRouting.js";
import type * as news from "../news.js";
import type * as newsDigestTypes from "../newsDigestTypes.js";
import type * as newsletter from "../newsletter.js";
import type * as newsletterAgent from "../newsletterAgent.js";
import type * as newsletterDigests from "../newsletterDigests.js";
import type * as newsletterEmails from "../newsletterEmails.js";
import type * as newsletterMetrics from "../newsletterMetrics.js";
import type * as newsletterModel from "../newsletterModel.js";
import type * as newsletterPayload from "../newsletterPayload.js";
import type * as newsletterSettings from "../newsletterSettings.js";
import type * as nyxForumAgent from "../nyxForumAgent.js";
import type * as nyxProfile from "../nyxProfile.js";
import type * as operationalSlo from "../operationalSlo.js";
import type * as organizations from "../organizations.js";
import type * as postDigests from "../postDigests.js";
import type * as postModel from "../postModel.js";
import type * as posts from "../posts.js";
import type * as presence from "../presence.js";
import type * as ragEmbeddings from "../ragEmbeddings.js";
import type * as researchQuality from "../researchQuality.js";
import type * as researchQualityAssessmentVisibilityDigest from "../researchQualityAssessmentVisibilityDigest.js";
import type * as resendClient from "../resendClient.js";
import type * as rosterForumAgent from "../rosterForumAgent.js";
import type * as semanticSearch from "../semanticSearch.js";
import type * as semanticSearchIndexWorkflow from "../semanticSearchIndexWorkflow.js";
import type * as siteContent from "../siteContent.js";
import type * as siteContentModel from "../siteContentModel.js";
import type * as sukiForumAgent from "../sukiForumAgent.js";
import type * as sukiForumAgentData from "../sukiForumAgentData.js";
import type * as sukiForumReplyAgent from "../sukiForumReplyAgent.js";
import type * as systemLogs from "../systemLogs.js";
import type * as universalSearch from "../universalSearch.js";
import type * as universalSearchProjection from "../universalSearchProjection.js";
import type * as users from "../users.js";
import type * as webVitals from "../webVitals.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountEmailVerification: typeof accountEmailVerification;
  admin: typeof admin;
  adminAiBudget: typeof adminAiBudget;
  adminApi: typeof adminApi;
  agentDataApi: typeof agentDataApi;
  agentDataHttpErrors: typeof agentDataHttpErrors;
  agentIdentity: typeof agentIdentity;
  agentIdentityCrypto: typeof agentIdentityCrypto;
  agentOAuth: typeof agentOAuth;
  agentOAuthConnect: typeof agentOAuthConnect;
  agentOAuthPrincipal: typeof agentOAuthPrincipal;
  agentQuota: typeof agentQuota;
  agentSemanticApi: typeof agentSemanticApi;
  agentServiceAuth: typeof agentServiceAuth;
  agentServiceAuthHttp: typeof agentServiceAuthHttp;
  agentServiceAuthPrincipal: typeof agentServiceAuthPrincipal;
  agentServiceAuthSchema: typeof agentServiceAuthSchema;
  agentServiceAuthTokens: typeof agentServiceAuthTokens;
  aiRoutingControlData: typeof aiRoutingControlData;
  aiTelemetry: typeof aiTelemetry;
  aiTelemetryHelpers: typeof aiTelemetryHelpers;
  analytics: typeof analytics;
  apiCommerce: typeof apiCommerce;
  auth: typeof auth;
  authz: typeof authz;
  belleForumAgent: typeof belleForumAgent;
  comments: typeof comments;
  contact: typeof contact;
  contactEmails: typeof contactEmails;
  contentAccess: typeof contentAccess;
  contentAggregates: typeof contentAggregates;
  cronWatchdog: typeof cronWatchdog;
  crons: typeof crons;
  dailyNewsletter: typeof dailyNewsletter;
  evidence: typeof evidence;
  evidenceAdmin: typeof evidenceAdmin;
  evidenceBenchmarks: typeof evidenceBenchmarks;
  evidenceDocumentExportDigest: typeof evidenceDocumentExportDigest;
  evidenceFirstParty: typeof evidenceFirstParty;
  evidenceHealth: typeof evidenceHealth;
  evidenceIngestion: typeof evidenceIngestion;
  evidenceJobActions: typeof evidenceJobActions;
  evidenceJobWorkflows: typeof evidenceJobWorkflows;
  evidenceJobs: typeof evidenceJobs;
  evidenceNvd: typeof evidenceNvd;
  evidencePublicationEpoch: typeof evidencePublicationEpoch;
  evidenceSourceAdapter: typeof evidenceSourceAdapter;
  evidenceSourceRegistry: typeof evidenceSourceRegistry;
  evidenceVersionExportDigest: typeof evidenceVersionExportDigest;
  evidenceVisibility: typeof evidenceVisibility;
  evidenceWatchlists: typeof evidenceWatchlists;
  evidenceWebhookActions: typeof evidenceWebhookActions;
  evidenceWebhooks: typeof evidenceWebhooks;
  forum: typeof forum;
  forumAgentClaimProvenance: typeof forumAgentClaimProvenance;
  forumAgentEditorial: typeof forumAgentEditorial;
  forumAgentEditorialData: typeof forumAgentEditorialData;
  forumAgentEditorialPolicy: typeof forumAgentEditorialPolicy;
  forumAgentMaintenance: typeof forumAgentMaintenance;
  forumAgentMaintenanceData: typeof forumAgentMaintenanceData;
  forumAgentMemory: typeof forumAgentMemory;
  forumAgentMemoryData: typeof forumAgentMemoryData;
  forumAgentMemoryQueue: typeof forumAgentMemoryQueue;
  forumAgentResearchPackets: typeof forumAgentResearchPackets;
  forumAgentRoster: typeof forumAgentRoster;
  forumAgentStyleEntropy: typeof forumAgentStyleEntropy;
  forumAgentVoices: typeof forumAgentVoices;
  forumAgentWorkflow: typeof forumAgentWorkflow;
  forumChat: typeof forumChat;
  forumCommunityQuality: typeof forumCommunityQuality;
  forumExperienceMetrics: typeof forumExperienceMetrics;
  forumLimits: typeof forumLimits;
  forumNotificationEmails: typeof forumNotificationEmails;
  forumOperationDefinitions: typeof forumOperationDefinitions;
  forumPlugin: typeof forumPlugin;
  forumPluginAccess: typeof forumPluginAccess;
  forumPluginContext: typeof forumPluginContext;
  forumPluginHttp: typeof forumPluginHttp;
  forumPluginOAuth: typeof forumPluginOAuth;
  forumPluginPrincipal: typeof forumPluginPrincipal;
  forumPluginSchema: typeof forumPluginSchema;
  forumPluginToken: typeof forumPluginToken;
  forumPluginUiOperations: typeof forumPluginUiOperations;
  forumPluginValidation: typeof forumPluginValidation;
  forumPresenceComponent: typeof forumPresenceComponent;
  forumPrivateConversations: typeof forumPrivateConversations;
  forumReadQuotaRefund: typeof forumReadQuotaRefund;
  forumSearchProjection: typeof forumSearchProjection;
  forumSearchProjectionConstants: typeof forumSearchProjectionConstants;
  forumThreadDigest: typeof forumThreadDigest;
  forumThreadDigestBackfill: typeof forumThreadDigestBackfill;
  githubPortfolio: typeof githubPortfolio;
  http: typeof http;
  interactions: typeof interactions;
  migrations: typeof migrations;
  modelRouting: typeof modelRouting;
  news: typeof news;
  newsDigestTypes: typeof newsDigestTypes;
  newsletter: typeof newsletter;
  newsletterAgent: typeof newsletterAgent;
  newsletterDigests: typeof newsletterDigests;
  newsletterEmails: typeof newsletterEmails;
  newsletterMetrics: typeof newsletterMetrics;
  newsletterModel: typeof newsletterModel;
  newsletterPayload: typeof newsletterPayload;
  newsletterSettings: typeof newsletterSettings;
  nyxForumAgent: typeof nyxForumAgent;
  nyxProfile: typeof nyxProfile;
  operationalSlo: typeof operationalSlo;
  organizations: typeof organizations;
  postDigests: typeof postDigests;
  postModel: typeof postModel;
  posts: typeof posts;
  presence: typeof presence;
  ragEmbeddings: typeof ragEmbeddings;
  researchQuality: typeof researchQuality;
  researchQualityAssessmentVisibilityDigest: typeof researchQualityAssessmentVisibilityDigest;
  resendClient: typeof resendClient;
  rosterForumAgent: typeof rosterForumAgent;
  semanticSearch: typeof semanticSearch;
  semanticSearchIndexWorkflow: typeof semanticSearchIndexWorkflow;
  siteContent: typeof siteContent;
  siteContentModel: typeof siteContentModel;
  sukiForumAgent: typeof sukiForumAgent;
  sukiForumAgentData: typeof sukiForumAgentData;
  sukiForumReplyAgent: typeof sukiForumReplyAgent;
  systemLogs: typeof systemLogs;
  universalSearch: typeof universalSearch;
  universalSearchProjection: typeof universalSearchProjection;
  users: typeof users;
  webVitals: typeof webVitals;
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
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
  interactionScores: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"interactionScores">;
  interactionSaves: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"interactionSaves">;
  commentCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"commentCounts">;
  newsletterMetrics: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"newsletterMetrics">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
