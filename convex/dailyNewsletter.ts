import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  env,
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireSiteAdmin } from "./authz";
import type { EditorialNewsletterPayload } from "./newsletterPayload";

type DailyRunStart =
  | {
      ok: true;
      runId: Id<"dailyNewsletterRuns">;
      skipped: false;
    }
  | {
      ok: true;
      runId: Id<"dailyNewsletterRuns">;
      skipped: true;
      reason: string;
    };

type EditorialGenerationResult = {
  subject: string;
  previewText: string;
  payload: EditorialNewsletterPayload;
  storyCount: number;
  topStoryIds: number[];
  inputTokens?: number;
  outputTokens?: number;
};

type IndexedNewsSnapshot = {
  snapshot: Doc<"newsSnapshots"> | null;
  stories: Doc<"hnStories">[];
};

const DEFAULT_TIME_ZONE = "America/Chicago";
const DEFAULT_SEND_TIME_LOCAL = "07:15";
const DEFAULT_MAX_INDEXED_ARTICLES = 40;
const DEFAULT_NEWSLETTER_STORIES = 8;
const MAX_AUTOMATED_DAILY_ATTEMPTS = 3;
const AUTOMATED_RETRY_COOLDOWN_MS = 2 * 60 * 60 * 1000;

const readIndexedSnapshotRef = makeFunctionReference<
  "query",
  { snapshotDate?: string; limit?: number },
  IndexedNewsSnapshot
>("news:readIndexedSnapshot");

const getSettingRef = makeFunctionReference<
  "query",
  { key: string },
  string | null
>("newsletter:getSetting");

const sendIssueRef = makeFunctionReference<
  "action",
  { issueId: Id<"newsletterIssues"> },
  null
>("newsletterEmails:sendNewsletterIssue");

const runDailyNewsletterRef = makeFunctionReference<
  "action",
  {
    runDate?: string;
    force?: boolean;
    sendEnabled?: boolean;
    testMode?: boolean;
    maxIndexedArticles?: number;
    maxNewsletterStories?: number;
    mode?: "cron" | "manual" | "test";
  },
  DailyRunResult
>("dailyNewsletter:runDailyNewsletter");

const runWeeklyNewsletterRef = makeFunctionReference<
  "action",
  { runDate?: string; force?: boolean },
  DailyRunResult
>("dailyNewsletter:runWeeklyFieldNote");

const generateDailySignalRef = makeFunctionReference<
  "action",
  { runDate: string; snapshotDate?: string; siteUrl: string },
  EditorialGenerationResult
>("newsletterAgent:generateDailySignal");

const generateWeeklyFieldNoteRef = makeFunctionReference<
  "action",
  { runDate: string; siteUrl: string },
  EditorialGenerationResult
>("newsletterAgent:generateWeeklyFieldNote");

const startDailyRunRef = makeFunctionReference<
  "mutation",
  {
    runDate: string;
    mode: "cron" | "manual" | "test";
    sendEnabled: boolean;
    startedAt: number;
    force: boolean;
  },
  DailyRunStart
>("dailyNewsletter:startDailyRun");

const upsertDailyIssueRef = makeFunctionReference<
  "mutation",
  {
    runId: Id<"dailyNewsletterRuns">;
    runDate: string;
    slug: string;
    edition: "daily-signal" | "weekly-field-note";
    snapshotDate: string;
    subject: string;
    previewText: string;
    payloadJson: string;
    storyCount: number;
    topStoryIds: number[];
    sendEnabled: boolean;
    qualityScore: number;
    inputTokens?: number;
    outputTokens?: number;
    forumCategorySlug?: string;
    forumThreadSlug?: string;
  },
  { issueId: Id<"newsletterIssues">; slug: string }
>("dailyNewsletter:upsertDailyIssue");

const markDailyRunFailedRef = makeFunctionReference<
  "mutation",
  {
    runId: Id<"dailyNewsletterRuns">;
    errorMessage: string;
  },
  null
>("dailyNewsletter:markDailyRunFailed");

