import { installation, installationBinding, installationMatches } from "./installation";
import { RateLimiter } from "@convex-dev/rate-limiter";
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
  YAPPERS_INTERVAL_MS,
  legacyYapSlot,
  YAPPERS_MAX_TURNS,
  YAPPERS_ROUND_WINDOW_MS,
  yapFollowupDelay,
  yapPrompt,
  yapSlot,
  researchPrompt,
} from "../lib/telegram-yappers";
import { telegramWorkflow } from "./telegramAgentWorkflow";
import { selectResearchTopic, requestResearch } from "./telegramYapResearch";

const cadence = new RateLimiter(components.rateLimiter, {
  yappersRounds: {
    kind: "token bucket",
    rate: 1,
    period: YAPPERS_INTERVAL_MS,
    capacity: 1,
  },
});

export function yappersEnabled() {
  return (
    Boolean(installation.telegram.communityId) &&
    YAPPERS_TOPIC_ID > 0 &&
    env.TELEGRAM_YAPPERS_ENABLED === "true" &&
    env.TELEGRAM_YAPPERS_TOPIC_ID === String(YAPPERS_TOPIC_ID) &&
    env.TELEGRAM_AGENTS_ENABLED === "true" &&
    env.ELIZA_RUNTIME_MODE === "live"
  );
}

