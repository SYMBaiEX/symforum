import { createThread, saveMessages } from "@convex-dev/agent";
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import {
  telegramBotRegistry,
  TELEGRAM_COMMUNITY_ID,
} from "../lib/telegram-agent-policy";
import { components, internal } from "./_generated/api";
import { env, internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { telegramWorkflow } from "./telegramAgentWorkflow";
import { telegramRequestKind } from "./telegramAgentSchema";
import { FORUM_AGENT_ROSTER } from "./forumAgentRoster";
import type { MenuAgent } from "../lib/telegram-community";
import { validMeme } from "./telegramMemes";
import { validYap } from "./telegramYappers";
import { YAPPERS_FOLLOWUP_DELAY_MS } from "../lib/telegram-yappers";

function specialty(slug: string) {
  return (
    FORUM_AGENT_ROSTER.find((a) => a.slug === slug)?.title.replace(
      /^AI Agent · /,
      "",
    ) ??
    {
      suki: "Community guide",
      belle: "News & explainers",
      nyx: "Research synthesis",
    }[slug] ??
    "Forum agent"
  );
}

const limiter = new RateLimiter(components.rateLimiter, {
  telegramMenuSender: {
    kind: "token bucket",
    rate: 4,
    period: MINUTE,
    capacity: 3,
  },
  telegramMenuCommunity: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 5,
  },
  telegramSender: { kind: "token bucket", rate: 5, period: HOUR, capacity: 3 },
  telegramCommunity: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 3,
  },
  telegramHelp: {
    kind: "token bucket",
    rate: 20,
    period: MINUTE,
    capacity: 20,
  },
});
const requestArgs = {
  agentSlug: v.string(),
  botId: v.string(),
  updateId: v.number(),
  messageId: v.number(),
  topicId: v.number(),
  senderId: v.string(),
  text: v.string(),
  kind: telegramRequestKind,
  sourceAgentSlug: v.optional(v.string()),
};

export const accept = internalMutation({
  args: requestArgs,
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const registry = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS);
    const bot = registry.get(args.agentSlug);
    if (
      env.TELEGRAM_AGENTS_ENABLED !== "true" ||
      env.ELIZA_RUNTIME_MODE !== "live" ||
      ["yap", "meme"].includes(args.kind) ||
      !bot ||
      bot.id !== args.botId ||
      !Number.isSafeInteger(args.updateId) ||
      args.updateId < 0 ||
      args.text.length > 1400 ||
      !Number.isSafeInteger(args.topicId) ||
      args.topicId < 0 ||
      args.topicId === 7 ||
      !Number.isSafeInteger(args.messageId) ||
      args.messageId < 1 ||
      !/^\d{1,16}$/.test(args.senderId) ||
      (args.kind === "prompt"
        ? !args.sourceAgentSlug ||
          !registry.has(args.sourceAgentSlug) ||
          args.text !== ""
        : args.sourceAgentSlug !== undefined)
    )
      return false;
    const source = args.sourceAgentSlug
      ? registry.get(args.sourceAgentSlug)!
      : bot;
    const key = `${source.id}:${args.updateId}`;
    if (
      await ctx.db
        .query("telegramAgentRequests")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique()
    )
      return false;
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", args.agentSlug))
      .unique();
    if (!agent?.enabled) return false;
    if (
      args.sourceAgentSlug &&
      !(
        await ctx.db
          .query("forumAgents")
          .withIndex("by_slug", (q) => q.eq("slug", args.sourceAgentSlug!))
          .unique()
      )?.enabled
    )
      return false;
    if (
      ["menu", "prompt"].includes(args.kind) &&
      (!(await limiter.limit(ctx, "telegramMenuSender", { key: args.senderId }))
        .ok ||
        !(
          await limiter.limit(ctx, "telegramMenuCommunity", {
            key: TELEGRAM_COMMUNITY_ID,
          })
        ).ok)
    )
      return false;
    // Shared across identities: switching bots cannot bypass the member limit.
    if (
      args.kind === "ask" &&
      (!(await limiter.limit(ctx, "telegramSender", { key: args.senderId }))
        .ok ||
        !(
          await limiter.limit(ctx, "telegramCommunity", {
            key: TELEGRAM_COMMUNITY_ID,
          })
        ).ok)
    )
      return false;
    if (
      args.kind !== "ask" &&
      !(await limiter.limit(ctx, "telegramHelp", { key: args.senderId })).ok
    )
      return false;
    const conversationKey = `${args.agentSlug}:${TELEGRAM_COMMUNITY_ID}:${args.topicId}:${args.senderId}`;
    let conversation = await ctx.db
      .query("telegramAgentConversations")
      .withIndex("by_key", (q) => q.eq("key", conversationKey))
      .unique();
    const now = Date.now();
    if (!conversation) {
      const threadId = await createThread(ctx, components.agent, {
        title: `${agent.name} · Telegram topic ${args.topicId}`,
        summary:
          "Telegram community conversation; isolated from forum and direct-message histories.",
      });
      const id = await ctx.db.insert("telegramAgentConversations", {
        key: conversationKey,
        agentSlug: args.agentSlug,
        threadId,
        createdAt: now,
      });
      conversation = await ctx.db.get("telegramAgentConversations", id);
    }
    if (!conversation) throw new Error("telegram_conversation_unavailable");
    const { text, ...fields } = args;
    const requestId = await ctx.db.insert("telegramAgentRequests", {
      ...fields,
      key,
      prompt: text,
      conversationId: conversation.threadId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    await telegramWorkflow.start(ctx, internal.telegramAgentWorkflow.reply, {
      requestId,
    });
    await ctx.scheduler.runAfter(
      7 * 24 * HOUR,
      internal.telegramAgents.redact,
      { requestId },
    );
    return true;
  },
});

