import { defineApp } from "convex/server";
import { v } from "convex/values";
import agent from "@convex-dev/agent/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import resend from "@convex-dev/resend/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
import presence from "@convex-dev/presence/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config.js";
import betterAuth from "@convex-dev/better-auth/convex.config";

const app = defineApp({
  env: {
    NEXT_PUBLIC_INSTALLATION_CONFIG: v.optional(v.string()),
    // One-time compatibility scope for pre-migration intents. Never auto-update.
    INSTALLATION_LEGACY_BINDING: v.optional(v.string()),
    BETTER_AUTH_ENABLED: v.optional(v.string()),
    BETTER_AUTH_SECRET: v.optional(v.string()),
    BETTER_AUTH_GOOGLE_CLIENT_ID: v.optional(v.string()),
    BETTER_AUTH_GOOGLE_CLIENT_SECRET: v.optional(v.string()),
    IDENTITY_SITE_URL: v.optional(v.string()),
    AUTH_GOOGLE_ID: v.optional(v.string()),
    AUTH_GOOGLE_SECRET: v.optional(v.string()),
    JWKS: v.optional(v.string()),
    BETTER_AUTH_COOKIE_DOMAIN: v.optional(v.string()),
    TELEGRAM_LOGIN_CLIENT_ID: v.optional(v.string()),
    AGENT_SELF_JOIN_ENABLED: v.optional(v.string()),
    AGENT_JOIN_RELAY_SECRET: v.optional(v.string()),
    FORUM_ALPHA_EDITORIAL_ENABLED: v.optional(v.string()),
    FORUM_ALPHA_DISTRIBUTION_ENABLED: v.optional(v.string()),
    FORUM_ALPHA_LEAD_MINUTES: v.optional(v.string()),
    TELEGRAM_ALPHA_TOPIC_ID: v.optional(v.string()),
    X_AGENTS_ENABLED: v.optional(v.string()),
    X_AGENT_FIRST_REPLY_INVITATIONS_ENABLED: v.optional(v.string()),
    X_AGENT_CLIENT_ID: v.optional(v.string()),
    X_AGENT_CLIENT_SECRET: v.optional(v.string()),
    X_AGENT_TOKEN_KEK: v.optional(v.string()),
    AI_USAGE_SETTLEMENT_SECRET: v.optional(v.string()),
    AUTH_HANDLE_LOOKUP_SECRET: v.optional(v.string()),
    AGENT_SERVICE_AUTH_ENABLED: v.optional(v.string()),
    AGENT_SERVICE_AUTH_PRIVATE_JWK: v.optional(v.string()),
    AGENT_SERVICE_AUTH_PUBLIC_JWKS: v.optional(v.string()),
    AGENT_SERVICE_AUTH_RELAY_SECRET: v.optional(v.string()),
    WORKOS_CONNECT_ENABLED: v.optional(v.string()),
    WORKOS_CLIENT_ID: v.optional(v.string()),
    WORKOS_AGENT_REGISTRATION_ENABLED: v.optional(v.string()),
    WORKOS_AUTHKIT_ISSUER: v.optional(v.string()),
    WORKOS_API_KEY: v.optional(v.string()),
    OPENROUTER_API_KEY: v.optional(v.string()),
    OPENROUTER_DAILY_BUDGET_USD: v.optional(v.string()),
    SOLANA_TRACKER_API_KEY: v.optional(v.string()),
    // Commerce remains off until explicit treasury/provider/economic setup.
    FORUM_SWAPS_ENABLED: v.optional(v.string()),
    FORUM_PROMOTIONS_ENABLED: v.optional(v.string()),
    FORUM_COMMERCE_TREASURY: v.optional(v.string()),
    FORUM_PLATFORM_FEE_BPS: v.optional(v.string()),
    FORUM_PROMOTION_AMOUNT_RAW: v.optional(v.string()),
    FORUM_PROMOTION_DURATION_HOURS: v.optional(v.string()),
    FORUM_COMMERCE_RPC_URL: v.optional(v.string()),
    FORUM_SWAP_RECONCILIATION_TARGET: v.optional(v.string()),
    FORUM_SWAP_AUTORECOVERY_ENABLED: v.optional(v.string()),
    JUPITER_API_KEY: v.optional(v.string()),
    // Shadow comparison and live generation have separate switches and secrets.
    ELIZA_SHADOW_MODE: v.optional(v.string()),
    ELIZA_SHADOW_WORKER_URL: v.optional(v.string()),
    ELIZA_SHADOW_WORKER_SECRET: v.optional(v.string()),
    ELIZA_SHADOW_DAILY_BUDGET_USD: v.optional(v.string()),
    ELIZA_RUNTIME_MODE: v.optional(v.string()),
    ELIZA_RUNTIME_RECEIPT_RECOVERY_ENABLED: v.optional(v.string()),
    ELIZA_RUNTIME_WORKER_URL: v.optional(v.string()),
    ELIZA_RUNTIME_WORKER_SECRET: v.optional(v.string()),
    TELEGRAM_AGENTS_ENABLED: v.optional(v.string()),
    TELEGRAM_AGENT_BOTS: v.optional(v.string()),
    TELEGRAM_DIGEST_ENABLED: v.optional(v.string()),
    TELEGRAM_DIGEST_TOPIC_ID: v.optional(v.string()),
    TELEGRAM_TRADE_FEED_ENABLED: v.optional(v.string()),
    TELEGRAM_TRADE_FEED_TOPIC_ID: v.optional(v.string()),
    TELEGRAM_MEMES_PIPELINE_VERSION: v.optional(v.string()),
    TELEGRAM_MEMES_ENABLED: v.optional(v.string()),
    TELEGRAM_MEMES_TOPIC_ID: v.optional(v.string()),
    TELEGRAM_YAPPERS_ENABLED: v.optional(v.string()),
    TELEGRAM_YAPPERS_TOPIC_ID: v.optional(v.string()),
    // Semantic retrieval is intentionally opt-in. It is kept separate from
    // editorial agent routing so an operator can stop all semantic indexing
    // without changing public lexical search.
    SEMANTIC_SEARCH_ENABLED: v.optional(v.string()),
    // Background re-embedding has a separate switch so enabling semantic
    // reads or a manual backfill never implicitly starts ingestion spend.
    SEMANTIC_SEARCH_AUTO_INDEX_ENABLED: v.optional(v.string()),
    SEMANTIC_SEARCH_DAILY_BUDGET_USD: v.optional(v.string()),
    SEMANTIC_SEARCH_EMBEDDING_MODEL: v.optional(v.string()),
    // Shared only by the first-party Next relay and Convex. Semantic transport
    // stays indistinguishable from a missing route when this 32+ character
    // secret is absent or does not match.
    AGENT_SEMANTIC_RELAY_SECRET: v.optional(v.string()),
    FORUM_AGENT_DAILY_PUBLICATION_LIMIT: v.optional(v.string()),
    WEB_VITALS_COLLECTION_ENABLED: v.optional(v.string()),
    WEB_VITALS_CLEANUP_ENABLED: v.optional(v.string()),
    // The SLO evaluator is fail-closed until an operator explicitly enables it.
    WEB_VITALS_SLO_ENABLED: v.optional(v.string()),
    // Disabled by default so operators explicitly opt in before the watchdog
    // becomes responsible for executing critical scheduled work.
    CRON_WATCHDOG_ENABLED: v.optional(v.string()),
    GITHUB_TOKEN: v.optional(v.string()),
    GH_TOKEN: v.optional(v.string()),
    // Optional NVD API key. It is sent only as the documented X-ApiKey header
    // to services.nvd.nist.gov and is never persisted or included in logs.
    NVD_API_KEY: v.optional(v.string()),
    EVIDENCE_WEBHOOK_ALLOWED_HOSTS: v.optional(v.string()),
    EVIDENCE_WEBHOOK_SIGNING_SECRET: v.optional(v.string()),
    EVIDENCE_WEBHOOK_KEK: v.optional(v.string()),
    RESEND_API_KEY: v.optional(v.string()),
    RESEND_WEBHOOK_SECRET: v.optional(v.string()),
    NEWSLETTER_FROM_EMAIL: v.optional(v.string()),
    NEWSLETTER_REPLY_TO: v.optional(v.string()),
    NEWSLETTER_SITE_URL: v.optional(v.string()),
    CONTACT_FROM_EMAIL: v.optional(v.string()),
    CONTACT_NOTIFICATION_TO: v.optional(v.string()),
    FORUM_EMAIL_NOTIFICATIONS_ENABLED: v.optional(v.string()),
    FORUM_FROM_EMAIL: v.optional(v.string()),
    FORUM_REPLY_TO: v.optional(v.string()),
    FORUM_SITE_URL: v.optional(v.string()),
    OWNER_BOOTSTRAP_TOKEN: v.optional(v.string()),
    SITE_URL: v.optional(v.string()),
  },
});

app.use(resend);
app.use(betterAuth);
app.use(agent);
app.use(rag);
app.use(rateLimiter);
app.use(workflow);
app.use(presence);
app.use(aggregate, { name: "interactionScores" });
app.use(aggregate, { name: "interactionSaves" });
app.use(aggregate, { name: "commentCounts" });
app.use(aggregate, { name: "newsletterMetrics" });
app.use(migrations);

export default app;
