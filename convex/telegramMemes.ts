import { memesEnabled, validMeme } from "./telegramMemePolicy";
export { memesEnabled, validMeme } from "./telegramMemePolicy";
import { startMemeV2 } from "./telegramMemeData";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { createThread } from "@convex-dev/agent";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { env, internalMutation, internalQuery } from "./_generated/server";
import { telegramBotRegistry } from "../lib/telegram-agent-policy";
import {
  MEME_TOPIC_ID,
  MEME_INTERVAL_MS,
  memePrompt,
  memeFingerprint,
} from "../lib/telegram-memes";
import { telegramWorkflow } from "./telegramAgentWorkflow";
const cadence = new RateLimiter(components.rateLimiter, {
  belleMemes: {
    kind: "token bucket",
    rate: 1,
    period: MEME_INTERVAL_MS,
    capacity: 1,
  },
});

export const start = internalMutation({
  args: {},
  returns: v.union(v.id("telegramAgentRequests"), v.null()),
  handler: async (ctx) => {
    if (!memesEnabled()) return null;
    if (env.TELEGRAM_MEMES_PIPELINE_VERSION === "2")
      return await startMemeV2(ctx);
    const now = Date.now(),
      slot = Math.floor(now / MEME_INTERVAL_MS),
      key = `meme:${slot}`;
    const bot = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).get("belle");
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", "belle"))
      .unique();
    if (
      !bot ||
      !agent?.enabled ||
      (await ctx.db
        .query("telegramAgentRequests")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique())
    )
      return null;
    const config = await ctx.db
      .query("telegramMemeConfig")
      .withIndex("by_key", (q) => q.eq("key", "belle"))
      .unique();
    if (!config) return null;
    // Durable component quota keeps manual starts and timer ticks on one cadence.
    // Seed from the last queued slot when upgrading an already-running schedule.
    if (
      config.lastQueuedAt !== undefined &&
      now - config.lastQueuedAt < MEME_INTERVAL_MS
    )
      return null;
    if (
      !(await cadence.limit(ctx, "belleMemes", { key: "community:13:belle" }))
        .ok
    )
      return null;
    let threadId = config.threadId;
    if (!threadId) {
      threadId = await createThread(ctx, components.agent, {
        title: "Belle public meme captions",
        summary:
          "Only confirmed autonomous public meme captions. No member messages, private chats or moderation history.",
      });
    }
    await ctx.db.patch("telegramMemeConfig", config._id, {
      threadId,
      lastQueuedAt: now,
    });
    const requestId = await ctx.db.insert("telegramAgentRequests", {
      key,
      agentSlug: "belle",
      botId: bot.id,
      updateId: now,
      messageId: 0,
      topicId: MEME_TOPIC_ID,
      senderId: "autonomous-memes",
      conversationId: threadId,
      kind: "meme",
      memeSlot: slot,
      prompt: memePrompt(slot),
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    await telegramWorkflow.start(ctx, internal.telegramAgentWorkflow.reply, {
      requestId,
    });
    await ctx.scheduler.runAfter(8 * 60_000, internal.telegramMemes.expire, {
      requestId,
    });
    return requestId;
  },
});
export const art = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const config = await ctx.db
      .query("telegramMemeConfig")
      .withIndex("by_key", (q) => q.eq("key", "belle"))
      .unique();
    return config ? await ctx.storage.getUrl(config.storageId) : null;
  },
});
export const setArt = internalMutation({
  args: { storageId: v.id("_storage") },
  returns: v.id("_storage"),
  handler: async (ctx, { storageId }) => {
    const prior = await ctx.db
      .query("telegramMemeConfig")
      .withIndex("by_key", (q) => q.eq("key", "belle"))
      .unique();
    if (prior) return prior.storageId;
    await ctx.db.insert("telegramMemeConfig", { key: "belle", storageId });
    return storageId;
  },
});
export const reserveCaption = internalMutation({
  args: { requestId: v.id("telegramAgentRequests"), text: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { requestId, text }) => {
    const row = await ctx.db.get("telegramAgentRequests", requestId);
    if (!row || !validMeme(row, Date.now()) || row.status !== "generating")
      return false;
    const key = memeFingerprint(text);
    if (
      await ctx.db
        .query("telegramMemeFingerprints")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique()
    )
      return false;
    await ctx.db.insert("telegramMemeFingerprints", { key, requestId });
    return true;
  },
});
export const expire = internalMutation({
  args: { requestId: v.id("telegramAgentRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const row = await ctx.db.get("telegramAgentRequests", requestId);
    if (
      row?.kind === "meme" &&
      !["sent", "held"].includes(row.status) &&
      Date.now() - row.createdAt >= 8 * 60_000
    )
      await ctx.runMutation(internal.telegramAgents.finish, {
        requestId,
        reason: "meme_execution_unconfirmed",
      });
    return null;
  },
});
export const inspect = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      key: v.string(),
      status: v.string(),
      topicId: v.number(),
      messageId: v.optional(v.number()),
      reason: v.optional(v.string()),
      mode: v.optional(v.string()),
      version: v.optional(v.number()),
      fallbackReason: v.optional(v.string()),
      review: v.optional(
        v.object({ approved: v.boolean(), issues: v.array(v.string()) }),
      ),
    }),
  ),
  handler: async (ctx) =>
    (
      await ctx.db
        .query("telegramAgentRequests")
        .withIndex("by_kind_and_createdAt", (q) => q.eq("kind", "meme"))
        .order("desc")
        .take(8)
    ).map((r) => ({
      key: r.key,
      status: r.status,
      topicId: r.topicId,
      messageId: r.sentMessageId,
      reason: r.reason,
      mode: r.memeMode,
      version: r.memeVersion,
      fallbackReason: r.memeFallbackReason,
      review: r.memeReview,
    })),
});

export const uploadUrl = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const isV2 = internalQuery({
  args: { requestId: v.id("telegramAgentRequests") },
  returns: v.boolean(),
  handler: async (ctx, { requestId }) => {
    const row = await ctx.db.get("telegramAgentRequests", requestId);
    return row?.kind === "meme" && row.memeVersion === 2;
  },
});