type DailyRunResult = {
  ok: boolean;
  skipped?: boolean;
  runId?: Id<"dailyNewsletterRuns">;
  issueId?: Id<"newsletterIssues">;
  runDate: string;
  snapshotDate?: string;
  storyCount?: number;
  topStoryIds?: number[];
  sent?: boolean;
  reason?: string;
};

type DailyNewsletterAdminSettings = {
  enabled: boolean;
  testMode: boolean;
  reviewRequired: boolean;
  weeklyEnabled: boolean;
  weeklyReviewRequired: boolean;
  timeZone: string;
  sendTimeLocal: string;
  maxIndexedArticles: number;
  maxNewsletterStories: number;
  siteUrl: string;
  cron: {
    hnRefreshUtc: string;
    scheduleCheckUtc: string;
    weeklyFieldNoteUtc: string;
  };
};

export const adminSettings = query({
  args: {},
  handler: async (ctx): Promise<DailyNewsletterAdminSettings> => {
    await requireSiteAdmin(ctx);
    return await readAdminSettings(ctx);
  },
});

export const updateAdminSettings = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    testMode: v.optional(v.boolean()),
    reviewRequired: v.optional(v.boolean()),
    weeklyEnabled: v.optional(v.boolean()),
    weeklyReviewRequired: v.optional(v.boolean()),
    timeZone: v.optional(v.string()),
    sendTimeLocal: v.optional(v.string()),
    maxIndexedArticles: v.optional(v.number()),
    maxNewsletterStories: v.optional(v.number()),
    siteUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<DailyNewsletterAdminSettings> => {
    await requireSiteAdmin(ctx);
    const updates: Array<{ key: string; value: string }> = [];

    if (args.enabled !== undefined) {
      updates.push({
        key: "dailyNewsletter.enabled",
        value: args.enabled ? "true" : "false",
      });
    }
    if (args.testMode !== undefined) {
      updates.push({
        key: "dailyNewsletter.testMode",
        value: args.testMode ? "true" : "false",
      });
    }
    if (args.reviewRequired !== undefined) {
      updates.push({
        key: "dailyNewsletter.reviewRequired",
        value: args.reviewRequired ? "true" : "false",
      });
    }
    if (args.weeklyEnabled !== undefined) {
      updates.push({
        key: "weeklyNewsletter.enabled",
        value: args.weeklyEnabled ? "true" : "false",
      });
    }
    if (args.weeklyReviewRequired !== undefined) {
      updates.push({
        key: "weeklyNewsletter.reviewRequired",
        value: args.weeklyReviewRequired ? "true" : "false",
      });
    }
    if (args.timeZone !== undefined) {
      updates.push({
        key: "dailyNewsletter.timeZone",
        value: normalizeTimeZone(args.timeZone),
      });
    }
    if (args.sendTimeLocal !== undefined) {
      updates.push({
        key: "dailyNewsletter.sendTimeLocal",
        value: normalizeSendTime(args.sendTimeLocal),
      });
    }
    if (args.maxIndexedArticles !== undefined) {
      updates.push({
        key: "dailyNewsletter.maxIndexedArticles",
        value: String(
          clampNumber(
            args.maxIndexedArticles,
            5,
            100,
            DEFAULT_MAX_INDEXED_ARTICLES,
          ),
        ),
      });
    }
    if (args.maxNewsletterStories !== undefined) {
      updates.push({
        key: "dailyNewsletter.maxNewsletterStories",
        value: String(
          clampNumber(
            args.maxNewsletterStories,
            3,
            12,
            DEFAULT_NEWSLETTER_STORIES,
          ),
        ),
      });
    }
    if (args.siteUrl !== undefined) {
      updates.push({
        key: "newsletter.siteUrl",
        value: normalizeSiteUrl(args.siteUrl),
      });
    }

    for (const update of updates) {
      await setSettingDirect(ctx, update.key, update.value);
    }

    return await readAdminSettings(ctx);
  },
});

