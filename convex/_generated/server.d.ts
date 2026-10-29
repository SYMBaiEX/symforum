/* eslint-disable */
/**
 * Generated utilities for implementing server-side Convex query and mutation functions.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import {
  ActionBuilder,
  HttpActionBuilder,
  MutationBuilder,
  QueryBuilder,
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";
import type { DataModel } from "./dataModel.js";

/**
 * Typesafe environment variables.
 *
 * This includes platform-provided env vars and any variables declared in
 * `convex.config.ts`.
 */
type Env = {
  readonly FORUM_SWAPS_ENABLED: string | undefined;
  readonly FORUM_PROMOTIONS_ENABLED: string | undefined;
  readonly FORUM_COMMERCE_TREASURY: string | undefined;
  readonly FORUM_PLATFORM_FEE_BPS: string | undefined;
  readonly FORUM_PROMOTION_AMOUNT_RAW: string | undefined;
  readonly FORUM_PROMOTION_DURATION_HOURS: string | undefined;
  readonly FORUM_COMMERCE_RPC_URL: string | undefined;
  readonly JUPITER_API_KEY: string | undefined;
  readonly CONVEX_CLOUD_URL: string;
  readonly CONVEX_SITE_URL: string;
  readonly AGENT_JOIN_RELAY_SECRET: string | undefined;
  readonly AGENT_SELF_JOIN_ENABLED: string | undefined;
  readonly AGENT_SEMANTIC_RELAY_SECRET: string | undefined;
  readonly AGENT_SERVICE_AUTH_ENABLED: string | undefined;
  readonly AGENT_SERVICE_AUTH_PRIVATE_JWK: string | undefined;
  readonly AGENT_SERVICE_AUTH_PUBLIC_JWKS: string | undefined;
  readonly AGENT_SERVICE_AUTH_RELAY_SECRET: string | undefined;
  readonly AI_USAGE_SETTLEMENT_SECRET: string | undefined;
  readonly AUTH_GOOGLE_ID: string | undefined;
  readonly AUTH_GOOGLE_SECRET: string | undefined;
  readonly AUTH_HANDLE_LOOKUP_SECRET: string | undefined;
  readonly BETTER_AUTH_COOKIE_DOMAIN: string | undefined;
  readonly BETTER_AUTH_ENABLED: string | undefined;
  readonly BETTER_AUTH_GOOGLE_CLIENT_ID: string | undefined;
  readonly BETTER_AUTH_GOOGLE_CLIENT_SECRET: string | undefined;
  readonly BETTER_AUTH_SECRET: string | undefined;
  readonly CONTACT_FROM_EMAIL: string | undefined;
  readonly CONTACT_NOTIFICATION_TO: string | undefined;
  readonly CRON_WATCHDOG_ENABLED: string | undefined;
  readonly ELIZA_RUNTIME_MODE: string | undefined;
  readonly ELIZA_RUNTIME_RECEIPT_RECOVERY_ENABLED: string | undefined;
  readonly ELIZA_RUNTIME_WORKER_SECRET: string | undefined;
  readonly ELIZA_RUNTIME_WORKER_URL: string | undefined;
  readonly ELIZA_SHADOW_DAILY_BUDGET_USD: string | undefined;
  readonly ELIZA_SHADOW_MODE: string | undefined;
  readonly ELIZA_SHADOW_WORKER_SECRET: string | undefined;
  readonly ELIZA_SHADOW_WORKER_URL: string | undefined;
  readonly EVIDENCE_WEBHOOK_ALLOWED_HOSTS: string | undefined;
  readonly EVIDENCE_WEBHOOK_KEK: string | undefined;
  readonly EVIDENCE_WEBHOOK_SIGNING_SECRET: string | undefined;
  readonly FORUM_AGENT_DAILY_PUBLICATION_LIMIT: string | undefined;
  readonly FORUM_ALPHA_DISTRIBUTION_ENABLED: string | undefined;
  readonly FORUM_ALPHA_EDITORIAL_ENABLED: string | undefined;
  readonly FORUM_ALPHA_LEAD_MINUTES: string | undefined;
  readonly FORUM_EMAIL_NOTIFICATIONS_ENABLED: string | undefined;
  readonly FORUM_FROM_EMAIL: string | undefined;
  readonly FORUM_REPLY_TO: string | undefined;
  readonly FORUM_SITE_URL: string | undefined;
  readonly GH_TOKEN: string | undefined;
  readonly GITHUB_TOKEN: string | undefined;
  readonly IDENTITY_SITE_URL: string | undefined;
  readonly JWKS: string | undefined;
  readonly NEWSLETTER_FROM_EMAIL: string | undefined;
  readonly NEWSLETTER_REPLY_TO: string | undefined;
  readonly NEWSLETTER_SITE_URL: string | undefined;
  readonly NVD_API_KEY: string | undefined;
  readonly OPENROUTER_API_KEY: string | undefined;
  readonly OPENROUTER_DAILY_BUDGET_USD: string | undefined;
  readonly OWNER_BOOTSTRAP_TOKEN: string | undefined;
  readonly RESEND_API_KEY: string | undefined;
  readonly RESEND_WEBHOOK_SECRET: string | undefined;
  readonly SEMANTIC_SEARCH_AUTO_INDEX_ENABLED: string | undefined;
  readonly SEMANTIC_SEARCH_DAILY_BUDGET_USD: string | undefined;
  readonly SEMANTIC_SEARCH_EMBEDDING_MODEL: string | undefined;
  readonly SEMANTIC_SEARCH_ENABLED: string | undefined;
  readonly SITE_URL: string | undefined;
  readonly SOLANA_TRACKER_API_KEY: string | undefined;
  readonly TELEGRAM_AGENTS_ENABLED: string | undefined;
  readonly TELEGRAM_AGENT_BOTS: string | undefined;
  readonly TELEGRAM_ALPHA_TOPIC_ID: string | undefined;
  readonly TELEGRAM_DIGEST_ENABLED: string | undefined;
  readonly TELEGRAM_DIGEST_TOPIC_ID: string | undefined;
  readonly TELEGRAM_LOGIN_CLIENT_ID: string | undefined;
  readonly TELEGRAM_MEMES_ENABLED: string | undefined;
  readonly TELEGRAM_MEMES_PIPELINE_VERSION: string | undefined;
  readonly TELEGRAM_MEMES_TOPIC_ID: string | undefined;
  readonly TELEGRAM_TRADE_FEED_ENABLED: string | undefined;
  readonly TELEGRAM_TRADE_FEED_TOPIC_ID: string | undefined;
  readonly TELEGRAM_YAPPERS_ENABLED: string | undefined;
  readonly TELEGRAM_YAPPERS_TOPIC_ID: string | undefined;
  readonly WEB_VITALS_CLEANUP_ENABLED: string | undefined;
  readonly WEB_VITALS_COLLECTION_ENABLED: string | undefined;
  readonly WEB_VITALS_SLO_ENABLED: string | undefined;
  readonly WORKOS_AGENT_REGISTRATION_ENABLED: string | undefined;
  readonly WORKOS_API_KEY: string | undefined;
  readonly WORKOS_AUTHKIT_ISSUER: string | undefined;
  readonly WORKOS_CLIENT_ID: string | undefined;
  readonly WORKOS_CONNECT_ENABLED: string | undefined;
  readonly X_AGENTS_ENABLED: string | undefined;
  readonly X_AGENT_CLIENT_ID: string | undefined;
  readonly X_AGENT_CLIENT_SECRET: string | undefined;
  readonly X_AGENT_FIRST_REPLY_INVITATIONS_ENABLED: string | undefined;
  readonly X_AGENT_TOKEN_KEK: string | undefined;
};

