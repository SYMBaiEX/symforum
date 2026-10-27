import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { currentPublicMemoryThread } from "./forumAgentEditorialData";
import {
  telegramBotRegistry,
  TELEGRAM_COMMUNITY_ID,
} from "../lib/telegram-agent-policy";
import {
  forumDigestSlot,
  renderForumDigest,
  selectForumDigestItems,
  type DigestItem,
} from "../lib/telegram-community";

const WEEK = 7 * 24 * 60 * 60 * 1000;
function configuredTopic() {
  const value = env.TELEGRAM_DIGEST_TOPIC_ID ?? "";
  const id = /^\d{1,10}$/.test(value) ? Number(value) : 0;
  return Number.isSafeInteger(id) && id > 0 && id !== 7 && id !== 85
    ? id
    : null;
}
function enabled() {
  return (
    env.TELEGRAM_DIGEST_ENABLED === "true" &&
    env.TELEGRAM_AGENTS_ENABLED === "true" &&
    !!configuredTopic()
  );
}

/** Only public, currently active source rows can leave this query. */
async function selection(
  ctx: QueryCtx,
  from: number,
  to: number,
): Promise<DigestItem[]> {
  const candidates = await ctx.db
    .query("forumThreadEditorialDigests")
    .withIndex("by_status_and_lastPostAt", (q) =>
      q.eq("status", "active").gte("lastPostAt", from).lt("lastPostAt", to),
    )
    .order("desc")
    .take(64);
  const visible: DigestItem[] = [];
  for (const candidate of candidates) {
    const current = await currentPublicMemoryThread(ctx, candidate.threadId);
    if (!current) continue;
    const thread = await ctx.db.get("forumThreads", candidate.threadId);
    if (!thread || thread.lastPostAt < from || thread.lastPostAt >= to)
      continue;
    const author = await ctx.db.get("users", thread.authorId);
    if (!author) continue;
    visible.push({
      threadId: thread._id,
      title: current.title,
      url: `https://forum.symbaiex.com/${encodeURIComponent(current.categorySlug)}/${encodeURIComponent(thread.slug)}`,
      authorId: thread.authorId,
      authorName: current.authorName,
      isAgent: author.isAgent === true,
      replyCount: Math.max(0, thread.replyCount),
      showcase:
        thread.kind === "showcase" ||
        thread.categorySlug.startsWith("projects"),
      lastPostAt: thread.lastPostAt,
    });
  }
  return selectForumDigestItems(visible);
}

async function queue(
  ctx: MutationCtx,
  key: string,
  now: number,
  preview: boolean,
) {
  const topicId = configuredTopic();
  if (
    !enabled() ||
    !topicId ||
    !telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).has("suki")
  )
    return null;
  const existing = await ctx.db
    .query("telegramForumDigests")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (existing) return null; // Includes uncertain operations: never replay them.
  const digestId = await ctx.db.insert("telegramForumDigests", {
    key,
    topicId,
    from: now - WEEK,
    to: now,
    preview,
    status: "queued",
    threadIds: [],
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.telegramForumDigest.deliver, {
    digestId,
  });
  await ctx.scheduler.runAfter(
    10 * 60_000,
    internal.telegramForumDigest.expire,
    { digestId },
  );
  return digestId;
}

export const queueWeekly = internalMutation({
  args: {},
  returns: v.union(v.id("telegramForumDigests"), v.null()),
  handler: async (ctx) => {
    const now = Date.now();
    const slot = forumDigestSlot(now);
    return slot ? await queue(ctx, `weekly:${slot}`, now, false) : null;
  },
});

export const queuePreview = internalMutation({
  args: { key: v.string() },
  returns: v.union(v.id("telegramForumDigests"), v.null()),
  handler: async (ctx, args) => {
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(args.key))
      throw new Error("invalid_preview_key");
    return await queue(ctx, `preview:${args.key}`, Date.now(), true);
  },
});

export const preview = internalQuery({
  args: { now: v.number() },
  returns: v.object({ text: v.string(), count: v.number() }),
  handler: async (ctx, { now }) => {
    const items = await selection(ctx, now - WEEK, now);
    return {
      text: renderForumDigest(items, now - WEEK, now, true),
      count: items.length,
    };
  },
});

