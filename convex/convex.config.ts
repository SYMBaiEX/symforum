import { defineApp } from "convex/server";
import { v } from "convex/values";
import agent from "@convex-dev/agent/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import resend from "@convex-dev/resend/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";

const app = defineApp({
  env: {
    AI_GATEWAY_API_KEY: v.optional(v.string()),
    OPENROUTER_API_KEY: v.optional(v.string()),
    MUSE_API_BASE_URL: v.optional(v.string()),
    MUSE_API_KEY: v.optional(v.string()),
    GITHUB_TOKEN: v.optional(v.string()),
    GH_TOKEN: v.optional(v.string()),
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

export default app;
