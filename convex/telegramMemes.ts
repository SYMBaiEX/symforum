import { createThread } from "@convex-dev/agent";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { env, internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { telegramBotRegistry } from "../lib/telegram-agent-policy";
import {
  MEME_TOPIC_ID,
  MEME_INTERVAL_MS,
  memePrompt,
  memeFingerprint,
} from "../lib/telegram-memes";
import { telegramWorkflow } from "./telegramAgentWorkflow";
export function memesEnabled() {
  return (
    env.TELEGRAM_MEMES_ENABLED === "true" &&
    env.TELEGRAM_MEMES_TOPIC_ID === String(MEME_TOPIC_ID) &&
    env.TELEGRAM_AGENTS_ENABLED === "true" &&
    env.ELIZA_RUNTIME_MODE === "live"
  );
}
export function validMeme(row: Doc<"telegramAgentRequests">, now: number) {
  return (
    memesEnabled() &&
    row.kind === "meme" &&
    row.agentSlug === "belle" &&
    row.topicId === MEME_TOPIC_ID &&
    typeof row.memeSlot === "number" &&
    row.key === `meme:${row.memeSlot}` &&
    now >= row.createdAt &&
    now - row.createdAt < 8 * 60_000
  );
}
export const start = internalMutation({
  args: {},
  returns: v.union(v.id("telegramAgentRequests"), v.null()),
  handler: async (ctx) => {
    if (!memesEnabled()) return null;
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
    if (
      config.lastQueuedAt !== undefined &&
      now - config.lastQueuedAt < MEME_INTERVAL_MS - 10_000
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
    })),
});

export const uploadUrl = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});
