import { defineApp } from "convex/server";
import { v } from "convex/values";
import resend from "@convex-dev/resend/convex.config.js";

const app = defineApp({
  env: {
    GITHUB_TOKEN: v.optional(v.string()),
    GH_TOKEN: v.optional(v.string()),
    RESEND_API_KEY: v.optional(v.string()),
    RESEND_WEBHOOK_SECRET: v.optional(v.string()),
    NEWSLETTER_FROM_EMAIL: v.optional(v.string()),
    NEWSLETTER_REPLY_TO: v.optional(v.string()),
    NEWSLETTER_SITE_URL: v.optional(v.string()),
  },
});

app.use(resend);

export default app;
