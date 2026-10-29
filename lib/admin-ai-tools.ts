import "server-only";
import { tool } from "ai";
import { z } from "zod";
import type { ConvexHttpClient } from "convex/browser";
import { convexRefs } from "./convex-refs";

// Untrusted comments and source text cannot gain write authority through a model.
export function ownerConsoleReadTools(convex: Pick<ConvexHttpClient, "query">) {
  return {
    platformOverview: tool({
      description:
        "Read the admin platform overview: bounded sample counts, recent comments, and recent interactions.",
      inputSchema: z.object({}),
      execute: async () => convex.query(convexRefs.admin.overview, {}),
    }),
    contentInventory: tool({
      description:
        "Read posts, site pages, and portfolio projects for editorial and portfolio awareness.",
      inputSchema: z.object({}),
      execute: async () => {
        const [posts, pages, projects] = await Promise.all([
          convex.query(convexRefs.admin.listPosts, {}),
          convex.query(convexRefs.admin.listSitePages, {}),
          convex.query(convexRefs.admin.listPortfolioProjects, {}),
        ]);
        return { posts, pages, projects };
      },
    }),
    communityState: tool({
      description:
        "Read users, comments, and interactions. Optional filters keep comment and interaction checks focused.",
      inputSchema: z.object({
        entityType: z.enum(["post", "hnStory", "portfolioProject"]).optional(),
        entityId: z.string().optional(),
      }),
      execute: async ({ entityType, entityId }) => {
        const [users, comments, interactions] = await Promise.all([
          convex.query(convexRefs.admin.listUsers, {}),
          convex.query(convexRefs.admin.listComments, { entityType, entityId }),
          convex.query(convexRefs.admin.listInteractions, {
            entityType:
              entityType === "post" || entityType === "hnStory"
                ? entityType
                : undefined,
            entityId,
          }),
        ]);
        return { users, comments, interactions };
      },
    }),
    newsletterState: tool({
      description:
        "Read newsletter subscribers, issues, daily automation settings, recent runs, and recent send logs.",
      inputSchema: z.object({}),
      execute: async () => {
        const [subscribers, issues, dailySettings, dailyRuns, sendLogs] =
          await Promise.all([
            convex.query(convexRefs.admin.listNewsletterSubscribers, {}),
            convex.query(convexRefs.admin.listNewsletterIssues, {}),
            convex.query(convexRefs.admin.dailyNewsletterSettings, {}),
            convex.query(convexRefs.admin.listDailyNewsletterRuns, {}),
            convex.query(convexRefs.admin.listNewsletterSendLogs, {}),
          ]);
        return {
          subscribers,
          issues,
          dailySettings,
          recentDailyRuns: dailyRuns.slice(0, 12),
          recentSendLogs: sendLogs.slice(0, 24),
        };
      },
    }),
    newsletterEditorialPerformance: tool({
      description:
        "Read recent newsletter quality, delivery, open, click, reply, and story-save metrics. Call only when the owner specifically asks about newsletter performance or engagement; this is a separate, heavier report than routine newsletter state.",
      inputSchema: z.object({}),
      execute: async () =>
        convex.query(convexRefs.admin.newsletterEditorialAnalytics, {}),
    }),
    systemHealth: tool({
      description:
        "Read system logs and analytics summaries to diagnose platform health.",
      inputSchema: z.object({
        logStatus: z.enum(["open", "reviewed", "resolved"]).optional(),
        logLevel: z.enum(["info", "warn", "error"]).optional(),
        limit: z.number().min(1).max(100).optional(),
        analyticsDays: z.number().min(1).max(90).optional(),
      }),
      execute: async ({ logStatus, logLevel, limit, analyticsDays }) => {
        const [logSummary, logs, analytics] = await Promise.all([
          convex.query(convexRefs.admin.summarySystemLogs, {}),
          convex.query(convexRefs.admin.listSystemLogs, {
            status: logStatus,
            level: logLevel,
            limit,
          }),
          convex.query(convexRefs.admin.analyticsSummary, {
            days: analyticsDays,
            now: Date.now(),
          }),
        ]);
        return { logSummary, logs, analytics };
      },
    }),
  };
}
