import { getAuthUserId } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

type NewsStory = Pick<
  Doc<"hnStories">,
  | "hnItemId"
  | "rank"
  | "title"
  | "url"
  | "host"
  | "by"
  | "text"
  | "score"
  | "descendants"
  | "timePosted"
>;

type DailyStory = {
  hnItemId: number;
  rank: number;
  title: string;
  host?: string;
  by?: string;
  score?: number;
  comments?: number;
  sourceUrl?: string;
  siteUrl: string;
  summary: string;
  theme: string;
  relevanceScore: number;
};

type DailyQuote = {
  quoteKey: string;
  quote: string;
  author: string;
  source: string;
  sourceUrl?: string;
  reflection: string;
};

type DailyNewsletterPayload = {
  kind: "daily-news";
  version: 1;
  runDate: string;
  snapshotDate: string;
  generatedAt: number;
  siteUrl: string;
  newsUrl: string;
  intro: string;
  themeLabel: string;
  quote: DailyQuote;
  topStories: DailyStory[];
  additionalStories: DailyStory[];
};

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

const DEFAULT_TIME_ZONE = "America/Chicago";
const DEFAULT_MAX_INDEXED_ARTICLES = 40;
const DEFAULT_NEWSLETTER_STORIES = 8;
const DAILY_CAMPAIGN = "daily_hn_newsletter";

const refreshTopStoriesRef = makeFunctionReference<
  "action",
  { limit?: number },
  { snapshotDate: string; storyCount: number }
>("news:refreshTopStories");

const readIndexedSnapshotRef = makeFunctionReference<
  "query",
  { snapshotDate?: string; limit?: number },
  {
    snapshot: Doc<"newsSnapshots"> | null;
    stories: Doc<"hnStories">[];
  }
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

const selectDailyQuoteRef = makeFunctionReference<
  "mutation",
  {
    runDate: string;
    themeLabel: string;
  },
  DailyQuote
>("dailyNewsletter:selectDailyQuote");

const upsertDailyIssueRef = makeFunctionReference<
  "mutation",
  {
    runId: Id<"dailyNewsletterRuns">;
    runDate: string;
    snapshotDate: string;
    subject: string;
    previewText: string;
    payloadJson: string;
    storyCount: number;
    topStoryIds: number[];
    sendEnabled: boolean;
  },
  { issueId: Id<"newsletterIssues">; slug: string }
>("dailyNewsletter:upsertDailyIssue");

const markDailyRunSkippedRef = makeFunctionReference<
  "mutation",
  {
    runId: Id<"dailyNewsletterRuns">;
    reason: string;
    issueId?: Id<"newsletterIssues">;
  },
  null
>("dailyNewsletter:markDailyRunSkipped");

const markDailyRunFailedRef = makeFunctionReference<
  "mutation",
  {
    runId: Id<"dailyNewsletterRuns">;
    errorMessage: string;
  },
  null
>("dailyNewsletter:markDailyRunFailed");

const quoteBank = [
  {
    quoteKey: "edison-perspiration",
    quote: "Genius is one percent inspiration and ninety-nine percent perspiration.",
    author: "Thomas Edison",
    source: "Quote Investigator review of the Edison attribution",
  },
  {
    quoteKey: "kay-invent-future",
    quote: "The best way to predict the future is to invent it.",
    author: "Alan Kay",
    source: "Quote Investigator, Xerox PARC and InfoWorld attribution",
  },
  {
    quoteKey: "hopper-dangerous-phrase",
    quote: "The most dangerous phrase in the language is, 'We've always done it this way.'",
    author: "Grace Hopper",
    source: "Quote Investigator, 1976 Hopper attribution",
  },
  {
    quoteKey: "feynman-create-understand",
    quote: "What I cannot create, I do not understand.",
    author: "Richard Feynman",
    source: "Caltech Archives blackboard note, 1988",
  },
  {
    quoteKey: "lovelace-analytical-engine",
    quote: "The Analytical Engine weaves algebraic patterns, just as the Jacquard loom weaves flowers and leaves.",
    author: "Ada Lovelace",
    source: "notes on the Analytical Engine, 1843",
  },
  {
    quoteKey: "jobs-real-artists",
    quote: "Real artists ship.",
    author: "Steve Jobs",
    source: "attributed in accounts of early Macintosh development",
  },
  {
    quoteKey: "musk-important-enough",
    quote: "When something is important enough, you do it even if the odds are not in your favor.",
    author: "Elon Musk",
    source: "public interviews and talks",
  },
  {
    quoteKey: "tesla-future-worked",
    quote: "The present is theirs; the future, for which I really worked, is mine.",
    author: "Nikola Tesla",
    source: "attributed in Tesla interviews and essays",
  },
  {
    quoteKey: "fuller-change-model",
    quote: "To change something, build a new model that makes the existing model obsolete.",
    author: "Buckminster Fuller",
    source: "attributed in Buckminster Fuller lectures",
  },
] as const;