const digestArgs = { digestId: v.id("telegramForumDigests") };
export const claim = internalMutation({
  args: digestArgs,
  returns: v.union(
    v.null(),
    v.object({ text: v.string(), topicId: v.number() }),
  ),
  handler: async (ctx, { digestId }) => {
    const row = await ctx.db.get("telegramForumDigests", digestId);
    if (!row || row.status !== "queued") return null;
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", "suki"))
      .unique();
    if (!enabled() || configuredTopic() !== row.topicId || !agent?.enabled) {
      await ctx.db.patch("telegramForumDigests", row._id, {
        status: "held",
        reason: "configuration_unavailable",
        updatedAt: Date.now(),
      });
      return null;
    }
    // Re-read source visibility and current titles in the delivery claim transaction.
    const items = await selection(ctx, row.from, row.to);
    if (!items.length) {
      await ctx.db.patch("telegramForumDigests", row._id, {
        status: "skipped",
        reason: "no_public_selection",
        updatedAt: Date.now(),
      });
      return null;
    }
    const text = renderForumDigest(items, row.from, row.to, row.preview);
    if (text.length > 3900) throw new Error("digest_too_long");
    await ctx.db.patch("telegramForumDigests", row._id, {
      status: "sending",
      threadIds: items.map((i) => i.threadId as Id<"forumThreads">),
      updatedAt: Date.now(),
    });
    return { text, topicId: row.topicId };
  },
});

export const finish = internalMutation({
  args: { ...digestArgs, messageId: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { digestId, messageId }) => {
    const row = await ctx.db.get("telegramForumDigests", digestId);
    if (row?.status !== "sending") return null;
    await ctx.db.patch("telegramForumDigests", row._id, {
      status: messageId ? "sent" : "held",
      sentMessageId: messageId,
      reason: messageId ? undefined : "delivery_unconfirmed",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const expire = internalMutation({
  args: digestArgs,
  returns: v.null(),
  handler: async (ctx, { digestId }) => {
    const row = await ctx.db.get("telegramForumDigests", digestId);
    if (
      row &&
      ["queued", "sending"].includes(row.status) &&
      row.createdAt <= Date.now() - 10 * 60_000
    )
      await ctx.db.patch("telegramForumDigests", row._id, {
        status: "held",
        reason: "execution_unconfirmed",
        updatedAt: Date.now(),
      });
    return null;
  },
});

export const deliver = internalAction({
  args: digestArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const bot = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).get("suki");
    if (!enabled() || !bot) return null;
    const data = await ctx.runMutation(
      internal.telegramForumDigest.claim,
      args,
    );
    if (!data) return null;
    let messageId: number | undefined;
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${bot.token}/sendMessage`,
        {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            chat_id: TELEGRAM_COMMUNITY_ID,
            message_thread_id: data.topicId,
            text: data.text,
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
          }),
        },
      );
      const body: unknown = await response.json();
      if (
        response.ok &&
        body &&
        typeof body === "object" &&
        "ok" in body &&
        body.ok === true &&
        "result" in body &&
        body.result &&
        typeof body.result === "object" &&
        "message_id" in body.result &&
        typeof body.result.message_id === "number" &&
        "message_thread_id" in body.result &&
        body.result.message_thread_id === data.topicId &&
        "chat" in body.result &&
        body.result.chat &&
        typeof body.result.chat === "object" &&
        "id" in body.result.chat &&
        String(body.result.chat.id) === TELEGRAM_COMMUNITY_ID
      )
        messageId = body.result.message_id;
    } catch {
      /* A possibly delivered request must remain held, never retried. */
    }
    await ctx.runMutation(internal.telegramForumDigest.finish, {
      ...args,
      ...(messageId ? { messageId } : {}),
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
      sentMessageId: v.optional(v.number()),
      reason: v.optional(v.string()),
      count: v.number(),
    }),
  ),
  handler: async (ctx) =>
    (
      await ctx.db
        .query("telegramForumDigests")
        .withIndex("by_createdAt")
        .order("desc")
        .take(10)
    ).map((row: Doc<"telegramForumDigests">) => ({
      key: row.key,
      status: row.status,
      topicId: row.topicId,
      sentMessageId: row.sentMessageId,
      reason: row.reason,
      count: row.threadIds.length,
    })),
});
