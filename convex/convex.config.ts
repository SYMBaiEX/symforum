import { defineApp } from "convex/server";
import { v } from "convex/values";
import resend from "@convex-dev/resend/convex.config.js";

const app = defineApp({
  env: {
    AI_GATEWAY_API_KEY: v.optional(v.string()),
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

export default app;