const themeDefinitions = [
  {
    key: "ai",
    label: "AI systems",
    words: [
      "ai",
      "agent",
      "agents",
      "llm",
      "model",
      "models",
      "inference",
      "openai",
      "anthropic",
      "neural",
      "automation",
    ],
  },
  {
    key: "developer-tools",
    label: "developer tools",
    words: [
      "developer",
      "developers",
      "programming",
      "compiler",
      "runtime",
      "typescript",
      "javascript",
      "python",
      "rust",
      "database",
      "framework",
      "tool",
      "tools",
      "api",
    ],
  },
  {
    key: "security",
    label: "security",
    words: [
      "security",
      "vulnerability",
      "exploit",
      "breach",
      "privacy",
      "auth",
      "encryption",
      "secure",
      "malware",
    ],
  },
  {
    key: "startups",
    label: "startups",
    words: [
      "startup",
      "startups",
      "yc",
      "funding",
      "founder",
      "company",
      "product",
      "hiring",
      "growth",
    ],
  },
  {
    key: "systems",
    label: "systems",
    words: [
      "linux",
      "kernel",
      "network",
      "distributed",
      "database",
      "performance",
      "architecture",
      "server",
      "memory",
      "compute",
    ],
  },
  {
    key: "hardware",
    label: "hardware",
    words: [
      "chip",
      "hardware",
      "gpu",
      "cpu",
      "robot",
      "raspberry",
      "device",
      "semiconductor",
    ],
  },
  {
    key: "science",
    label: "science",
    words: [
      "science",
      "research",
      "paper",
      "math",
      "physics",
      "biology",
      "space",
      "climate",
    ],
  },
] as const;

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
    const sendEnabled = args.sendEnabled ?? config.sendEnabled;

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
      const refreshed = await ctx.runAction(refreshTopStoriesRef, {
        limit: config.maxIndexedArticles,
      });
      const indexed = await ctx.runQuery(readIndexedSnapshotRef, {
        snapshotDate: refreshed.snapshotDate,
        limit: config.maxIndexedArticles,
      });

      if (indexed.snapshot === null || indexed.stories.length === 0) {
        throw new Error("No indexed Hacker News stories were available");
      }

      const ranked = rankStories(indexed.stories);
      const selected = ranked.slice(0, config.maxNewsletterStories);
      const topStories = selected.slice(0, 3);
      const additionalStories = selected.slice(3, 8);
      const themeLabel = themeLabelForStories(indexed.stories);
      const quote = await ctx.runMutation(selectDailyQuoteRef, {
        runDate,
        themeLabel,
      });
      const siteUrl = config.siteUrl;
      const newsUrl = withUtm(`${siteUrl}/news`, runDate);
      const intro = introForThemes(themeLabel);
      const payload: DailyNewsletterPayload = {
        kind: "daily-news",
        version: 1,
        runDate,
        snapshotDate: indexed.snapshot.snapshotDate,
        generatedAt: Date.now(),
        siteUrl,
        newsUrl,
        intro,
        themeLabel,
        quote,
        topStories: topStories.map((story) => storyForPayload(story, siteUrl, runDate)),
        additionalStories: additionalStories.map((story) =>
          storyForPayload(story, siteUrl, runDate),
        ),
      };
      const subject = subjectForDate(runDate, themeLabel);
      const previewText = `${intro} Top stories: ${topStories
        .map((story) => story.title)
        .join(" / ")
        .slice(0, 140)}`;
      const issue = await ctx.runMutation(upsertDailyIssueRef, {
        runId: start.runId,
        runDate,
        snapshotDate: indexed.snapshot.snapshotDate,
        subject,
        previewText,
        payloadJson: JSON.stringify(payload),
        storyCount: indexed.stories.length,
        topStoryIds: selected.map((story) => story.hnItemId),
        sendEnabled,
      });

      if (!sendEnabled || config.testMode || mode === "test") {
        await ctx.runMutation(markDailyRunSkippedRef, {
          runId: start.runId,
          reason: "Daily newsletter sending is disabled or in test mode",
          issueId: issue.issueId,
        });
        return {
          ok: true,
          skipped: true,
          runId: start.runId,
          issueId: issue.issueId,
          runDate,
          snapshotDate: indexed.snapshot.snapshotDate,
          storyCount: indexed.stories.length,
          topStoryIds: selected.map((story) => story.hnItemId),
          reason: "send-disabled",
        };
      }

      await ctx.runAction(sendIssueRef, { issueId: issue.issueId });

      return {
        ok: true,
        runId: start.runId,
        issueId: issue.issueId,
        runDate,
        snapshotDate: indexed.snapshot.snapshotDate,
        storyCount: indexed.stories.length,
        topStoryIds: selected.map((story) => story.hnItemId),
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

export const queueAdminDailyNewsletter = mutation({
  args: {
    runDate: v.optional(v.string()),
    force: v.optional(v.boolean()),
    sendEnabled: v.optional(v.boolean()),
    testMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
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
    await requireOwner(ctx);
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
    await requireOwner(ctx);
    const runDate = args.runDate;
    if (runDate) {
      return await ctx.db
        .query("newsletterSendLogs")
        .withIndex("by_runDate_and_createdAt", (q) =>
          q.eq("runDate", runDate),
        )
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
      if (recentRunning) {
        return {
          ok: true,
          runId: existing._id,
          skipped: true,
          reason: "Daily newsletter run already in progress",
        };
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
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
      storyCount: 0,
      topStoryIds: [],
      updatedAt: args.startedAt,
    });
    return { ok: true, runId, skipped: false };
  },
});

export const selectDailyQuote = internalMutation({
  args: {
    runDate: v.string(),
    themeLabel: v.string(),
  },
  handler: async (ctx, args): Promise<DailyQuote> => {
    const existing = await ctx.db
      .query("dailyQuotes")
      .withIndex("by_usedDate", (q) => q.eq("usedDate", args.runDate))
      .unique();
    if (existing) {
      return {
        quoteKey: existing.quoteKey,
        quote: existing.quote,
        author: existing.author,
        source: existing.source,
        sourceUrl: existing.sourceUrl,
        reflection: existing.reflection,
      };
    }

    const recentlyUsed = new Set<string>();
    for (const quote of quoteBank) {
      const recent = await ctx.db
        .query("dailyQuotes")
        .withIndex("by_quoteKey_and_usedAt", (q) =>
          q.eq("quoteKey", quote.quoteKey),
        )
        .order("desc")
        .take(1);
      if (recent[0] && Date.now() - recent[0].usedAt < 14 * 24 * 60 * 60 * 1000) {
        recentlyUsed.add(quote.quoteKey);
      }
    }

    const available = quoteBank.filter(
      (quote) => !recentlyUsed.has(quote.quoteKey),
    );
    const pool = available.length > 0 ? available : [...quoteBank];
    const quote = pool[hashString(args.runDate) % pool.length];
    const reflection = reflectionForQuote(args.themeLabel);

    await ctx.db.insert("dailyQuotes", {
      quoteKey: quote.quoteKey,
      quote: quote.quote,
      author: quote.author,
      source: quote.source,
      reflection,
      usedDate: args.runDate,
      usedAt: Date.now(),
    });

    return {
      quoteKey: quote.quoteKey,
      quote: quote.quote,
      author: quote.author,
      source: quote.source,
      reflection,
    };
  },
});

export const upsertDailyIssue = internalMutation({
  args: {
    runId: v.id("dailyNewsletterRuns"),
    runDate: v.string(),
    snapshotDate: v.string(),
    subject: v.string(),
    previewText: v.string(),
    payloadJson: v.string(),
    storyCount: v.number(),
    topStoryIds: v.array(v.number()),
    sendEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const slug = `daily-signal-${args.runDate}`;
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
      await ctx.db.patch(issueId, {
        subject: args.subject,
        previewText: args.previewText.slice(0, 240),
        body: args.payloadJson,
        status: args.sendEnabled ? "scheduled" : "draft",
        scheduledAt: args.sendEnabled ? now : undefined,
        errorMessage: undefined,
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.runId, {
      status: "generated",
      snapshotDate: args.snapshotDate,
      issueId,
      storyCount: args.storyCount,
      topStoryIds: args.topStoryIds,
      completedAt: now,
      errorMessage: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("newsletterSendLogs", {
      runDate: args.runDate,
      issueId,
      provider: "resend",
      status: args.sendEnabled ? "queued" : "skipped",
      errorMessage: args.sendEnabled ? undefined : "Daily sending disabled",
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
    const run = await ctx.db.get(args.runId);
    const now = Date.now();
    await ctx.db.patch(args.runId, {
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
    await ctx.db.patch(args.runId, {
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
    process.env.NEWSLETTER_SITE_URL ??
    "https://symbaiex.com";
  const enabledSetting = await ctx.runQuery(getSettingRef, {
    key: "dailyNewsletter.enabled",
  });
  const testModeSetting = await ctx.runQuery(getSettingRef, {
    key: "dailyNewsletter.testMode",
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

function rankStories(stories: NewsStory[]) {
  return stories
    .map((story) => {
      const theme = themeForStory(story);
      const title = story.title.toLowerCase();
      const themeScore = themeDefinitions.reduce(
        (total, definition) =>
          total +
          definition.words.reduce(
            (sum, word) => sum + (title.includes(word) ? 1 : 0),
            0,
          ),
        0,
      );
      const rankScore = Math.max(0, 50 - story.rank) * 2;
      const popularityScore = (story.score ?? 0) / 12;
      const discussionScore = (story.descendants ?? 0) / 8;
      const sourceBonus = story.url ? 5 : 0;
      const relevanceScore =
        rankScore + popularityScore + discussionScore + themeScore * 7 + sourceBonus;

      return {
        ...story,
        comments: story.descendants,
        relevanceScore,
        theme,
        summary: summaryForStory(story, theme),
      };
    })
    .sort((left, right) => {
      const scoreDelta = right.relevanceScore - left.relevanceScore;
      return scoreDelta !== 0 ? scoreDelta : left.rank - right.rank;
    });
}

function themeLabelForStories(stories: NewsStory[]) {
  const scores = themeDefinitions.map((definition) => {
    const score = stories.reduce((total, story) => {
      const text = `${story.title} ${story.host ?? ""}`.toLowerCase();
      return (
        total +
        definition.words.reduce(
          (sum, word) => sum + (text.includes(word) ? 1 : 0),
          0,
        )
      );
    }, 0);
    return { label: definition.label, score };
  });
  const top = scores
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((row) => row.label);

  if (top.length === 0) {
    return "software, systems, and internet culture";
  }
  if (top.length === 1) {
    return top[0];
  }
  if (top.length === 2) {
    return `${top[0]} and ${top[1]}`;
  }
  return `${top[0]}, ${top[1]}, and ${top[2]}`;
}

function themeForStory(story: NewsStory) {
  const text = `${story.title} ${story.host ?? ""}`.toLowerCase();
  const match = themeDefinitions
    .map((definition) => ({
      label: definition.label,
      score: definition.words.reduce(
        (sum, word) => sum + (text.includes(word) ? 1 : 0),
        0,
      ),
    }))
    .sort((left, right) => right.score - left.score)[0];
  return match && match.score > 0 ? match.label : "technology";
}

function summaryForStory(story: NewsStory, theme: string) {
  const host = story.host ?? "news.ycombinator.com";
  const discussion =
    typeof story.descendants === "number" && story.descendants > 0
      ? ` with ${story.descendants} HN comments`
      : "";
  return `A signal on ${theme} from ${host}${discussion}. Open the SYMBaiEX index for the source link, saves, and discussion.`;
}

function storyForPayload(
  story: ReturnType<typeof rankStories>[number],
  siteUrl: string,
  runDate: string,
): DailyStory {
  return {
    hnItemId: story.hnItemId,
    rank: story.rank,
    title: story.title,
    host: story.host,
    by: story.by,
    score: story.score,
    comments: story.comments,
    sourceUrl: story.url,
    siteUrl: withUtm(`${siteUrl}${newsStoryPath(story)}`, runDate),
    summary: story.summary,
    theme: story.theme,
    relevanceScore: Math.round(story.relevanceScore * 10) / 10,
  };
}

function newsStoryPath(story: { hnItemId: number; title: string }) {
  return `/news/${slugifyNewsTitle(story.title)}-${story.hnItemId}`;
}

function slugifyNewsTitle(title: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 88)
    .replace(/-+$/g, "");

  return slug || "story";
}

function withUtm(url: string, runDate: string) {
  const nextUrl = new URL(url);
  nextUrl.searchParams.set("utm_source", "newsletter");
  nextUrl.searchParams.set("utm_medium", "email");
  nextUrl.searchParams.set("utm_campaign", DAILY_CAMPAIGN);
  nextUrl.searchParams.set("utm_content", runDate);
  return nextUrl.toString();
}

function subjectForDate(runDate: string, themeLabel: string) {
  const date = new Date(`${runDate}T12:00:00.000Z`);
  const label = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  return `The Morning Signal from SYMBaiEX - ${label}: ${themeLabel}`;
}

function introForThemes(themeLabel: string) {
  return `Hey there, today's signal is heavy on ${themeLabel}. The daily index is live on SYMBaiEX, with the source trail, comments, saves, and room to branch the conversation.`;
}

function reflectionForQuote(themeLabel: string) {
  return `Today's signal: work around ${themeLabel} rarely arrives as one clean breakthrough. It gets noticed, shaped, shipped, argued with, and improved in public.`;
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

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : "Unknown error";
}

async function requireOwner(ctx: MutationCtx | QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  const user = await ctx.db.get(userId);
  if (user?.role !== "owner") {
    throw new Error("Unauthorized");
  }
  return user;
}
