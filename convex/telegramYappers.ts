import { createThread } from "@convex-dev/agent";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  env,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { telegramBotRegistry } from "../lib/telegram-agent-policy";
import {
  YAPPERS_TOPIC_ID,
  YAPPERS_FOLLOWUP_DELAY_MS,
  yapPrompt,
  yapSlot,
} from "../lib/telegram-yappers";
import { telegramWorkflow } from "./telegramAgentWorkflow";

export function yappersEnabled() {
  return (
    env.TELEGRAM_YAPPERS_ENABLED === "true" &&
    env.TELEGRAM_YAPPERS_TOPIC_ID === String(YAPPERS_TOPIC_ID) &&
    env.TELEGRAM_AGENTS_ENABLED === "true" &&
    env.ELIZA_RUNTIME_MODE === "live"
  );
}

export function validYap(row: Doc<"telegramAgentRequests">, now: number) {
  return (
    yappersEnabled() &&
    row.topicId === YAPPERS_TOPIC_ID &&
    row.kind === "yap" &&
    typeof row.yapDay === "string" &&
    (row.yapRound === 0 || row.yapRound === 1) &&
    (row.yapTurn === 0 || row.yapTurn === 1) &&
    now >= row.createdAt &&
    now - row.createdAt < 8 * 60_000 &&
    yapSlot(now, true)?.day === row.yapDay
  );
}

async function enqueue(
  ctx: MutationCtx,
  day: string,
  round: number,
  parent?: Doc<"telegramAgentRequests">,
) {
  if (!yappersEnabled()) return null;
  const now = Date.now();
  const turn = parent ? 1 : 0;
  const key = `yap:${day}:${round}:${turn}`;
  if (
    await ctx.db
      .query("telegramAgentRequests")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique()
  )
    return null;
  const registry = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS);
  const agents: Array<{ slug: string; name: string }> = [];
  for (const slug of [...registry.keys()].sort()) {
    const agent = await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (agent?.enabled && slug !== parent?.agentSlug)
      agents.push({ slug, name: agent.name });
  }
  if (!agents.length) return null;
  const rotation =
    Math.floor(Date.parse(`${day}T12:00:00Z`) / 86_400_000) * 2 + round;
  const agent = agents[rotation % agents.length];
  const bot = registry.get(agent.slug)!;
  const conversationId =
    parent?.conversationId ??
    (await createThread(ctx, components.agent, {
      title: `Yappers ${day} round ${round + 1}`,
      summary:
        "Only confirmed autonomous agent posts from this public Yappers round. No member or private history.",
    }));
  const requestId = await ctx.db.insert("telegramAgentRequests", {
    key,
    agentSlug: agent.slug,
    botId: bot.id,
    updateId: now,
    messageId: 0,
    topicId: YAPPERS_TOPIC_ID,
    senderId: "autonomous-yappers",
    conversationId,
    kind: "yap",
    yapDay: day,
    yapRound: round,
    yapTurn: turn,
    prompt: yapPrompt(day, round, !!parent),
    status: "queued",
    createdAt: now,
    updatedAt: now,
  });
  await telegramWorkflow.start(ctx, internal.telegramAgentWorkflow.reply, {
    requestId,
  });
  await ctx.scheduler.runAfter(8 * 60_000, internal.telegramYappers.expire, {
    requestId,
  });
  return requestId;
}

export const start = internalMutation({
  args: { kickoff: v.optional(v.boolean()) },
  returns: v.union(v.id("telegramAgentRequests"), v.null()),
  handler: async (ctx, args) => {
    const slot = yapSlot(Date.now(), args.kickoff === true);
    return slot ? await enqueue(ctx, slot.day, slot.round) : null;
  },
});

export const followup = internalMutation({
  args: { requestId: v.id("telegramAgentRequests") },
  returns: v.union(v.id("telegramAgentRequests"), v.null()),
  handler: async (ctx, { requestId }) => {
    const row = await ctx.db.get("telegramAgentRequests", requestId);
    if (
      !row ||
      row.kind !== "yap" ||
      row.yapTurn !== 0 ||
      row.status !== "sent" ||
      !row.yapDay ||
      row.yapRound === undefined ||
      Date.now() - row.updatedAt < YAPPERS_FOLLOWUP_DELAY_MS ||
      Date.now() - row.updatedAt > YAPPERS_FOLLOWUP_DELAY_MS + 5 * 60_000 ||
      yapSlot(Date.now(), true)?.day !== row.yapDay
    )
      return null;
    return await enqueue(ctx, row.yapDay, row.yapRound, row);
  },
});

export const expire = internalMutation({
  args: { requestId: v.id("telegramAgentRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const row = await ctx.db.get("telegramAgentRequests", requestId);
    if (
      row?.kind === "yap" &&
      !["sent", "held"].includes(row.status) &&
      Date.now() - row.createdAt >= 8 * 60_000
    )
      await ctx.runMutation(internal.telegramAgents.finish, {
        requestId,
        reason: "yap_expired_unconfirmed",
      });
    return null;
  },
});

export const inspect = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      key: v.string(),
      agent: v.string(),
      topicId: v.number(),
      status: v.string(),
      messageId: v.optional(v.number()),
      reason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) =>
    (
      await ctx.db
        .query("telegramAgentRequests")
        .withIndex("by_kind_and_createdAt", (q) => q.eq("kind", "yap"))
        .order("desc")
        .take(12)
    ).map((r) => ({
      key: r.key,
      agent: r.agentSlug,
      topicId: r.topicId,
      status: r.status,
      messageId: r.sentMessageId,
      reason: r.reason,
    })),
});