export const checkDailyNewsletterSchedule = internalAction({
  args: {},
  handler: async (ctx): Promise<DailyRunResult> => {
    const config = await readDailyConfig(ctx, {});
    const sendTimeLocal = normalizeSendTime(
      (await ctx.runQuery(getSettingRef, {
        key: "dailyNewsletter.sendTimeLocal",
      })) ?? DEFAULT_SEND_TIME_LOCAL,
    );
    const now = Date.now();
    const runDate = dateInTimeZone(now, config.timeZone);

    if (!config.sendEnabled) {
      return {
        ok: true,
        skipped: true,
        runDate,
        reason: "daily-newsletter-disabled",
      };
    }
    if (config.testMode) {
      return {
        ok: true,
        skipped: true,
        runDate,
        reason: "daily-newsletter-test-mode",
      };
    }
    if (!isPastConfiguredSendTime(now, config.timeZone, sendTimeLocal)) {
      return {
        ok: true,
        skipped: true,
        runDate,
        reason: "before-configured-send-time",
      };
    }

    return await ctx.runAction(runDailyNewsletterRef, {
      runDate,
      mode: "cron",
    });
  },
});

export const runDailyNewsletter = internalAction({
  args: {
    runDate: v.optional(v.string()),
    force: v.optional(v.boolean()),
    sendEnabled: v.optional(v.boolean()),
    testMode: v.optional(v.boolean()),
    maxIndexedArticles: v.optional(v.number()),
    maxNewsletterStories: v.optional(v.number()),
    mode: v.optional(
      v.union(v.literal("cron"), v.literal("manual"), v.literal("test")),
    ),
  },
  handler: async (ctx, args): Promise<DailyRunResult> => {
    const config = await readDailyConfig(ctx, args);
    const startedAt = Date.now();
    const runDate = args.runDate ?? dateInTimeZone(startedAt, config.timeZone);
    const mode = args.mode ?? (config.testMode ? "test" : "cron");
    const requestedSendEnabled = args.sendEnabled ?? config.sendEnabled;
    const sendEnabled = requestedSendEnabled && !config.reviewRequired;

    const start = await ctx.runMutation(startDailyRunRef, {
      runDate,
      mode,
      sendEnabled,
      startedAt,
      force: args.force ?? false,
    });

    if (start.skipped) {
      return {
        ok: true,
        skipped: true,
        runId: start.runId,
        runDate,
        reason: start.reason,
      };
    }

    try {
      let indexed: IndexedNewsSnapshot | null = null;
      const currentRunDate = dateInTimeZone(startedAt, config.timeZone);

      if (runDate !== currentRunDate) {
        indexed = await ctx.runQuery(readIndexedSnapshotRef, {
          snapshotDate: runDate,
          limit: config.maxIndexedArticles,
        });
      }

      if (
        indexed === null ||
        indexed.snapshot === null ||
        indexed.stories.length === 0
      ) {
        const refreshed: { snapshotDate: string; storyCount: number } =
          await ctx.runAction(internal.news.refreshTopStories, {
            limit: config.maxIndexedArticles,
          });
        indexed = await ctx.runQuery(readIndexedSnapshotRef, {
          snapshotDate: refreshed.snapshotDate,
          limit: config.maxIndexedArticles,
        });
      }

      if (indexed.snapshot === null || indexed.stories.length === 0) {
        throw new Error("No indexed Hacker News stories were available");
      }

      const generated = await ctx.runAction(generateDailySignalRef, {
        runDate,
        snapshotDate: indexed.snapshot.snapshotDate,
        siteUrl: config.siteUrl,
      });
      const forum = await ctx.runAction(
        internal.belleForumAgent.runDailyHackerNewsDigest,
        { snapshotDate: indexed.snapshot.snapshotDate },
      );
      const payload = generated.payload;
      if (forum.status === "published") {
        payload.discussion.forumUrl = `${config.siteUrl}/forum/${forum.categorySlug}/${forum.threadSlug}`;
      }
      const issue = await ctx.runMutation(upsertDailyIssueRef, {
        runId: start.runId,
        runDate,
        slug: `daily-signal-${runDate}`,
        edition: "daily-signal",
        snapshotDate: indexed.snapshot.snapshotDate,
        subject: generated.subject,
        previewText: generated.previewText,
        payloadJson: JSON.stringify(payload),
        storyCount: generated.storyCount,
        topStoryIds: generated.topStoryIds,
        sendEnabled,
        qualityScore: payload.quality.score,
        inputTokens: generated.inputTokens,
        outputTokens: generated.outputTokens,
        forumCategorySlug:
          forum.status === "published" ? forum.categorySlug : undefined,
        forumThreadSlug:
          forum.status === "published" ? forum.threadSlug : undefined,
      });

      if (!sendEnabled || config.testMode || mode === "test") {
        return {
          ok: true,
          skipped: true,
          runId: start.runId,
          issueId: issue.issueId,
          runDate,
          snapshotDate: indexed.snapshot.snapshotDate,
          storyCount: generated.storyCount,
          topStoryIds: generated.topStoryIds,
          reason: config.reviewRequired ? "review-required" : "send-disabled",
        };
      }

      await ctx.runAction(sendIssueRef, { issueId: issue.issueId });

      return {
        ok: true,
        runId: start.runId,
        issueId: issue.issueId,
        runDate,
        snapshotDate: indexed.snapshot.snapshotDate,
        storyCount: generated.storyCount,
        topStoryIds: generated.topStoryIds,
        sent: true,
      };
    } catch (error) {
      await ctx.runMutation(markDailyRunFailedRef, {
        runId: start.runId,
        errorMessage: errorMessage(error),
      });
      throw error;
    }
  },
});