/**
 * Define a query in this Convex app's public API.
 *
 * This function will be allowed to read your Convex database and will be accessible from the client.
 *
 * @param func - The query function. It receives a {@link QueryCtx} as its first argument.
 * @returns The wrapped query. Include this as an `export` to name it and make it accessible.
 */
export declare const query: QueryBuilder<DataModel, "public">;

/**
 * Define a query that is only accessible from other Convex functions (but not from the client).
 *
 * This function will be allowed to read from your Convex database. It will not be accessible from the client.
 *
 * @param func - The query function. It receives a {@link QueryCtx} as its first argument.
 * @returns The wrapped query. Include this as an `export` to name it and make it accessible.
 */
export declare const internalQuery: QueryBuilder<DataModel, "internal">;

/**
 * Define a mutation in this Convex app's public API.
 *
 * This function will be allowed to modify your Convex database and will be accessible from the client.
 *
 * @param func - The mutation function. It receives a {@link MutationCtx} as its first argument.
 * @returns The wrapped mutation. Include this as an `export` to name it and make it accessible.
 */
export declare const mutation: MutationBuilder<DataModel, "public">;

/**
 * Define a mutation that is only accessible from other Convex functions (but not from the client).
 *
 * This function will be allowed to modify your Convex database. It will not be accessible from the client.
 *
 * @param func - The mutation function. It receives a {@link MutationCtx} as its first argument.
 * @returns The wrapped mutation. Include this as an `export` to name it and make it accessible.
 */