const requestIdArgs = { requestId: v.id("telegramAgentRequests") };
type TelegramContext = {
  request: Doc<"telegramAgentRequests">;
  name: string;
  persona: string;
  sources: Array<{ title: string; url: string; text: string }>;
  specialty: string;
  menuAgents: MenuAgent[];
};
export const claim = internalMutation({
  args: requestIdArgs,
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const row = await ctx.db.get("telegramAgentRequests", args.requestId);
    if (
      !row ||
      row.status !== "queued" ||
      env.TELEGRAM_AGENTS_ENABLED !== "true" ||
      env.ELIZA_RUNTIME_MODE !== "live"
    )
      return false;
    if (row.kind === "yap" && !validYap(row, Date.now())) return false;
    if (row.kind === "meme" && !validMeme(row, Date.now())) return false;
    await ctx.db.patch("telegramAgentRequests", row._id, {
      status: "generating",
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const context = internalQuery({
  args: requestIdArgs,
  returns: v.union(
    v.null(),
    v.object({
      request: schema.doc("telegramAgentRequests"),
      name: v.string(),
      persona: v.string(),
      specialty: v.string(),
      menuAgents: v.array(
        v.object({ slug: v.string(), name: v.string(), specialty: v.string() }),
      ),
      sources: v.array(
        v.object({ title: v.string(), url: v.string(), text: v.string() }),
      ),
    }),
  ),
  handler: async (ctx, args): Promise<TelegramContext | null> => {
    const request = await ctx.db.get("telegramAgentRequests", args.requestId);
    if (!request) return null;
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", request.agentSlug))
      .unique();
    if (!agent?.enabled) return null;
    const menuAgents: MenuAgent[] = [];
    if (request.kind === "menu") {
      for (const slug of telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).keys()) {
        const entry = await ctx.db
          .query("forumAgents")
          .withIndex("by_slug", (q) => q.eq("slug", slug))
          .unique();
        if (entry?.enabled)
          menuAgents.push({
            slug,
            name: entry.name,
            specialty: specialty(slug),
          });
      }
    }
    const posts = ["ask", "yap"].includes(request.kind)
      ? await ctx.db
          .query("forumThreads")
          .withIndex("by_authorId_and_status_and_createdAt", (q) =>
            q.eq("authorId", agent.userId).eq("status", "active"),
          )
          .order("desc")
          .take(3)
      : [];
    // Existing visibility gate rechecks private ancestors and moderation state.
    const visible: Array<{
      threadId: Id<"forumThreads">;
      categorySlug: string;
      title: string;
      body: string;
    } | null> = await ctx.runQuery(
      internal.forumAgentEditorialData.readThreadsForMemory,
      { threadIds: posts.map((p) => p._id) },
    );
    return {
      request,
      name: agent.name,
      specialty: specialty(request.agentSlug),
      menuAgents,
      persona: agent.persona.slice(0, 4000),
      sources: visible.flatMap((p) =>
        p
          ? [
              {
                title: p.title.slice(0, 180),
                url: `https://forum.symbaiex.com/${p.categorySlug}/${posts.find((t) => t._id === p.threadId)?.slug ?? ""}`,
                text: p.body.slice(0, 2400),
              },
            ]
          : [],
      ),
    };
  },
});

export const ready = internalMutation({
  args: { ...requestIdArgs, text: v.string(), name: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("telegramAgentRequests", args.requestId);
    if (
      !row ||
      row.status !== "generating" ||
      !args.text.trim() ||
      args.text.length > (row.kind === "yap" ? 1200 : 3000)
    )
      return false;
    if (row.kind === "ask")
      await saveMessages(ctx, components.agent, {
        threadId: row.conversationId,
        agentName: args.name,
        messages: [
          { role: "user", content: row.prompt ?? "" },
          { role: "assistant", content: args.text },
        ],
      });
    await ctx.db.patch("telegramAgentRequests", row._id, {
      status: "ready",
      reply: args.text,
      prompt: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const claimDelivery = internalMutation({
  args: requestIdArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("telegramAgentRequests", args.requestId);
    const agent =
      row &&
      (await ctx.db
        .query("forumAgents")
        .withIndex("by_slug", (q) => q.eq("slug", row.agentSlug))
        .unique());
    if (
      !row ||
      row.status !== "ready" ||
      !agent?.enabled ||
      env.TELEGRAM_AGENTS_ENABLED !== "true"
    )
      return false;
    if (row.kind === "yap" && !validYap(row, Date.now())) return false;
    if (row.kind === "meme" && !validMeme(row, Date.now())) return false;
    await ctx.db.patch("telegramAgentRequests", row._id, {
      status: "sending",
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const finish = internalMutation({
  args: {
    ...requestIdArgs,
    messageId: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("telegramAgentRequests", args.requestId);
    if (!row || row.status === "sent" || row.status === "held") return null;
    const sent = args.messageId !== undefined && row.status === "sending";
    // Only confirmed autonomous posts enter the shared public-round context.
    // Human conversations continue to use their isolated member threads.
    if (sent && row.kind === "meme" && row.reply) {
      await saveMessages(ctx, components.agent, {
        threadId: row.conversationId,
        agentName: "Belle",
        messages: [{ role: "assistant", content: row.reply }],
      });
    }
    if (sent && row.kind === "yap" && row.reply) {
      const agent = await ctx.db
        .query("forumAgents")
        .withIndex("by_slug", (q) => q.eq("slug", row.agentSlug))
        .unique();
      await saveMessages(ctx, components.agent, {
        threadId: row.conversationId,
        agentName: agent?.name ?? row.agentSlug,
        messages: [
          { role: "user", content: row.prompt ?? "" },
          {
            role: "assistant",
            content: `${agent?.name ?? row.agentSlug}: ${row.reply}`,
          },
        ],
      });
      if (row.yapTurn === 0)
        await ctx.scheduler.runAfter(
          YAPPERS_FOLLOWUP_DELAY_MS,
          internal.telegramYappers.followup,
          { requestId: row._id },
        );
    }
    await ctx.db.patch("telegramAgentRequests", row._id, {
      status: sent ? "sent" : "held",
      sentMessageId: args.messageId,
      reason: args.reason?.slice(0, 80),
      prompt: undefined,
      reply: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const redact = internalMutation({
  args: requestIdArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("telegramAgentRequests", args.requestId);
    if (row && row.createdAt <= Date.now() - 7 * 24 * HOUR)
      await ctx.db.patch("telegramAgentRequests", row._id, {
        prompt: undefined,
        reply: undefined,
      });
    return null;
  },
});

export const inspect = internalQuery({
  args: { agentSlug: v.string() },
  returns: v.array(
    v.object({
      status: v.string(),
      updateId: v.number(),
      topicId: v.number(),
      messageId: v.optional(v.number()),
      reason: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query("telegramAgentRequests")
        .withIndex("by_agentSlug_and_createdAt", (q) =>
          q.eq("agentSlug", args.agentSlug),
        )
        .order("desc")
        .take(10)
    ).map((r) => ({
      status: r.status,
      updateId: r.updateId,
      topicId: r.topicId,
      messageId: r.sentMessageId,
      reason: r.reason,
      createdAt: r.createdAt,
    })),
});