export const runWeeklyFieldNote = internalAction({
  args: {
    runDate: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<DailyRunResult> => {
    const config = await readDailyConfig(ctx, {});
    const runDate = args.runDate ?? dateInTimeZone(Date.now(), config.timeZone);
    if (!config.weeklyEnabled) {
      return {
        ok: true,
        skipped: true,
        runDate,
        reason: "weekly-newsletter-disabled",
      };
    }
    const runKey = `weekly-${runDate}`;
    const sendEnabled = !config.weeklyReviewRequired && !config.testMode;
    const start = await ctx.runMutation(startDailyRunRef, {
      runDate: runKey,
      mode: "cron",
      sendEnabled,
      startedAt: Date.now(),
      force: args.force ?? false,
    });
    if (start.skipped) {
      return {
        ok: true,
        skipped: true,
        runId: start.runId,
        runDate,
        reason: start.reason,
      };
    }

    try {
      const generated = await ctx.runAction(generateWeeklyFieldNoteRef, {
        runDate,
        siteUrl: config.siteUrl,
      });
      const forum = await ctx.runAction(
        internal.belleForumAgent.runDailyHackerNewsDigest,
        { snapshotDate: generated.payload.snapshotDate },
      );
      if (forum.status === "published") {
        generated.payload.discussion.forumUrl = `${config.siteUrl}/forum/${forum.categorySlug}/${forum.threadSlug}`;
      }
      const issue = await ctx.runMutation(upsertDailyIssueRef, {
        runId: start.runId,
        runDate: runKey,
        slug: `weekly-field-note-${runDate}`,
        edition: "weekly-field-note",
        snapshotDate: generated.payload.snapshotDate,
        subject: generated.subject,
        previewText: generated.previewText,
        payloadJson: JSON.stringify(generated.payload),
        storyCount: generated.storyCount,
        topStoryIds: generated.topStoryIds,
        sendEnabled,
        qualityScore: generated.payload.quality.score,
        inputTokens: generated.inputTokens,
        outputTokens: generated.outputTokens,
        forumCategorySlug:
          forum.status === "published" ? forum.categorySlug : undefined,
        forumThreadSlug:
          forum.status === "published" ? forum.threadSlug : undefined,
      });
      if (!sendEnabled) {
        return {
          ok: true,
          skipped: true,
          runId: start.runId,
          issueId: issue.issueId,
          runDate,
          snapshotDate: generated.payload.snapshotDate,
          storyCount: generated.storyCount,
          topStoryIds: generated.topStoryIds,
          reason: "review-required",
        };
      }
      await ctx.runAction(sendIssueRef, { issueId: issue.issueId });
      return {
        ok: true,
        runId: start.runId,
        issueId: issue.issueId,
        runDate,
        snapshotDate: generated.payload.snapshotDate,
        storyCount: generated.storyCount,
        topStoryIds: generated.topStoryIds,
        sent: true,
      };
    } catch (error) {
      await ctx.runMutation(markDailyRunFailedRef, {
        runId: start.runId,
        errorMessage: errorMessage(error),
      });
      throw error;
    }
  },
});

export const queueAdminWeeklyFieldNote = mutation({
  args: { runDate: v.optional(v.string()), force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    await ctx.scheduler.runAfter(0, runWeeklyNewsletterRef, {
      runDate: args.runDate,
      force: args.force ?? true,
    });
    return { queued: true };
  },
});

export const queueAdminDailyNewsletter = mutation({
  args: {
    runDate: v.optional(v.string()),
    force: v.optional(v.boolean()),
    sendEnabled: v.optional(v.boolean()),
    testMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    await ctx.scheduler.runAfter(0, runDailyNewsletterRef, {
      runDate: args.runDate,
      force: args.force,
      sendEnabled: args.sendEnabled,
      testMode: args.testMode,
      mode: args.testMode ? "test" : "manual",
    });
    return { queued: true };
  },
});

export const listAdminRuns = query({
  args: {},
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);
    return await ctx.db
      .query("dailyNewsletterRuns")
      .withIndex("by_startedAt")
      .order("desc")
      .take(100);
  },
});