export declare const internalMutation: MutationBuilder<DataModel, "internal">;

/**
 * Define an action in this Convex app's public API.
 *
 * An action is a function which can execute any JavaScript code, including non-deterministic
 * code and code with side-effects, like calling third-party services.
 * They can be run in Convex's JavaScript environment or in Node.js using the "use node" directive.
 * They can interact with the database indirectly by calling queries and mutations using the {@link ActionCtx}.
 *
 * @param func - The action. It receives an {@link ActionCtx} as its first argument.
 * @returns The wrapped action. Include this as an `export` to name it and make it accessible.
 */
export declare const action: ActionBuilder<DataModel, "public">;

/**
 * Define an action that is only accessible from other Convex functions (but not from the client).
 *
 * @param func - The function. It receives an {@link ActionCtx} as its first argument.
 * @returns The wrapped function. Include this as an `export` to name it and make it accessible.
 */
export declare const internalAction: ActionBuilder<DataModel, "internal">;

/**
 * Define an HTTP action.
 *
 * The wrapped function will be used to respond to HTTP requests received
 * by a Convex deployment if the requests matches the path and method where
 * this action is routed. Be sure to route your httpAction in `convex/http.js`.
 *
 * @param func - The function. It receives an {@link ActionCtx} as its first argument
 * and a Fetch API `Request` object as its second.
 * @returns The wrapped function. Import this function from `convex/http.js` and route it to hook it up.
 */
export declare const httpAction: HttpActionBuilder;

/**
 * Typesafe environment variables.
 *
 * This includes platform-provided env vars and any variables declared in
 * `convex.config.ts`.
 */
export declare const env: Env;

/**
 * A set of services for use within Convex query functions.
 *
 * The query context is passed as the first argument to any Convex query
 * function run on the server.
 *
 * This differs from the {@link MutationCtx} because all of the services are
 * read-only.
 */
export type QueryCtx = GenericQueryCtx<DataModel>;

/**
 * A set of services for use within Convex mutation functions.
 *
 * The mutation context is passed as the first argument to any Convex mutation
 * function run on the server.
 */
export type MutationCtx = GenericMutationCtx<DataModel>;

/**
 * A set of services for use within Convex action functions.
 *
 * The action context is passed as the first argument to any Convex action
 * function run on the server.
 */
export type ActionCtx = GenericActionCtx<DataModel>;

/**
 * An interface to read from the database within Convex query functions.
 *
 * The two entry points are {@link DatabaseReader.get}, which fetches a single
 * document by its {@link Id}, or {@link DatabaseReader.query}, which starts
 * building a query.
 */
export type DatabaseReader = GenericDatabaseReader<DataModel>;

/**
 * An interface to read from and write to the database within Convex mutation
 * functions.
 *
 * Convex guarantees that all writes within a single mutation are
 * executed atomically, so you never have to worry about partial writes leaving
 * your data in an inconsistent state. See [the Convex Guide](https://docs.convex.dev/understanding/convex-fundamentals/functions#atomicity-and-optimistic-concurrency-control)
 * for the guarantees Convex provides your functions.
 */
export type DatabaseWriter = GenericDatabaseWriter<DataModel>;
