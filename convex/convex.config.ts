import { defineApp } from "convex/server";
import { v } from "convex/values";
import agent from "@convex-dev/agent/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import resend from "@convex-dev/resend/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
import presence from "@convex-dev/presence/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";

const app = defineApp({
  env: {
    OPENROUTER_API_KEY: v.optional(v.string()),
    OPENROUTER_DAILY_BUDGET_USD: v.optional(v.string()),
    FORUM_AGENT_DAILY_PUBLICATION_LIMIT: v.optional(v.string()),
    WEB_VITALS_COLLECTION_ENABLED: v.optional(v.string()),
    WEB_VITALS_CLEANUP_ENABLED: v.optional(v.string()),
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
app.use(agent);
app.use(rag);
app.use(rateLimiter);
app.use(workflow);
app.use(presence);
app.use(aggregate, { name: "interactionScores" });
app.use(aggregate, { name: "interactionSaves" });
app.use(aggregate, { name: "commentCounts" });

export default app;