export const listAdminSendLogs = query({
  args: {
    runDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    const runDate = args.runDate;
    if (runDate) {
      return await ctx.db
        .query("newsletterSendLogs")
        .withIndex("by_runDate_and_createdAt", (q) => q.eq("runDate", runDate))
        .order("desc")
        .take(100);
    }
    return await ctx.db
      .query("newsletterSendLogs")
      .withIndex("by_createdAt")
      .order("desc")
      .take(100);
  },
});

export const startDailyRun = internalMutation({
  args: {
    runDate: v.string(),
    mode: v.union(v.literal("cron"), v.literal("manual"), v.literal("test")),
    sendEnabled: v.boolean(),
    startedAt: v.number(),
    force: v.boolean(),
  },
  handler: async (ctx, args): Promise<DailyRunStart> => {
    const existing = await ctx.db
      .query("dailyNewsletterRuns")
      .withIndex("by_runDate", (q) => q.eq("runDate", args.runDate))
      .unique();
    const recentRunning =
      existing?.status === "running" &&
      args.startedAt - existing.startedAt < 30 * 60 * 1000;
    const attemptCount = existing?.attemptCount ?? 1;

    if (existing && !args.force) {
      if (existing.status === "sent") {
        await ctx.db.insert("newsletterSendLogs", {
          runDate: args.runDate,
          issueId: existing.issueId,
          provider: "resend",
          status: "skipped",
          errorMessage: "Daily newsletter already sent",
          createdAt: args.startedAt,
        });
        return {
          ok: true,
          runId: existing._id,
          skipped: true,
          reason: "Daily newsletter already sent",
        };
      }
      if (existing.status === "generated") {
        return {
          ok: true,
          runId: existing._id,
          skipped: true,
          reason: "Newsletter draft is awaiting editorial review",
        };
      }
      if (recentRunning) {
        return {
          ok: true,
          runId: existing._id,
          skipped: true,
          reason: "Daily newsletter run already in progress",
        };
      }
      if (
        existing.status === "failed" &&
        attemptCount >= MAX_AUTOMATED_DAILY_ATTEMPTS
      ) {
        return {
          ok: true,
          runId: existing._id,
          skipped: true,
          reason: `Daily newsletter reached its ${MAX_AUTOMATED_DAILY_ATTEMPTS}-attempt retry limit`,
        };
      }
      if (
        existing.status === "failed" &&
        args.startedAt - (existing.completedAt ?? existing.updatedAt) <
          AUTOMATED_RETRY_COOLDOWN_MS
      ) {
        return {
          ok: true,
          runId: existing._id,
          skipped: true,
          reason: "Daily newsletter retry is cooling down",
        };
      }
    }

    if (existing) {
      await ctx.db.patch("dailyNewsletterRuns", existing._id, {
        status: "running",
        mode: args.mode,
        sendEnabled: args.sendEnabled,
        startedAt: args.startedAt,
        completedAt: undefined,
        sentAt: undefined,
        resendBroadcastId: undefined,
        errorMessage: undefined,
        storyCount: 0,
        topStoryIds: [],
        qualityScore: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        attemptCount: attemptCount + 1,
        updatedAt: args.startedAt,
      });
      return { ok: true, runId: existing._id, skipped: false };
    }

    const runId = await ctx.db.insert("dailyNewsletterRuns", {
      runDate: args.runDate,
      status: "running",
      mode: args.mode,
      sendEnabled: args.sendEnabled,
      startedAt: args.startedAt,
      attemptCount: 1,
      storyCount: 0,
      topStoryIds: [],
      updatedAt: args.startedAt,
    });
    return { ok: true, runId, skipped: false };
  },
});

