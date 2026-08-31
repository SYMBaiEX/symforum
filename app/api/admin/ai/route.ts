import { convexRefs } from "@/lib/convex-refs";
import { recordSystemLog, requestLogContext } from "@/lib/system-log-server";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import {
  ToolLoopAgent,
  createAgentUIStreamResponse,
  isStepCount,
  tool,
  type UIMessage,
} from "ai";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { selectStreamingModel } from "@/lib/ai-model-routing";
import {
  modelGenerationSettings,
  modelInstructions,
} from "@/lib/openrouter-model-profile";
import { after } from "next/server";
import {
  OWNER_ADMIN_AI_STREAM_TIMEOUT,
  OWNER_ADMIN_AI_TELEMETRY,
  ownerAdminAiRuntimeContext,
} from "@/lib/ai-telemetry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const correlationId = `admin-ai:${crypto.randomUUID()}`;
  try {
    const convex = await ownerConvexClient(request);
    const { messages } = (await request.json()) as { messages?: UIMessage[] };

    if (!Array.isArray(messages)) {
      return Response.json(
        { error: "messages must be an array" },
        { status: 400 },
      );
    }

    const routedModel = await selectStreamingModel(
      {
        openRouterApiKey: process.env.OPENROUTER_API_KEY,
      },
      {
        tags: ["feature:admin-ai", "surface:owner-console"],
        user: "symbaiex-owner",
      },
      {
        correlationId,
        feature: "admin-ai",
        agent: "owner-console",
      },
    );
    const agent = new ToolLoopAgent({
      model: routedModel.model,
      instructions: modelInstructions(
        routedModel.provider,
        "owner-console",
        [
          "You are the owner-only SYMBaiEX admin agent.",
          "You help operate a personal blog, Hacker News index, portfolio, comments, analytics, system logs, and newsletter platform.",
          "Use tools for platform facts. Do not claim live platform state unless a tool returned it.",
          "Mutating tools are available only for explicit owner requests in the current conversation. If the owner asks generally, inspect first and explain the proposed change before using a mutating tool.",
          "Keep answers concise, operational, and specific. Mention which platform area you inspected.",
          "Never reveal secrets, raw auth tokens, private keys, or sensitive environment values.",
        ].join("\n"),
      ),
      tools: adminAgentTools(convex),
      stopWhen: isStepCount(8),
      providerOptions: routedModel.providerOptions,
      runtimeContext: ownerAdminAiRuntimeContext(correlationId),
      telemetry: OWNER_ADMIN_AI_TELEMETRY,
      ...modelGenerationSettings(routedModel.provider, "owner-console"),
    });

    return createAgentUIStreamResponse({
      agent,
      uiMessages: messages,
      abortSignal: request.signal,
      timeout: OWNER_ADMIN_AI_STREAM_TIMEOUT,
    });
  } catch (error) {
    after(() =>
      recordSystemLog({
        level: "error",
        source: "server",
        scope: "admin-ai",
        eventType: "admin_ai_request_failed",
        message: error instanceof Error ? error.message : "Admin AI failed",
        name: error instanceof Error ? error.name : undefined,
        stack: error instanceof Error ? error.stack : undefined,
        statusCode: error instanceof AdminAiError ? error.status : 500,
        fingerprint: [
          "admin-ai",
          error instanceof AdminAiError ? error.status : 500,
          error instanceof Error ? error.message : "unknown",
        ].join("|"),
        metadataJson: JSON.stringify({ correlationId }),
        ...requestLogContext(request),
      }),
    );

    if (error instanceof AdminAiError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { error: "Admin AI request failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function adminAgentTools(convex: ConvexHttpClient) {
  return {
    platformOverview: tool({
      description:
        "Read the admin platform overview: totals, recent comments, and recent interaction sample.",
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
        const [
          subscribers,
          issues,
          dailySettings,
          dailyRuns,
          sendLogs,
          editorialAnalytics,
        ] = await Promise.all([
          convex.query(convexRefs.admin.listNewsletterSubscribers, {}),
          convex.query(convexRefs.admin.listNewsletterIssues, {}),
          convex.query(convexRefs.admin.dailyNewsletterSettings, {}),
          convex.query(convexRefs.admin.listDailyNewsletterRuns, {}),
          convex.query(convexRefs.admin.listNewsletterSendLogs, {}),
          convex.query(convexRefs.admin.newsletterEditorialAnalytics, {}),
        ]);
        return {
          subscribers,
          issues,
          dailySettings,
          recentDailyRuns: dailyRuns.slice(0, 12),
          recentSendLogs: sendLogs.slice(0, 24),
          editorialAnalytics: editorialAnalytics.slice(0, 20),
        };
      },
    }),
    queueWeeklyFieldNote: tool({
      description:
        "Owner-only mutation. Queue Belle's weekly field note for editorial review. Use only after explicit owner request.",
      inputSchema: z.object({
        runDate: z.string().optional(),
        force: z.boolean().optional(),
      }),
      execute: async (input) =>
        convex.mutation(convexRefs.admin.queueWeeklyFieldNote, input),
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
    queueDailyNewsletter: tool({
      description:
        "Owner-only mutation. Queue the daily Hacker News newsletter run through Convex. Use only after explicit owner request.",
      inputSchema: z.object({
        runDate: z.string().optional(),
        force: z.boolean().optional(),
        sendEnabled: z.boolean().optional(),
        testMode: z.boolean().optional(),
      }),
      execute: async (input) =>
        convex.mutation(convexRefs.admin.queueDailyNewsletter, input),
    }),
    updateDailyNewsletterSettings: tool({
      description:
        "Owner-only mutation. Update daily newsletter automation settings. Use only after explicit owner request.",
      inputSchema: z.object({
        enabled: z.boolean().optional(),
        testMode: z.boolean().optional(),
        reviewRequired: z.boolean().optional(),
        weeklyEnabled: z.boolean().optional(),
        weeklyReviewRequired: z.boolean().optional(),
        timeZone: z.string().optional(),
        sendTimeLocal: z
          .string()
          .regex(/^\d{1,2}:\d{2}$/)
          .optional(),
        maxIndexedArticles: z.number().min(5).max(100).optional(),
        siteUrl: z.string().url().optional(),
      }),
      execute: async (input) =>
        convex.mutation(convexRefs.admin.updateDailyNewsletterSettings, input),
    }),
    markSystemLogStatus: tool({
      description:
        "Owner-only mutation. Mark a system log open, reviewed, or resolved. Use only after explicit owner request.",
      inputSchema: z.object({
        logId: z.string(),
        status: z.enum(["open", "reviewed", "resolved"]),
      }),
      execute: async (input) =>
        convex.mutation(convexRefs.admin.updateSystemLogStatus, input),
    }),
    sendNewsletterTestIssue: tool({
      description:
        "Owner-only mutation. Send a saved newsletter issue test email to a recipient. Use only after explicit owner request.",
      inputSchema: z.object({
        slug: z.string(),
        to: z.string().email(),
      }),
      execute: async (input) =>
        convex.mutation(convexRefs.admin.sendNewsletterIssueTest, input),
    }),
  };
}

async function ownerConvexClient(request: Request) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new AdminAiError(503, "Convex is not configured");
  }

  const token = await convexAuthNextjsToken();
  if (!token) {
    throw new AdminAiError(401, "Sign in required");
  }

  const convex = new ConvexHttpClient(convexUrl);
  convex.setAuth(token);
  const viewer = await convex.query(convexRefs.admin.viewer, {});
  if (!viewer.isOwner) {
    after(() =>
      recordSystemLog({
        level: "warn",
        source: "server",
        scope: "admin-ai",
        eventType: "admin_ai_forbidden",
        message: "Non-owner attempted to use admin AI",
        statusCode: 403,
        fingerprint: "admin-ai|forbidden",
        ...requestLogContext(request),
      }),
    );
    throw new AdminAiError(403, "Owner access required");
  }
  return convex;
}

class AdminAiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