export function validYap(row: Doc<"telegramAgentRequests">, now: number) {
  if (
    !yappersEnabled() ||
    !installationMatches(row) ||
    row.topicId !== YAPPERS_TOPIC_ID ||
    row.kind !== "yap" ||
    typeof row.yapDay !== "string" ||
    !Number.isSafeInteger(row.yapRound) ||
    !Number.isInteger(row.yapTurn) ||
    row.yapTurn! < 0 ||
    row.yapTurn! >=
      ([3, 4].includes(row.yapVersion ?? 0) ? YAPPERS_MAX_TURNS : 2) ||
    now < row.createdAt ||
    now - row.createdAt >= 8 * 60_000
  )
    return false;
  if (row.yapVersion === 3 || row.yapVersion === 4) {
    return (
      row.yapRound! >= 0 &&
      row.key === `yap${row.yapVersion}:${row.yapRound}:${row.yapTurn}` &&
      (row.yapVersion !== 4 || !!row.yapResearchTopicId) &&
      row.yapRoundStartedAt !== undefined &&
      row.createdAt >= row.yapRoundStartedAt &&
      now - row.yapRoundStartedAt < YAPPERS_ROUND_WINDOW_MS &&
      yapSlot(row.yapRoundStartedAt).round === row.yapRound
    );
  }
  if (row.yapVersion === 2) {
    const round = row.yapRound!;
    const offset = row.createdAt - round * YAPPERS_INTERVAL_MS;
    // A follow-up may follow an 8-minute opener, 20-minute delay and 5-minute grace.
    return (
      round >= 0 &&
      row.key === `yap2:${round}:${row.yapTurn}` &&
      offset >= 0 &&
      offset < YAPPERS_INTERVAL_MS + (row.yapTurn === 1 ? 33 * 60_000 : 0)
    );
  }
  // Only in-flight legacy work may finish; old held requests stay untouched.
  return (
    (row.yapRound === 0 || row.yapRound === 1) &&
    legacyYapSlot(now, true)?.day === row.yapDay
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
  const version = parent?.yapVersion ?? 4;
  const turn = parent ? parent.yapTurn! + 1 : 0;
  const startedAt =
    version >= 3 ? (parent?.yapRoundStartedAt ?? now) : undefined;
  if (
    version >= 3 &&
    (turn >= YAPPERS_MAX_TURNS || now - startedAt! >= YAPPERS_ROUND_WINDOW_MS)
  )
    return null;
  const key = `yap${version}:${round}:${turn}`;
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
  // One community-wide quota, shared across every registered identity and caller.
  if (
    !parent &&
    !(await cadence.limit(ctx, "yappersRounds", { key: "community:296" })).ok
  )
    return null;
  const research =
    version === 4
      ? parent
        ? await requestResearch(ctx, parent)
        : await selectResearchTopic(ctx, round)
      : null;
  if (version === 4 && !research) return null;
  const rotation = round;
  // Prefer the speaker from two turns ago: a real A/B/A/B exchange.
  const earlier =
    version === 3 && turn >= 2
      ? await ctx.db
          .query("telegramAgentRequests")
          .withIndex("by_key", (q) => q.eq("key", `yap3:${round}:${turn - 2}`))
          .unique()
      : null;
  const returning =
    earlier?.status === "sent" &&
    earlier.conversationId === parent?.conversationId
      ? agents.find((a) => a.slug === earlier.agentSlug)
      : undefined;
  const prior =
    version === 4 && parent
      ? await Promise.all(
          Array.from({ length: turn }, (_, n) =>
            ctx.db
              .query("telegramAgentRequests")
              .withIndex("by_key", (q) => q.eq("key", `yap4:${round}:${n}`))
              .unique(),
          ),
        )
      : [];
  const used = new Set(
    prior.filter((r) => r?.status === "sent").map((r) => r!.agentSlug),
  );
  const freshSpeakers = agents.filter((a) => !used.has(a.slug));
  const preferred =
    version === 4
      ? turn === 3
        ? agents.find((a) => a.slug === prior[0]?.agentSlug)
        : turn === 0
          ? agents.find((a) => a.slug === research?.source.authorAgentSlug)
          : freshSpeakers[rotation % Math.max(1, freshSpeakers.length)]
      : returning;
  const agent = preferred ?? agents[rotation % agents.length];
  const bot = registry.get(agent.slug)!;
  const conversationId =
    research?.topic.conversationId ??
    parent?.conversationId ??
    (await createThread(ctx, components.agent, {
      title: `Yappers ${day} round ${round + 1}`,
      summary:
        "Only confirmed autonomous agent posts from this public Yappers round. No member or private history.",
    }));
  const requestId = await ctx.db.insert("telegramAgentRequests", {
      installationBinding,
    key,
    agentSlug: agent.slug,
    botId: bot.id,
    updateId: now,
    messageId: 0,
    topicId: YAPPERS_TOPIC_ID,
    senderId: "autonomous-yappers",
    conversationId,
    kind: "yap",
    yapVersion: version as 2 | 3 | 4,
    ...(startedAt !== undefined ? { yapRoundStartedAt: startedAt } : {}),
    ...(research
      ? {
          yapResearchTopicId: research.topic._id,
          yapPreviousMessageId:
            parent?.sentMessageId ?? research.topic.lastMessageId,
          yapPreviousAgentSlug: parent?.agentSlug,
          yapRevisit:
            parent?.yapRevisit ??
            ("revisit" in research && research.revisit === true),
        }
      : {}),
    yapDay: day,
    yapRound: round,
    yapTurn: turn,
    prompt: research
      ? researchPrompt(
          research.source.title,
          turn,
          parent?.yapRevisit ??
            ("revisit" in research && research.revisit === true),
        )
      : yapPrompt(day, round, turn, version === 3 ? YAPPERS_MAX_TURNS : 2),
    status: "queued",
    createdAt: now,
    updatedAt: now,
  });
  if (research && !parent)
    await ctx.db.patch("telegramYapResearchTopics", research.topic._id, {
      lastStartedAt: now,
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
  handler: async (ctx) => {
    const slot = yapSlot(Date.now());
    // kickoff remains accepted for operator compatibility, with no extra allowance.
    return await enqueue(ctx, slot.day, slot.round);
  },
});

export const followup = internalMutation({
  args: { requestId: v.id("telegramAgentRequests") },
  returns: v.union(v.id("telegramAgentRequests"), v.null()),
  handler: async (ctx, { requestId }) => {
    const row = await ctx.db.get("telegramAgentRequests", requestId);
    const delay = row ? yapFollowupDelay(row) : null;
    if (
      !row ||
      row.yapVersion === 3 || // Owner replaced generic v3 chats; do not extend them.
      row.kind !== "yap" ||
      row.status !== "sent" ||
      !row.yapDay ||
      row.yapRound === undefined ||
      delay === null ||
      row.key !== `yap${row.yapVersion}:${row.yapRound}:${row.yapTurn}` ||
      Date.now() - row.updatedAt < delay ||
      Date.now() - row.updatedAt >
        delay + ((row.yapVersion ?? 0) >= 3 ? 3 : 5) * 60_000
    )
      return null;
    if (row.yapVersion === 4) {
      const opener = await ctx.db
        .query("telegramAgentRequests")
        .withIndex("by_key", (q) => q.eq("key", `yap4:${row.yapRound}:0`))
        .unique();
      if (
        !opener ||
        opener.status !== "sent" ||
        opener.conversationId !== row.conversationId ||
        opener.yapRoundStartedAt !== row.yapRoundStartedAt ||
        opener.yapResearchTopicId !== row.yapResearchTopicId ||
        row.yapRoundStartedAt === undefined ||
        Date.now() - row.yapRoundStartedAt >= YAPPERS_ROUND_WINDOW_MS
      )
        return null;
    }
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