export const upsertDailyIssue = internalMutation({
  args: {
    runId: v.id("dailyNewsletterRuns"),
    runDate: v.string(),
    slug: v.string(),
    edition: v.union(v.literal("daily-signal"), v.literal("weekly-field-note")),
    snapshotDate: v.string(),
    subject: v.string(),
    previewText: v.string(),
    payloadJson: v.string(),
    storyCount: v.number(),
    topStoryIds: v.array(v.number()),
    sendEnabled: v.boolean(),
    qualityScore: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    forumCategorySlug: v.optional(v.string()),
    forumThreadSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = args.slug;
    const now = Date.now();
    const existingIssue = await ctx.db
      .query("newsletterIssues")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    let issueId: Id<"newsletterIssues">;

    if (existingIssue === null) {
      issueId = await ctx.db.insert("newsletterIssues", {
        slug,
        subject: args.subject,
        previewText: args.previewText.slice(0, 240),
        body: args.payloadJson,
        edition: args.edition,
        editorialVersion: 2,
        qualityScore: args.qualityScore,
        forumCategorySlug: args.forumCategorySlug,
        forumThreadSlug: args.forumThreadSlug,
        status: args.sendEnabled ? "scheduled" : "draft",
        scheduledAt: args.sendEnabled ? now : undefined,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      if (existingIssue.status === "sent") {
        throw new Error("Daily newsletter issue has already been sent");
      }
      issueId = existingIssue._id;
      await ctx.db.patch("newsletterIssues", issueId, {
        subject: args.subject,
        previewText: args.previewText.slice(0, 240),
        body: args.payloadJson,
        edition: args.edition,
        editorialVersion: 2,
        qualityScore: args.qualityScore,
        forumCategorySlug: args.forumCategorySlug,
        forumThreadSlug: args.forumThreadSlug,
        status: args.sendEnabled ? "scheduled" : "draft",
        scheduledAt: args.sendEnabled ? now : undefined,
        errorMessage: undefined,
        updatedAt: now,
      });
    }

    await ctx.db.patch("dailyNewsletterRuns", args.runId, {
      status: "generated",
      snapshotDate: args.snapshotDate,
      issueId,
      storyCount: args.storyCount,
      topStoryIds: args.topStoryIds,
      qualityScore: args.qualityScore,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      completedAt: now,
      errorMessage: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("newsletterSendLogs", {
      runDate: args.runDate,
      issueId,
      provider: "resend",
      status: args.sendEnabled ? "queued" : "skipped",
      errorMessage: args.sendEnabled
        ? undefined
        : "Awaiting editorial review or sending disabled",
      createdAt: now,
    });

    return { issueId, slug };
  },
});

export const markDailyRunSkipped = internalMutation({
  args: {
    runId: v.id("dailyNewsletterRuns"),
    reason: v.string(),
    issueId: v.optional(v.id("newsletterIssues")),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("dailyNewsletterRuns", args.runId);
    const now = Date.now();
    await ctx.db.patch("dailyNewsletterRuns", args.runId, {
      status: "skipped",
      completedAt: now,
      issueId: args.issueId ?? run?.issueId,
      errorMessage: args.reason.slice(0, 1000),
      updatedAt: now,
    });
    return null;
  },
});

export const markDailyRunFailed = internalMutation({
  args: {
    runId: v.id("dailyNewsletterRuns"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch("dailyNewsletterRuns", args.runId, {
      status: "failed",
      completedAt: now,
      errorMessage: args.errorMessage.slice(0, 1000),
      updatedAt: now,
    });
    return null;
  },
});

async function readDailyConfig(
  ctx: ActionCtx,
  args: {
    sendEnabled?: boolean;
    testMode?: boolean;
    maxIndexedArticles?: number;
    maxNewsletterStories?: number;
  },
) {
  const siteUrl =
    (await ctx.runQuery(getSettingRef, { key: "newsletter.siteUrl" })) ??
    env.NEWSLETTER_SITE_URL ??
    "https://symbaiex.com";
  const enabledSetting = await ctx.runQuery(getSettingRef, {
    key: "dailyNewsletter.enabled",
  });
  const testModeSetting = await ctx.runQuery(getSettingRef, {
    key: "dailyNewsletter.testMode",
  });
  const reviewRequiredSetting = await ctx.runQuery(getSettingRef, {
    key: "dailyNewsletter.reviewRequired",
  });
  const weeklyEnabledSetting = await ctx.runQuery(getSettingRef, {
    key: "weeklyNewsletter.enabled",
  });
  const weeklyReviewRequiredSetting = await ctx.runQuery(getSettingRef, {
    key: "weeklyNewsletter.reviewRequired",
  });
  const maxIndexedSetting = await ctx.runQuery(getSettingRef, {
    key: "dailyNewsletter.maxIndexedArticles",
  });
  const maxStoriesSetting = await ctx.runQuery(getSettingRef, {
    key: "dailyNewsletter.maxNewsletterStories",
  });
  const timeZone =
    (await ctx.runQuery(getSettingRef, { key: "dailyNewsletter.timeZone" })) ??
    DEFAULT_TIME_ZONE;

  return {
    siteUrl: normalizeSiteUrl(siteUrl),
    timeZone,
    sendEnabled:
      args.sendEnabled ??
      (enabledSetting === null ? true : enabledSetting !== "false"),
    testMode:
      args.testMode ??
      (testModeSetting === null ? false : testModeSetting === "true"),
    reviewRequired:
      reviewRequiredSetting === null
        ? false
        : reviewRequiredSetting !== "false",
    weeklyEnabled:
      weeklyEnabledSetting === null ? true : weeklyEnabledSetting !== "false",
    weeklyReviewRequired:
      weeklyReviewRequiredSetting === null
        ? false
        : weeklyReviewRequiredSetting !== "false",
    maxIndexedArticles: clampNumber(
      args.maxIndexedArticles ?? numberFromSetting(maxIndexedSetting),
      5,
      100,
      DEFAULT_MAX_INDEXED_ARTICLES,
    ),
    maxNewsletterStories: clampNumber(
      args.maxNewsletterStories ?? numberFromSetting(maxStoriesSetting),
      3,
      12,
      DEFAULT_NEWSLETTER_STORIES,
    ),
  };
}

async function readAdminSettings(
  ctx: QueryCtx | MutationCtx,
): Promise<DailyNewsletterAdminSettings> {
  const siteUrl =
    (await getSettingDirect(ctx, "newsletter.siteUrl")) ??
    "https://symbaiex.com";
  const enabledSetting = await getSettingDirect(ctx, "dailyNewsletter.enabled");
  const testModeSetting = await getSettingDirect(
    ctx,
    "dailyNewsletter.testMode",
  );
  const reviewRequiredSetting = await getSettingDirect(
    ctx,
    "dailyNewsletter.reviewRequired",
  );
  const weeklyEnabledSetting = await getSettingDirect(
    ctx,
    "weeklyNewsletter.enabled",
  );
  const weeklyReviewRequiredSetting = await getSettingDirect(
    ctx,
    "weeklyNewsletter.reviewRequired",
  );
  const maxIndexedSetting = await getSettingDirect(
    ctx,
    "dailyNewsletter.maxIndexedArticles",
  );
  const maxStoriesSetting = await getSettingDirect(
    ctx,
    "dailyNewsletter.maxNewsletterStories",
  );
  const timeZoneSetting = await getSettingDirect(
    ctx,
    "dailyNewsletter.timeZone",
  );
  const sendTimeSetting = await getSettingDirect(
    ctx,
    "dailyNewsletter.sendTimeLocal",
  );

  return {
    siteUrl: normalizeSiteUrl(siteUrl),
    timeZone: normalizeTimeZone(timeZoneSetting ?? DEFAULT_TIME_ZONE),
    sendTimeLocal: normalizeSendTime(
      sendTimeSetting ?? DEFAULT_SEND_TIME_LOCAL,
    ),
    enabled: enabledSetting === null ? true : enabledSetting !== "false",
    testMode: testModeSetting === null ? false : testModeSetting === "true",
    reviewRequired:
      reviewRequiredSetting === null
        ? false
        : reviewRequiredSetting !== "false",
    weeklyEnabled:
      weeklyEnabledSetting === null ? true : weeklyEnabledSetting !== "false",
    weeklyReviewRequired:
      weeklyReviewRequiredSetting === null
        ? false
        : weeklyReviewRequiredSetting !== "false",
    maxIndexedArticles: clampNumber(
      numberFromSetting(maxIndexedSetting),
      5,
      100,
      DEFAULT_MAX_INDEXED_ARTICLES,
    ),
    maxNewsletterStories: clampNumber(
      numberFromSetting(maxStoriesSetting),
      3,
      12,
      DEFAULT_NEWSLETTER_STORIES,
    ),
    cron: {
      hnRefreshUtc: "0 11 * * *",
      scheduleCheckUtc: "*/15 * * * *",
      weeklyFieldNoteUtc: "30 13 * * 0",
    },
  };
}

async function getSettingDirect(ctx: QueryCtx | MutationCtx, key: string) {
  const row = await ctx.db
    .query("newsletterSettings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return row?.value ?? null;
}

async function setSettingDirect(ctx: MutationCtx, key: string, value: string) {
  const existing = await ctx.db
    .query("newsletterSettings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch("newsletterSettings", existing._id, { value, updatedAt: now });
  } else {
    await ctx.db.insert("newsletterSettings", { key, value, updatedAt: now });
  }
}

function dateInTimeZone(timestamp: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function normalizeSiteUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "https://symbaiex.com";
    }
    return url.origin;
  } catch {
    return "https://symbaiex.com";
  }
}

function normalizeTimeZone(value: string) {
  const candidate = value.trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(
      Date.now(),
    );
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function normalizeSendTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return DEFAULT_SEND_TIME_LOCAL;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return DEFAULT_SEND_TIME_LOCAL;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function isPastConfiguredSendTime(
  timestamp: number,
  timeZone: string,
  sendTimeLocal: string,
) {
  const [targetHour, targetMinute] = sendTimeLocal.split(":").map(Number);
  const current = timePartsInZone(timestamp, timeZone);
  return current.hour * 60 + current.minute >= targetHour * 60 + targetMinute;
}

function timePartsInZone(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0,
  );
  return { hour, minute };
}

function numberFromSetting(value: string | null) {
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 1000)
    : "Unknown error";
}
